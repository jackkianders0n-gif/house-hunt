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
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ---------------------------------------------------------------------------
// Listing extraction (Claude, structured output)
// ---------------------------------------------------------------------------

const FIELD_NAMES = [
  "price", "beds", "baths", "size_sqft", "tenure", "lease_years",
  "service_charge", "ground_rent", "council_tax", "agency", "agent_phone", "photo",
];

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string", description: "Address exactly as the listing shows it, e.g. \"Albert Road, Plymouth, PL2\"." },
    postcode: { type: "string", description: "Full or partial postcode, only if shown." },
    price: { type: "integer", description: "Asking price in whole pounds." },
    beds: { type: "integer" },
    baths: { type: "integer" },
    size_sqft: { type: "integer", description: "Floor area in square feet. Convert from sq m (x 10.764) if only metric is shown." },
    tenure: { type: "string", enum: ["Leasehold", "Freehold", "Share of freehold", "Commonhold"] },
    lease_years: { type: "integer", description: "Years left on the lease." },
    service_charge: { type: "integer", description: "Service charge in pounds per YEAR. Multiply monthly figures by 12." },
    ground_rent: { type: "integer", description: "Ground rent in pounds per YEAR. Use 0 for peppercorn." },
    council_tax: { type: "string", description: "Council tax band letter, A to H." },
    listing_status: {
      type: "string",
      enum: ["Available", "Under offer", "Sold STC", "Reserved"],
      description: "Use Available unless the listing is marked Under offer, Sold STC or Reserved.",
    },
    key_features: { type: "array", items: { type: "string" }, description: "Up to 6 short key features, 2 to 4 words each." },
    agency: { type: "string", description: "Estate agent name, including branch if shown." },
    agent_phone: { type: "string", description: "Estate agent phone number as shown." },
    photo: {
      type: "object",
      description: "Where the main listing photo sits, as fractions (0 to 1) of that attachment's width and height (for a PDF, of that page's width and height). Hug the photo itself and leave out app chrome, buttons and photo counters where possible.",
      properties: {
        attachment: { type: "integer", description: "Number of the attachment containing the main photo." },
        page: { type: "integer", description: "Page number within a PDF attachment; 1 for screenshots." },
        left: { type: "number" },
        top: { type: "number" },
        right: { type: "number" },
        bottom: { type: "number" },
      },
      required: ["attachment", "page", "left", "top", "right", "bottom"],
      additionalProperties: false,
    },
    missing: {
      type: "array",
      items: { type: "string", enum: FIELD_NAMES },
      description: "Every field above that you could not find in the listing.",
    },
  },
  required: ["address", "key_features", "missing"],
  additionalProperties: false,
};

function instructions(hasAttachments: boolean, text: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `Above ${hasAttachments ? "are numbered attachments (screenshots and/or a full-page PDF of the page)" : "is text"} from a UK Rightmove listing for a flat we are thinking of buying.`,
    "Extract the details into the JSON schema.",
    "Only use what the listing actually shows. Never guess or estimate. Leave out any field you can't find and list it in `missing`.",
    "Price: the asking price in whole pounds, ignoring wording like \"Offers over\" or \"Guide price\".",
    `Lease: years remaining. If only a start date and term are given, work out the years left as of ${today}.`,
    "Service charge and ground rent: pounds per year.",
    "Listing status: Available unless the listing says Under offer, Sold STC or Reserved.",
    hasAttachments
      ? "Photo: the main property photo is usually the large gallery image at the top of the listing. Give its box in the attachment (and PDF page) it appears in. If no property photo is visible, leave `photo` out."
      : "There are no screenshots, so leave `photo` out.",
    text.trim() ? `\nPasted listing text:\n<listing_text>\n${text}\n</listing_text>` : "",
  ].join("\n");
}

async function callClaude(content: unknown[], withEffort: boolean): Promise<Response> {
  const outputConfig: Record<string, unknown> = { format: { type: "json_schema", schema: LISTING_SCHEMA } };
  if (withEffort) outputConfig.effort = "low";
  return await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 8000,
      output_config: outputConfig,
      messages: [{ role: "user", content }],
    }),
  });
}

async function extractListing(attachments: Attachment[], text: string) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY secret isn't set on the Edge Function.");

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
  content.push({ type: "text", text: instructions(attachments.length > 0, text) });

  let res = await callClaude(content, true);
  if (res.status === 400) {
    // If this model rejects the effort setting, try once without it
    const detail = await res.text();
    if (/effort/i.test(detail)) res = await callClaude(content, false);
    else throw new Error(`Claude API error 400: ${detail.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("Claude couldn't read this listing.");
  if (data.stop_reason === "max_tokens") throw new Error("The listing was too long to read in one go.");
  const block = (data.content ?? []).find((b: any) => b.type === "text");
  if (!block) throw new Error("No answer came back from Claude.");

  let listing: any;
  try {
    listing = JSON.parse(block.text);
  } catch {
    throw new Error("Claude's answer wasn't valid JSON.");
  }
  return tidyListing(listing, attachments.length);
}

function tidyListing(raw: any, attachmentCount: number) {
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));

  let photo = null;
  const p = raw.photo;
  if (p && attachmentCount > 0 && Number.isInteger(p.attachment) && p.attachment >= 1 && p.attachment <= attachmentCount) {
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
    const res = await fetch(url);
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
