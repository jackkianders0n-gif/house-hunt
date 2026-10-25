// House Hunt — calendar Edge Function
//
// GET ?key=<calendar key>          → every booked viewing, as a calendar feed you subscribe to once
// GET ?key=<calendar key>&id=<id>  → one viewing, to add to your calendar
//
// Calendar apps can't sign in, so this function needs "Verify JWT" turned OFF in its settings.
// The private key (stored in hh_settings, readable only by you two) is what protects it.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Use GET", { status: 405 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const id = url.searchParams.get("id");
  if (!key) return new Response("Missing key", { status: 401 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: setting } = await admin.from("hh_settings").select("value").eq("key", "calendar_key").maybeSingle();
  if (!setting || typeof setting.value !== "string" || !sameText(setting.value, key)) {
    return new Response("Not allowed", { status: 403 });
  }

  let query = admin
    .from("hh_properties")
    .select("id, address, postcode, price, status, viewing_at, lat, lng, rightmove_url, agent_id, updated_at")
    .not("viewing_at", "is", null);
  query = id ? query.eq("id", id) : query.neq("status", "not_for_us");
  const { data: homes, error } = await query;
  if (error) return new Response("Couldn't load viewings", { status: 500 });

  const agentIds = [...new Set((homes ?? []).map((h: any) => h.agent_id).filter(Boolean))];
  const agents: Record<string, any> = {};
  if (agentIds.length) {
    const { data } = await admin.from("hh_agents").select("id, name, agency, phone").in("id", agentIds);
    (data ?? []).forEach((a: any) => { agents[a.id] = a; });
  }

  const body = buildCalendar(homes ?? [], agents, !id);
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${id ? "viewing" : "viewings"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});

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

function buildCalendar(homes: any[], agents: Record<string, any>, isFeed: boolean): string {
  const now = icsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//House Hunt//Viewings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (isFeed) {
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
