// House Hunt — import Edge Function
//
// action "import":  screenshots, a full-page PDF and/or pasted listing text → Claude →
//                   listing JSON (including where the main photo sits), plus a map location
// action "geocode": address/postcode → map location
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   required
//   ANTHROPIC_MODEL     optional, defaults to claude-sonnet-5-5
//   CONTACT_EMAIL       optional, sent to OpenStreetMap's lookup service as its usage policy asks
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type Attachment = { media_type: string; data: string };
type Location = { lat: number; lng: number; precision: "postcode" | "street" | "area"; label: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Only house hunt members may use this (it spends API credit)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: isMember, error: memberError } = await supabase.rpc("hh_is_member");
  if (memberError || isMember !== true) return json({ error: "This account isn't set up for the house hunt." }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  try {
    if (body?.action === "geocode") {
      const location = await geocode(String(body.address ?? ""), body.postcode ? String(body.postcode) : null);
      return json({ location });
    }

    if (body?.action === "import") {
      const raw = Array.isArray(body.attachments) ? body.attachments : Array.isArray(body.images) ? body.images : [];
      const attachments: Attachment[] = raw
        .filter((a: any) => a && typeof a.data === "string" && /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(a.media_type))
        .slice(0, 4);
      const text = typeof body.text === "string" ? body.text.slice(0, 40000) : "";
      if (!attachments.length && !text.trim()) return json({ error: "Add screenshots or paste the listing text first." }, 400);

      const listing = await extractListing(attachments, text);
      const location = listing.address ? await geocode(listing.address, listing.postcode ?? null) : null;
      return json({ listing, location });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    const message = err instanceof FriendlyError ? err.message : "Something went wrong. Try again.";
    return json({ error: message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Listing extraction (Claude, structured output)
// ---------------------------------------------------------------------------

const FIELD_NAMES = [
  "price", "beds", "baths", "size_sqft", "tenure", "lease_years",
  "service_charge", "ground_rent", "council_tax", "agency", "agent_phone", "photo",
];

// Every field is required (optional fields and unions make the structured-output grammar
// too big). "Not found" is "" for strings, -1 for numbers, and photo.found = false.
const LISTING_SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string", description: "Address exactly as the listing shows it, e.g. \"Albert Road, Plymouth, PL2\"." },
    postcode: { type: "string", description: "Full or partial postcode, only if shown, else \"\"." },
    price: { type: "integer", description: "Asking price in whole pounds, or -1." },
    beds: { type: "integer", description: "Bedrooms, or -1." },
    baths: { type: "integer", description: "Bathrooms, or -1." },
    size_sqft: { type: "integer", description: "Floor area in square feet, or -1. Convert from sq m (x 10.764) if only metric is shown." },
    tenure: { type: "string", enum: ["Leasehold", "Freehold", "Share of freehold", "Commonhold", ""] },
    lease_years: { type: "integer", description: "Years left on the lease, or -1." },
    service_charge: { type: "integer", description: "Service charge in pounds per YEAR, or -1. Multiply monthly figures by 12." },
    ground_rent: { type: "integer", description: "Ground rent in pounds per YEAR, or -1. Use 0 for peppercorn." },
    council_tax: { type: "string", description: "Council tax band letter, A to H, or \"\"." },
    listing_status: { type: "string", enum: ["Available", "Under offer", "Sold STC", "Reserved", ""] },
    key_features: { type: "array", items: { type: "string" }, description: "Up to 6 short key features, 2 to 4 words each." },
    agency: { type: "string", description: "Estate agent name, including branch if shown, or \"\"." },
    agent_phone: { type: "string", description: "Estate agent phone number as shown, or \"\"." },
    photo: {
      type: "object",
      description: "Where the main listing photo sits. Box edges are fractions (0 to 1) of that attachment's width and height (for a PDF, of that page). If found is false, set the numbers to 0.",
      properties: {
        found: { type: "boolean" },
        attachment: { type: "integer", description: "Number of the attachment containing the main photo." },
        page: { type: "integer", description: "Page number within a PDF attachment; 1 for screenshots." },
        left: { type: "number" },
        top: { type: "number" },
        right: { type: "number" },
        bottom: { type: "number" },
      },
      required: ["found", "attachment", "page", "left", "top", "right", "bottom"],
      additionalProperties: false,
    },
    missing: {
      type: "array",
      items: { type: "string", enum: FIELD_NAMES },
      description: "Every field above that you could not find in the listing.",
    },
  },
  required: [
    "address", "postcode", "price", "beds", "baths", "size_sqft", "tenure", "lease_years",
    "service_charge", "ground_rent", "council_tax", "listing_status", "key_features",
    "agency", "agent_phone", "photo", "missing",
  ],
  additionalProperties: false,
};

// Used when structured output is unavailable: the same shape, described in words
const PLAIN_JSON_SHAPE = `{
  "address": string, "postcode": string, "price": integer, "beds": integer, "baths": integer,
  "size_sqft": integer, "tenure": "Leasehold" | "Freehold" | "Share of freehold" | "Commonhold" | "",
  "lease_years": integer, "service_charge": integer, "ground_rent": integer, "council_tax": string,
  "listing_status": "Available" | "Under offer" | "Sold STC" | "Reserved" | "",
  "key_features": string[], "agency": string, "agent_phone": string,
  "photo": { "found": boolean, "attachment": integer, "page": integer, "left": number, "top": number, "right": number, "bottom": number },
  "missing": string[]  (any of: ${FIELD_NAMES.join(", ")})
}`;

function instructions(hasAttachments: boolean, text: string, plainJson: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `Above ${hasAttachments ? "are numbered attachments (screenshots and/or a full-page PDF of the page)" : "is text"} from a UK Rightmove listing for a flat we are thinking of buying.`,
    plainJson
      ? `Extract the details and reply with only a JSON object in exactly this shape, no other text and no code fences. Include every key:\n${PLAIN_JSON_SHAPE}`
      : "Extract the details into the JSON schema. Fill in every field.",
    "Only use what the listing actually shows. Never guess or estimate. For anything you can't find, use \"\" for text, -1 for numbers, and list the field in `missing`.",
    "Price: the asking price in whole pounds, ignoring wording like \"Offers over\" or \"Guide price\".",
    `Lease: years remaining. If only a start date and term are given, work out the years left as of ${today}.`,
    "Service charge and ground rent: pounds per year.",
    "Listing status: Available unless the listing says Under offer, Sold STC or Reserved. Use \"\" only if you can't tell.",
    hasAttachments
      ? "Photo: the main property photo is usually the large gallery image at the top of the listing. Set found to true and give its box in the attachment (and PDF page) it appears in. Hug the photo itself and leave out app chrome, buttons and photo counters where possible. If no property photo is visible, set found to false and the numbers to 0."
      : "Photo: there are no screenshots, so set found to false and the numbers to 0.",
    text.trim() ? `\nPasted listing text:\n<listing_text>\n${text}\n</listing_text>` : "",
  ].join("\n");
}

const CLAUDE_TIMEOUT_MS = 100_000;

class FriendlyError extends Error {}

async function callClaude(content: unknown[], opts: { effort: boolean; schema: boolean }): Promise<Response> {
  const body: Record<string, unknown> = {
    model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
    max_tokens: 8000,
    messages: [{ role: "user", content }],
  };
  const outputConfig: Record<string, unknown> = {};
  if (opts.schema) outputConfig.format = { type: "json_schema", schema: LISTING_SCHEMA };
  if (opts.effort) outputConfig.effort = "low";
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  try {
    return await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new FriendlyError("Reading the listing took too long. Try again, or use fewer screenshots.");
    }
    throw err;
  }
}

// Turn an API failure into something readable in the app; the details go to the function logs
function apiError(status: number, detail: string): Error {
  console.error(`Claude API error ${status}: ${detail.slice(0, 1000)}`);
  if (status === 401 || status === 403) return new FriendlyError("The Claude API key isn't working. Check the ANTHROPIC_API_KEY secret.");
  if (status === 429) return new FriendlyError("Claude is busy right now. Wait a minute and try again.");
  if (status === 529 || status >= 500) return new FriendlyError("Claude is overloaded right now. Try again in a minute.");
  if (/credit balance|billing/i.test(detail)) return new FriendlyError("The Claude account is out of credit.");
  if (/too large|too long|prompt is too long|exceeds/i.test(detail)) return new FriendlyError("The listing is too big to read. Try fewer screenshots or a smaller PDF.");
  if (/model/i.test(detail) && /not.?found|invalid/i.test(detail)) return new FriendlyError("The Claude model setting isn't valid. Check the ANTHROPIC_MODEL secret.");
  return new FriendlyError(`Claude couldn't read the listing (error ${status}). Try again.`);
}

function parseJsonText(text: string): any {
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }
  // Plain-text answers may wrap the JSON in prose or code fences
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch { /* fall through */ }
  }
  throw new FriendlyError("Claude's answer couldn't be read. Try again.");
}

async function extractListing(attachments: Attachment[], text: string) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new FriendlyError("ANTHROPIC_API_KEY secret isn't set on the Edge Function.");

  const content: unknown[] = [];
  attachments.forEach((a, i) => {
    if (a.media_type === "application/pdf") {
      content.push({ type: "text", text: `Attachment ${i + 1} (PDF of the listing page):` });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else {
      content.push({ type: "text", text: `Attachment ${i + 1} (screenshot):` });
      content.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
    }
  });
  const withPrompt = (plainJson: boolean) => [...content, { type: "text", text: instructions(attachments.length > 0, text, plainJson) }];

  let effort = true;
  let schema = true;
  let res = await callClaude(withPrompt(false), { effort, schema });
  if (res.status === 400) {
    const detail = await res.text();
    if (/effort/i.test(detail)) {
      // This model rejects the effort setting: try once without it
      effort = false;
      res = await callClaude(withPrompt(false), { effort, schema });
    } else if (/schema/i.test(detail)) {
      // Structured output rejected (e.g. "Schema is too complex"): ask for plain JSON instead
      console.error(`Structured output rejected, retrying as plain JSON: ${detail.slice(0, 500)}`);
      schema = false;
      res = await callClaude(withPrompt(true), { effort, schema });
    } else {
      throw apiError(400, detail);
    }
  }
  if (res.status === 400 && schema) {
    // The effort retry can still hit the schema limit
    const detail = await res.text();
    if (!/schema/i.test(detail)) throw apiError(400, detail);
    console.error(`Structured output rejected, retrying as plain JSON: ${detail.slice(0, 500)}`);
    schema = false;
    res = await callClaude(withPrompt(true), { effort, schema });
  }
  if (!res.ok) throw apiError(res.status, await res.text());

  const data = await res.json();
  if (data.stop_reason === "refusal") throw new FriendlyError("Claude couldn't read this listing.");
  if (data.stop_reason === "max_tokens") throw new FriendlyError("The listing was too long to read in one go.");
  const block = (data.content ?? []).find((b: any) => b.type === "text");
  if (!block) throw new FriendlyError("No answer came back from Claude. Try again.");

  return tidyListing(parseJsonText(block.text), attachments.length);
}

function tidyListing(raw: any, attachmentCount: number) {
  // -1 and "" are the schema's "not found" values
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  raw = raw && typeof raw === "object" ? raw : {};

  let photo = null;
  const p = raw.photo;
  if (p && p.found === true && attachmentCount > 0 && Number.isInteger(p.attachment) && p.attachment >= 1 && p.attachment <= attachmentCount) {
    const box = { left: clamp(p.left), top: clamp(p.top), right: clamp(p.right), bottom: clamp(p.bottom) };
    const page = Number.isInteger(p.page) && p.page >= 1 ? p.page : 1;
    if (box.right - box.left > 0.05 && box.bottom - box.top > 0.005) photo = { index: p.attachment - 1, page, ...box };
  }

  const band = str(raw.council_tax)?.replace(/band/i, "").toUpperCase().match(/\b[A-I]\b/)?.[0] ?? null;

  return {
    address: str(raw.address) ?? "",
    postcode: str(raw.postcode),
    price: int(raw.price),
    beds: int(raw.beds),
    baths: int(raw.baths),
    size_sqft: int(raw.size_sqft),
    tenure: str(raw.tenure),
    lease_years: int(raw.lease_years),
    service_charge: int(raw.service_charge),
    ground_rent: int(raw.ground_rent),
    council_tax: band,
    listing_status: ["Available", "Under offer", "Sold STC", "Reserved"].includes(raw.listing_status) ? raw.listing_status : null,
    key_features: Array.isArray(raw.key_features)
      ? raw.key_features.map(str).filter(Boolean).slice(0, 6)
      : [],
    agency: str(raw.agency),
    agent_phone: str(raw.agent_phone),
    photo,
    missing: Array.isArray(raw.missing) ? raw.missing.filter((m: unknown) => FIELD_NAMES.includes(String(m))) : [],
  };
}

// ---------------------------------------------------------------------------
// Map location
// ---------------------------------------------------------------------------

const FULL_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTCODE_ONLY = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOOKUP_TIMEOUT_MS = 8_000;

async function geocode(address: string, postcode: string | null): Promise<Location | null> {
  const haystack = `${address} ${postcode ?? ""}`;

  // 1. A full postcode pins it to within a few doors
  const full = haystack.match(FULL_POSTCODE);
  if (full) {
    const pc = `${full[1]} ${full[2]}`.toUpperCase();
    const hit = await postcodesIo(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
    if (hit) return { ...hit, precision: "postcode", label: pc };
  }

  // 2. Street-level lookup via OpenStreetMap
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  const withoutOutcode = parts.filter((s) => !OUTCODE_ONLY.test(s)).join(", ");
  const queries = [...new Set([address.trim(), withoutOutcode].filter(Boolean))];
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(1100); // the service allows one lookup a second
    const hit = await nominatim(queries[i]);
    if (hit) return { ...hit, precision: "street", label: queries[i] };
  }

  // 3. Fall back to the middle of the postcode area (e.g. "PL2")
  const outcode = (postcode?.trim().split(/\s+/)[0]) || parts.find((s) => OUTCODE_ONLY.test(s));
  if (outcode && OUTCODE_ONLY.test(outcode)) {
    const hit = await postcodesIo(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode.toUpperCase())}`);
    if (hit) return { ...hit, precision: "area", label: outcode.toUpperCase() };
  }
  return null;
}

async function postcodesIo(url: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.result;
    if (r && typeof r.latitude === "number" && typeof r.longitude === "number") return { lat: r.latitude, lng: r.longitude };
  } catch (err) {
    console.error("postcodes.io", err);
  }
  return null;
}

async function nominatim(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`;
    const contact = Deno.env.get("CONTACT_EMAIL");
    const res = await fetch(url, {
      headers: {
        "User-Agent": `HouseHuntApp/1.0${contact ? ` (${contact})` : ""}`,
        "Accept-Language": "en-GB",
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0]) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  } catch (err) {
    console.error("nominatim", err);
  }
  return null;
}
