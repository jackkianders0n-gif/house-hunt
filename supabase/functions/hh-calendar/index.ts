// House Hunt — calendar Edge Function
//
// Booked viewings go into a shared iCloud calendar (default name "House hunt"):
// POST {"id": "<home id>"}  → add, move or remove that home's viewing (sent by a database trigger)
// POST {"all": true}        → bring the whole calendar in line with the app (Settings → Sync)
// Both need the calendar key in an x-calendar-key header. Results go into hh_settings as icloud_status.
//
// The old feed still works for anyone subscribed:
// GET ?key=<calendar key>          → every booked viewing, as a calendar feed
// GET ?key=<calendar key>&id=<id>  → one viewing
//
// Needs "Verify JWT" turned OFF: the trigger and calendar apps can't sign in.
// The private key (stored in hh_settings, readable only by you two) is what protects it.
// Secrets:
//   ICLOUD_APPLE_ID      the Apple ID that owns the shared calendar
//   ICLOUD_APP_PASSWORD  an app-specific password for it (account.apple.com → Sign-In and Security)
//   ICLOUD_CALENDAR      optional, the calendar's name; defaults to "House hunt"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-calendar-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const HOME_FIELDS = "id, address, postcode, price, status, viewing_at, lat, lng, rightmove_url, agent_id, updated_at";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!["GET", "HEAD", "POST"].includes(req.method)) return new Response("Use GET or POST", { status: 405, headers: CORS });
  const url = new URL(req.url);
  const key = req.headers.get("x-calendar-key") ?? url.searchParams.get("key") ?? "";
  if (!key) return new Response("Missing key", { status: 401, headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: setting } = await admin.from("hh_settings").select("value").eq("key", "calendar_key").maybeSingle();
  if (!setting || typeof setting.value !== "string" || !sameText(setting.value, key)) {
    return new Response("Not allowed", { status: 403, headers: CORS });
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    if (body?.all) {
      const result = await syncAll(admin);
      return json(result, result.error ? 400 : 200);
    }
    if (typeof body?.id !== "string") return json({ error: "Missing id" }, 400);
    // The trigger doesn't wait, so reply at once and carry on in the background
    const work = syncOne(admin, body.id);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
      return json({ ok: true }, 202);
    }
    return json(await work);
  }

  const id = url.searchParams.get("id");
  let query = admin.from("hh_properties").select(HOME_FIELDS).not("viewing_at", "is", null);
  query = id ? query.eq("id", id) : query.neq("status", "not_for_us");
  const { data: homes, error } = await query;
  if (error) return new Response("Couldn't load viewings", { status: 500 });

  const body = buildCalendar(homes ?? [], await loadAgents(admin, homes ?? []), id ? "single" : "feed");
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${id ? "viewing" : "viewings"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});

async function loadAgents(admin: any, homes: any[]): Promise<Record<string, any>> {
  const agentIds = [...new Set(homes.map((h: any) => h.agent_id).filter(Boolean))];
  const agents: Record<string, any> = {};
  if (agentIds.length) {
    const { data } = await admin.from("hh_agents").select("id, name, agency, phone").in("id", agentIds);
    (data ?? []).forEach((a: any) => { agents[a.id] = a; });
  }
  return agents;
}

// Which homes belong in the calendar: a viewing time, and not ruled out
const wanted = (h: any) => h && h.viewing_at && h.status !== "not_for_us";

class FriendlyError extends Error {}

async function syncOne(admin: any, id: string) {
  try {
    const cal = await findCalendar();
    const { data: home, error } = await admin.from("hh_properties").select(HOME_FIELDS).eq("id", id).maybeSingle();
    if (error) throw new FriendlyError("Couldn't load the home");
    if (wanted(home)) await putEvent(cal, home, await loadAgents(admin, [home]));
    else await deleteEvent(cal, `${cal.url}${id}.ics`);
    return await saveStatus(admin, { ok: true });
  } catch (e) {
    return await saveStatus(admin, { ok: false, error: messageOf(e) });
  }
}

async function syncAll(admin: any) {
  try {
    const cal = await findCalendar();
    const { data: homes, error } = await admin.from("hh_properties").select(HOME_FIELDS).not("viewing_at", "is", null);
    if (error) throw new FriendlyError("Couldn't load viewings");
    const keep = (homes ?? []).filter(wanted);
    const agents = await loadAgents(admin, keep);
    for (const h of keep) await putEvent(cal, h, agents);
    // Remove events for viewings that have gone. Only touch events this app made
    // (named <home id>.ics), never ones you've added to the calendar yourselves.
    const keepIds = new Set(keep.map((h: any) => h.id));
    let removed = 0;
    for (const href of await listEvents(cal)) {
      const m = href.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.ics$/i);
      if (m && !keepIds.has(m[1].toLowerCase())) { await deleteEvent(cal, new URL(href, cal.url).href); removed++; }
    }
    return await saveStatus(admin, { ok: true, count: keep.length, removed });
  } catch (e) {
    return await saveStatus(admin, { ok: false, error: messageOf(e) });
  }
}

function messageOf(e: unknown): string {
  cachedCalendar = null; // look the calendar up afresh next time, in case it was renamed or the password changed
  if (e instanceof FriendlyError) return e.message;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "iCloud took too long to answer. Try again in a minute.";
  console.error(e);
  return "Couldn't reach iCloud. Try again in a minute.";
}

async function saveStatus(admin: any, status: Record<string, unknown>) {
  const value = { ...status, at: new Date().toISOString() };
  const { error } = await admin.from("hh_settings").upsert({ key: "icloud_status", value });
  if (error) console.error(error);
  return value as { ok: boolean; error?: string; count?: number; removed?: number; at: string };
}

// ---------------------------------------------------------------------
// iCloud (CalDAV)

type Calendar = { url: string; auth: string };
let cachedCalendar: Calendar | null = null;

async function dav(url: string, auth: string, method: string, opts: { body?: string; depth?: string; type?: string } = {}) {
  const headers: Record<string, string> = { Authorization: auth };
  if (opts.depth) headers.Depth = opts.depth;
  if (opts.body) headers["Content-Type"] = opts.type ?? "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body: opts.body, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) {
    throw new FriendlyError("iCloud didn't accept the Apple ID and app-specific password. Check the ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD secrets.");
  }
  return res;
}

// iCloud's replies are XML with varying namespace prefixes, so match tags by local name
const tag = (name: string) => `(?:[\\w-]+:)?${name}`;
function hrefInside(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${tag(name)}[^>]*>\\s*<${tag("href")}[^>]*>([^<]+)</`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
}
function responses(xml: string): string[] {
  return xml.split(new RegExp(`<${tag("response")}[\\s>]`, "i")).slice(1);
}
function firstHref(block: string): string | null {
  const m = block.match(new RegExp(`<${tag("href")}[^>]*>([^<]+)</`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function findCalendar(): Promise<Calendar> {
  if (cachedCalendar) return cachedCalendar;
  const appleId = Deno.env.get("ICLOUD_APPLE_ID")?.trim();
  const password = Deno.env.get("ICLOUD_APP_PASSWORD")?.trim();
  const name = (Deno.env.get("ICLOUD_CALENDAR") || "House hunt").trim();
  if (!appleId || !password) throw new FriendlyError("iCloud isn't set up yet. Add the ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD secrets in Supabase.");
  const auth = "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(`${appleId}:${password}`)));

  const root = "https://caldav.icloud.com/";
  const r1 = await dav(root, auth, "PROPFIND", { depth: "0", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
  const principal = hrefInside(await r1.text(), "current-user-principal");
  if (!principal) throw new FriendlyError("iCloud didn't say where your calendars are. Try again in a minute.");
  const principalUrl = new URL(principal, root).href;

  const r2 = await dav(principalUrl, auth, "PROPFIND", { depth: "0", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>' });
  const home = hrefInside(await r2.text(), "calendar-home-set");
  if (!home) throw new FriendlyError("iCloud didn't say where your calendars are. Try again in a minute.");
  const homeUrl = new URL(home, principalUrl).href;

  const r3 = await dav(homeUrl, auth, "PROPFIND", { depth: "1", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>' });
  const found: { name: string; url: string }[] = [];
  for (const block of responses(await r3.text())) {
    if (!new RegExp(`<${tag("calendar")}[\\s/>]`, "i").test(block)) continue; // not a calendar
    if (/name="VTODO"/i.test(block) && !/name="VEVENT"/i.test(block)) continue; // a Reminders list
    const href = firstHref(block);
    const dn = block.match(new RegExp(`<${tag("displayname")}[^>]*>([^<]*)</`, "i"));
    if (href && dn) found.push({ name: decodeXml(dn[1].trim()), url: new URL(href, homeUrl).href });
  }
  const match = found.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const names = found.map((c) => `"${c.name}"`).join(", ");
    throw new FriendlyError(`There's no calendar called "${name}" in this iCloud account${names ? ` (found ${names})` : ""}. Make one, or set the ICLOUD_CALENDAR secret to its name.`);
  }
  cachedCalendar = { url: match.url.endsWith("/") ? match.url : match.url + "/", auth };
  return cachedCalendar;
}

async function putEvent(cal: Calendar, home: any, agents: Record<string, any>) {
  const res = await dav(`${cal.url}${home.id}.ics`, cal.auth, "PUT", {
    body: buildCalendar([home], agents, "caldav"),
    type: "text/calendar; charset=utf-8",
  });
  if (!res.ok) throw new FriendlyError(`iCloud wouldn't save the viewing at ${home.address} (error ${res.status}).`);
  await res.body?.cancel();
}

async function deleteEvent(cal: Calendar, url: string) {
  const res = await dav(url, cal.auth, "DELETE");
  if (!res.ok && res.status !== 404) throw new FriendlyError(`iCloud wouldn't remove a viewing (error ${res.status}).`);
  await res.body?.cancel();
}

async function listEvents(cal: Calendar): Promise<string[]> {
  const res = await dav(cal.url, cal.auth, "PROPFIND", { depth: "1", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
  if (!res.ok) throw new FriendlyError(`iCloud wouldn't list the calendar (error ${res.status}).`);
  return responses(await res.text()).map(firstHref).filter((h): h is string => !!h && h.endsWith(".ics"));
}

// ---------------------------------------------------------------------
// Calendar files

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Lines over 75 bytes are folded, as the calendar format requires
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

// kind: "feed" (subscription), "single" (one viewing to open), "caldav" (one event stored in iCloud,
// which mustn't carry METHOD)
function buildCalendar(homes: any[], agents: Record<string, any>, kind: "feed" | "single" | "caldav"): string {
  const now = icsDate(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//House Hunt//Viewings//EN", "CALSCALE:GREGORIAN"];
  if (kind !== "caldav") lines.push("METHOD:PUBLISH");
  if (kind === "feed") {
    lines.push("X-WR-CALNAME:House hunt viewings", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
  }
  for (const h of homes) {
    const start = new Date(h.viewing_at);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const agent = h.agent_id ? agents[h.agent_id] : null;
    const where = [h.address, h.postcode].filter(Boolean).join(", ");
    const details = [
      h.price != null ? gbp.format(h.price) : null,
      agent ? `Agent: ${[agent.name, agent.agency].filter(Boolean).join(", ")}${agent.phone ? ` (${agent.phone})` : ""}` : null,
      h.rightmove_url || null,
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${h.id}@house-hunt`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${icsDate(new Date(h.updated_at ?? Date.now()))}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeText(`Viewing: ${h.address}`)}`,
      `LOCATION:${escapeText(where)}`,
    );
    if (h.lat != null && h.lng != null) lines.push(`GEO:${h.lat};${h.lng}`);
    if (details) lines.push(`DESCRIPTION:${escapeText(details)}`);
    if (h.rightmove_url) lines.push(`URL:${h.rightmove_url}`);
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Viewing in an hour", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
