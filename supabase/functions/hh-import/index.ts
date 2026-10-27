// House Hunt — import Edge Function
//
// From the app (signed in, members only):
//   action "import":          screenshots, a full-page PDF and/or pasted listing text → Claude →
//                             listing JSON (including where the main photo sits), plus a map location
//   action "geocode":         address/postcode → map location
//   action "agent_lookup":    agency name + listing address → the branch's details, found with web search
//   action "agent_from_text": a pasted email or signature → the agent's details
//   action "inbox_retry":     run a failed inbox item again
//
// From the Safari share button (iOS Shortcut, no sign-in):
//   action "inbox_add":       a Rightmove page's link, text, data and photo → a new inbox item,
//                             read in the background. Protected by the import_key in hh_settings.
//
// The Shortcut can't sign in, so this function needs "Verify JWT" turned OFF in its settings.
// Every other action checks the caller's login is in hh_members before doing anything.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   required
//   ANTHROPIC_MODEL     optional, defaults to claude-sonnet-5-5
//   CONTACT_EMAIL       optional, sent to OpenStreetMap's lookup service as its usage policy asks
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

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
type AgentDetails = { agency: string | null; phone: string | null; email: string | null; website: string | null; address: string | null };

const PHOTO_BUCKET = "hh-photos";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

class FriendlyError extends Error {}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request", message: "Bad request" }, 400);
  }

  // The share button: checked against the private import key instead of a login
  if (body?.action === "inbox_add") {
    try {
      return await inboxAdd(body);
    } catch (err) {
      console.error(err);
      return json({ message: "Couldn't add that to the inbox. Try again." }, 500);
    }
  }

  // Everything else: only house hunt members (it spends API credit)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: isMember, error: memberError } = await supabase.rpc("hh_is_member");
  if (memberError || isMember !== true) return json({ error: "This account isn't set up for the house hunt." }, 403);

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

      const listing = await extractListing(attachments, text, null);
      const location = listing.address ? await geocode(listing.address, listing.postcode ?? null) : null;
      return json({ listing, location });
    }

    if (body?.action === "agent_lookup") {
      const agency = String(body.agency ?? "").trim().slice(0, 200);
      if (!agency) return json({ error: "Add the agency name first." }, 400);
      const agent = await lookupAgent(agency, String(body.address ?? "").slice(0, 300));
      return json({ agent });
    }

    if (body?.action === "agent_from_text") {
      const text = String(body.text ?? "").trim().slice(0, 8000);
      if (!text) return json({ error: "Paste the email or signature first." }, 400);
      return json({ agent: await agentFromText(text) });
    }

    if (body?.action === "inbox_retry") {
      const admin = adminClient();
      const id = String(body.id ?? "");
      const { data: row } = await admin.from("hh_inbox").select("id, payload").eq("id", id).maybeSingle();
      if (!row) return json({ error: "That inbox item isn't there any more." }, 404);
      if (!row.payload) return json({ error: "This one can't be tried again. Share it from Safari again." }, 400);
      await admin.from("hh_inbox").update({ status: "processing", error: null }).eq("id", id);
      inBackground(processInbox(id));
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    const message = err instanceof FriendlyError ? err.message : "Something went wrong. Try again.";
    return json({ error: message }, 502);
  }
});

function inBackground(work: Promise<unknown>) {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else work.catch((err) => console.error(err));
}

// ---------------------------------------------------------------------------
// Inbox (Safari share button)
// ---------------------------------------------------------------------------

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function rightmoveUrl(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^https?:\/\/(?:www\.|m\.)?rightmove\.co\.uk\/properties\/(\d+)/i);
  return m ? `https://www.rightmove.co.uk/properties/${m[1]}` : null;
}

function pageData(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const t = s.trim();
  return t && t !== "null" && t !== "{}" ? t.slice(0, 30000) : null;
}

// The photo arrives as Base64. Work out what it is from its first bytes rather than trusting a label.
function decodeImage(v: unknown): { bytes: Uint8Array; type: string; ext: string } | null {
  if (typeof v !== "string" || !v) return null;
  const b64 = v.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!b64 || b64.length > 11_000_000) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, type: "image/png", ext: "png" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { bytes, type: "image/webp", ext: "webp" };
  }
  return null;
}

async function inboxAdd(body: any): Promise<Response> {
  // The Shortcut sends the page as one JSON text ("page") plus the photo; separate fields work too
  if (typeof body.page === "string") {
    try {
      body = { ...JSON.parse(body.page), ...body };
    } catch {
      return json({ message: "Couldn't read what the Shortcut sent. Check its steps against the README." }, 400);
    }
  }
  const admin = adminClient();
  const key = String(body.key ?? "");
  const { data: setting } = await admin.from("hh_settings").select("value").eq("key", "import_key").maybeSingle();
  if (!key || !setting || typeof setting.value !== "string" || !sameText(setting.value, key)) {
    return json({ message: "The import key isn't right. Copy it again from House Hunt → Settings → Share button setup." }, 403);
  }
  const url = rightmoveUrl(body.url);
  if (!url) return json({ message: "That isn't a Rightmove property page. Open the listing itself and share again." }, 400);

  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, 60000) : "";
  const data = pageData(body.data);
  if (!text && !data) return json({ message: "Couldn't read anything from that page. Let it finish loading and share again." }, 400);

  const id = crypto.randomUUID();
  let photoPath: string | null = null;
  const image = decodeImage(body.image);
  if (image) {
    const path = `inbox/${id}.${image.ext}`;
    const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, image.bytes, { contentType: image.type, upsert: false });
    if (error) console.error("inbox photo", error);
    else photoPath = path;
  }

  const { error } = await admin.from("hh_inbox").insert({ id, url, status: "processing", photo_path: photoPath, payload: { text, data } });
  if (error) throw error;

  inBackground(processInbox(id));
  return json({ message: "Added to House Hunt inbox", id });
}

async function processInbox(id: string) {
  const admin = adminClient();
  try {
    const { data: row, error } = await admin.from("hh_inbox").select("payload").eq("id", id).single();
    if (error) throw error;
    const text = String(row.payload?.text ?? "");
    const data = row.payload?.data ? String(row.payload.data) : null;

    const listing = await extractListing([], text, data);
    const [location, agentLookup] = await Promise.all([
      listing.address ? geocode(listing.address, listing.postcode ?? null) : Promise.resolve(null),
      knownAgent(admin, listing.agency, listing.agent_phone).then((known) =>
        known || !listing.agency
          ? null
          : lookupAgent(listing.agency, listing.address).catch((err) => {
            console.error("agent lookup", err);
            return { error: err instanceof FriendlyError ? err.message : "Couldn't look up the branch." };
          })),
    ]);

    await admin.from("hh_inbox").update({ status: "ready", error: null, listing, location, agent_lookup: agentLookup }).eq("id", id);
  } catch (err) {
    console.error("inbox", id, err);
    const message = err instanceof FriendlyError ? err.message : "Something went wrong reading the listing.";
    await admin.from("hh_inbox").update({ status: "failed", error: message }).eq("id", id);
  }
}

// Same matching as the app: by phone number, then by agency name
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const normAgency = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/&/g, " and ")
    .replace(/\b(estate agents?|ltd|limited|llp|plc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();

async function knownAgent(admin: ReturnType<typeof adminClient>, agency: string | null, phone: string | null): Promise<boolean> {
  const { data, error } = await admin.from("hh_agents").select("agency, phone");
  if (error || !data) return false;
  const d = digits(phone);
  if (d.length >= 9 && data.some((a: any) => digits(a.phone) === d)) return true;
  const n = normAgency(agency);
  return !!n && data.some((a: any) => {
    const m = normAgency(a.agency);
    return m && (m === n || n.startsWith(m) || m.startsWith(n));
  });
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

const CLAUDE_TIMEOUT_MS = 100_000;
const MODEL = () => Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

class ClaudeError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Claude API error ${status}`);
  }
}

// One Messages API call. If this model rejects the effort setting, tries once without it.
async function claude(body: Record<string, any>, signal: AbortSignal, timeoutMessage: string): Promise<any> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new FriendlyError("ANTHROPIC_API_KEY secret isn't set on the Edge Function.");
  const send = async (b: Record<string, any>) => {
    try {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(b),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) throw new FriendlyError(timeoutMessage);
      throw err;
    }
  };

  let res = await send(body);
  if (res.status === 400 && body.output_config?.effort) {
    const detail = await res.text();
    if (!/effort/i.test(detail)) throw new ClaudeError(400, detail);
    const { effort: _effort, ...rest } = body.output_config;
    const retry = { ...body };
    if (Object.keys(rest).length) retry.output_config = rest;
    else delete retry.output_config;
    res = await send(retry);
  }
  if (!res.ok) throw new ClaudeError(res.status, await res.text());
  return await res.json();
}

// Turn an API failure into something readable in the app; the details go to the function logs
function apiError(err: unknown): Error {
  if (!(err instanceof ClaudeError)) return err instanceof Error ? err : new Error(String(err));
  const { status, detail } = err;
  console.error(`Claude API error ${status}: ${detail.slice(0, 1000)}`);
  if (status === 401 || status === 403) return new FriendlyError("The Claude API key isn't working. Check the ANTHROPIC_API_KEY secret.");
  if (status === 429) return new FriendlyError("Claude is busy right now. Wait a minute and try again.");
  if (status === 529 || status >= 500) return new FriendlyError("Claude is overloaded right now. Try again in a minute.");
  if (/web search/i.test(detail) && /enabl/i.test(detail)) {
    return new FriendlyError("Web search is turned off for your Claude account. Turn it on in the Claude Console → Settings → Capabilities.");
  }
  if (/credit balance|billing/i.test(detail)) return new FriendlyError("The Claude account is out of credit.");
  if (/too large|too long|prompt is too long|exceeds/i.test(detail)) return new FriendlyError("The listing is too big to read. Try fewer screenshots or a smaller PDF.");
  if (/model/i.test(detail) && /not.?found|invalid/i.test(detail)) return new FriendlyError("The Claude model setting isn't valid. Check the ANTHROPIC_MODEL secret.");
  return new FriendlyError(`Claude couldn't do that (error ${status}). Try again.`);
}

function answerText(data: any): string {
  if (data.stop_reason === "refusal") throw new FriendlyError("Claude couldn't read this.");
  if (data.stop_reason === "max_tokens") throw new FriendlyError("The answer was too long to finish in one go.");
  const blocks: any[] = data.content ?? [];
  // Only the answer after the last web search, if there was one
  let start = 0;
  blocks.forEach((b, i) => { if (b.type === "web_search_tool_result" || b.type === "server_tool_use") start = i + 1; });
  const text = blocks.slice(start).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text.trim()) throw new FriendlyError("No answer came back from Claude. Try again.");
  return text;
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

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

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

function instructions(hasAttachments: boolean, text: string, data: string | null, plainJson: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    hasAttachments
      ? "Above are numbered attachments (screenshots and/or a full-page PDF of the page) from a UK Rightmove listing for a flat we are thinking of buying."
      : "Below is the text of a UK Rightmove listing for a flat we are thinking of buying, and possibly the page's own listing data.",
    plainJson
      ? `Extract the details and reply with only a JSON object in exactly this shape, no other text and no code fences. Include every key:\n${PLAIN_JSON_SHAPE}`
      : "Extract the details into the JSON schema. Fill in every field.",
    "Only use what the listing actually shows. Never guess or estimate. For anything you can't find, use \"\" for text, -1 for numbers, and list the field in `missing`.",
    "Some listings say \"Ask agent\" instead of a figure. Treat that as not found.",
    data || !hasAttachments
      ? "The page text can include other homes (similar properties, adverts, recently viewed). Only use details of the main listing."
      : "",
    "Price: the asking price in whole pounds, ignoring wording like \"Offers over\" or \"Guide price\".",
    `Lease: years remaining. If only a start date and term are given, work out the years left as of ${today}.`,
    "Service charge and ground rent: pounds per year.",
    "Listing status: Available unless the listing says Under offer, Sold STC or Reserved. Use \"\" only if you can't tell.",
    hasAttachments
      ? "Photo: the main property photo is usually the large gallery image at the top of the listing. Set found to true and give its box in the attachment (and PDF page) it appears in. Hug the photo itself and leave out app chrome, buttons and photo counters where possible. If no property photo is visible, set found to false and the numbers to 0."
      : "Photo: there are no screenshots, so set found to false and the numbers to 0.",
    data ? `\nListing data from the page (most reliable for figures):\n<page_data>\n${data}\n</page_data>` : "",
    text.trim() ? `\nListing text:\n<listing_text>\n${text}\n</listing_text>` : "",
  ].filter(Boolean).join("\n");
}

async function extractListing(attachments: Attachment[], text: string, data: string | null) {
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
  const request = (plainJson: boolean) => {
    const outputConfig: Record<string, unknown> = { effort: "low" };
    if (!plainJson) outputConfig.format = { type: "json_schema", schema: LISTING_SCHEMA };
    return {
      model: MODEL(),
      max_tokens: 8000,
      output_config: outputConfig,
      messages: [{ role: "user", content: [...content, { type: "text", text: instructions(attachments.length > 0, text, data, plainJson) }] }],
    };
  };
  const timeoutMessage = "Reading the listing took too long. Try again, or use fewer screenshots.";

  let answer: any;
  try {
    answer = await claude(request(false), AbortSignal.timeout(CLAUDE_TIMEOUT_MS), timeoutMessage);
  } catch (err) {
    if (!(err instanceof ClaudeError && err.status === 400 && /schema/i.test(err.detail))) throw apiError(err);
    // Structured output rejected (e.g. "Schema is too complex"): ask for plain JSON instead
    console.error(`Structured output rejected, retrying as plain JSON: ${err.detail.slice(0, 500)}`);
    try {
      answer = await claude(request(true), AbortSignal.timeout(CLAUDE_TIMEOUT_MS), timeoutMessage);
    } catch (err2) {
      throw apiError(err2);
    }
  }
  return tidyListing(parseJsonText(answerText(answer)), attachments.length);
}

function tidyListing(raw: any, attachmentCount: number) {
  // -1 and "" are the schema's "not found" values
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
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
// Agent details
// ---------------------------------------------------------------------------

const AGENT_LOOKUP_TIMEOUT_MS = 45_000;

// Web search can't be combined with structured output (its citations aren't allowed with
// output_config.format), so this asks for plain JSON and reads it from the text.
async function lookupAgent(agency: string, address: string | null) {
  const prompt = [
    `Find the contact details of this UK estate agent branch: "${agency}".`,
    address ? `It is marketing a property at "${address}", so it's the branch that covers that area.` : "",
    "Search the web. Prefer the agency's own website, then its Rightmove or Zoopla branch page.",
    "Only give details you found for this exact branch. Never guess. Use \"\" for anything you didn't find.",
    "Reply with only a JSON object, no other text and no code fences:",
    `{"found": boolean, "agency": string, "phone": string, "email": string, "website": string, "address": string, "source_url": string}`,
    "agency is the branch's full name, address its office address, and source_url the page you took most of the details from.",
  ].filter(Boolean).join("\n");

  const messages: any[] = [{ role: "user", content: prompt }];
  const signal = AbortSignal.timeout(AGENT_LOOKUP_TIMEOUT_MS);
  const timeoutMessage = "Looking up the branch took too long.";
  let data: any;
  try {
    for (let turn = 0; turn < 3; turn++) {
      data = await claude({
        model: MODEL(),
        max_tokens: 4000,
        output_config: { effort: "low" },
        tools: [{
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 3,
          user_location: { type: "approximate", country: "GB", timezone: "Europe/London" },
        }],
        messages,
      }, signal, timeoutMessage);
      if (data.stop_reason !== "pause_turn") break;
      // A long search turn was paused: send it back unchanged to carry on
      messages.splice(1, messages.length - 1, { role: "assistant", content: data.content });
    }
  } catch (err) {
    throw apiError(err);
  }
  if (data.stop_reason === "pause_turn") throw new FriendlyError(timeoutMessage);

  const raw = parseJsonText(answerText(data));
  if (raw?.found === false) return null;
  const website = str(raw?.website);
  const source = str(raw?.source_url);
  const agent = {
    agency: str(raw?.agency),
    phone: str(raw?.phone),
    email: str(raw?.email)?.toLowerCase() ?? null,
    website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
    address: str(raw?.address),
    source_url: source && /^https?:\/\//i.test(source) ? source : null,
  };
  return agent.phone || agent.email || agent.website || agent.address ? agent : null;
}

const AGENT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The person's full name, or \"\"." },
    agency: { type: "string", description: "Estate agency name, including branch if shown, or \"\"." },
    phone: { type: "string", description: "Best phone number for them: direct line or mobile before the branch number, or \"\"." },
    email: { type: "string", description: "Their email address, or \"\"." },
    website: { type: "string", description: "The agency's website, or \"\"." },
    address: { type: "string", description: "The branch's office address, or \"\"." },
  },
  required: ["name", "agency", "phone", "email", "website", "address"],
  additionalProperties: false,
};

async function agentFromText(text: string): Promise<AgentDetails & { name: string | null }> {
  const prompt = [
    "Below is an email or email signature from a UK estate agent.",
    "Pull out the agent's details. Only use what the text shows; use \"\" for anything that isn't there.",
    "If the email quotes earlier messages, use the person who wrote the latest one, and ignore anyone who isn't an estate agent.",
    `\n<pasted_text>\n${text}\n</pasted_text>`,
  ].join("\n");
  let data: any;
  try {
    data = await claude({
      model: MODEL(),
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: AGENT_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    }, AbortSignal.timeout(30_000), "That took too long. Try again.");
  } catch (err) {
    throw apiError(err);
  }
  const raw = parseJsonText(answerText(data));
  const website = str(raw?.website);
  return {
    name: str(raw?.name),
    agency: str(raw?.agency),
    phone: str(raw?.phone),
    email: str(raw?.email)?.toLowerCase() ?? null,
    website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
    address: str(raw?.address),
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
