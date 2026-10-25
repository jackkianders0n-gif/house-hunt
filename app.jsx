/* House Hunt — app.jsx
   Compiled in the browser by Babel (no build step), same as the gym tracker.
   Data lives in the gym tracker's Supabase project, in the hh_ tables. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------------------------------------------------------------------------
// Config — paste the same two values the gym tracker uses
// (Supabase → Project Settings → API). URL must be the bare project URL:
// no trailing slash and no /rest/v1/.
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://wvedhcuebfdfkhfvphlb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bkeGnvruQEz3MsVDZiJ03g_bhXXDjgC";
const APP_VERSION = "1.1.0";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "hh-auth" },
});
const PHOTO_BUCKET = "hh-photos";
const UK_CENTRE = [54.2, -2.6];
// PDF reader, loaded only when you import a full-page PDF
const PDFJS_BASE = window.HH_PDFJS_BASE || "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/";
const MAX_PDF_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Statuses and labels
// ---------------------------------------------------------------------------
const STATUSES = [
  { key: "shortlisted", label: "Shortlisted", short: "Shortlisted", bg: "#E4EAF3", fg: "#2B4566", pin: "#2B4566" },
  { key: "viewing_booked", label: "Viewing booked", short: "Booked", bg: "#FCEBD2", fg: "#774708", pin: "#8A5509" },
  { key: "viewed", label: "Viewed", short: "Viewed", bg: "#DDEFE8", fg: "#175640", pin: "#1E6A50" },
  { key: "offer_made", label: "Offer made", short: "Offer", bg: "#ECE6F8", fg: "#4A3282", pin: "#4A3282" },
  { key: "offer_accepted", label: "Offer accepted", short: "Accepted", bg: "#1E6A50", fg: "#FFFFFF", pin: "#123F2F" },
  { key: "not_for_us", label: "Not for us", short: "Not for us", bg: "#EAEBE8", fg: "#55595A", pin: "#6B6F6C" },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const SORT_ORDER = { offer_accepted: 0, offer_made: 1, viewing_booked: 2, viewed: 3, shortlisted: 4, not_for_us: 5 };
const TENURES = ["Leasehold", "Freehold", "Share of freehold", "Commonhold"];
const LISTING_STATUSES = ["Available", "Under offer", "Sold STC", "Reserved"];
const BANDS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const OUTCOMES = [
  { key: "waiting", label: "Waiting to hear" },
  { key: "rejected", label: "Rejected" },
  { key: "countered", label: "Countered" },
  { key: "accepted", label: "Accepted" },
  { key: "withdrawn", label: "Withdrawn" },
];
const OUTCOME = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));
const FIELD_LABELS = {
  price: "asking price", beds: "bedrooms", baths: "bathrooms", size_sqft: "size", tenure: "tenure",
  lease_years: "lease length", service_charge: "service charge", ground_rent: "ground rent",
  council_tax: "council tax band", agency: "agent", agent_phone: "agent's number", photo: "photo",
  listing_status: "Rightmove status", rightmove_url: "Rightmove link",
};
const DEFAULT_LEASE_WARNING = 85;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const money = (v) => (v == null ? "–" : gbp.format(v));
const shortMoney = (v) => {
  if (v == null) return "£?";
  if (v >= 1e6) return `£${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2).replace(/0$/, "")}m`;
  return `£${Math.round(v / 1000)}k`;
};
const pad = (n) => String(n).padStart(2, "0");
const fmtViewing = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const digits = (s) => String(s || "").replace(/\D/g, "");
const telHref = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const toInt = (s) => {
  const t = String(s ?? "").replace(/[^\d.]/g, "");
  if (!t) return null;
  const n = Math.round(parseFloat(t));
  return Number.isFinite(n) ? n : null;
};
const asText = (v) => (v == null ? "" : String(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uuid = () =>
  window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
const go = (path) => { location.hash = "#/" + path; };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const agentLabel = (a) => (a ? [a.name, a.agency].filter(Boolean).join(" · ") : "");
const agentTitle = (a) => (a ? a.name || a.agency || "Agent" : "");
const initials = (a) => {
  const src = (a && (a.name || a.agency)) || "?";
  const words = src.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
};
const checklistScore = (p, items) => items.filter((i) => p.checklist && p.checklist[i.id] === true).length;
const leaseLimit = (settings) => Number(settings?.lease_warning_years) || DEFAULT_LEASE_WARNING;
const isShortLease = (p, settings) =>
  p.lease_years != null && (!p.tenure || p.tenure === "Leasehold") && p.lease_years < leaseLimit(settings);
const listingWarning = (p) => (p.listing_status && p.listing_status !== "Available" ? p.listing_status : null);
const lastReduction = (p) => {
  const h = Array.isArray(p.price_history) ? p.price_history : [];
  const last = h[h.length - 1];
  return last && p.price != null && last.price > p.price ? last : null;
};
function runningCosts(p, settings) {
  const ctYear = p.council_tax ? Number(settings?.council_tax?.[p.council_tax]) || null : null;
  const parts = [
    ["Service charge", p.service_charge],
    ["Ground rent", p.ground_rent],
    ["Council tax", ctYear],
  ].filter(([, v]) => v != null);
  if (!parts.length) return null;
  const year = parts.reduce((s, [, v]) => s + v, 0);
  return {
    monthly: Math.round(year / 12),
    parts: parts.map(([label, v]) => `${label} ${money(Math.round(v / 12))}`),
    councilTaxMissing: !!p.council_tax && ctYear == null,
  };
}
const factsLine = (p) =>
  [
    p.beds != null && `${p.beds} bed`,
    p.baths != null && `${p.baths} bath`,
    p.size_sqft != null && `${p.size_sqft} sq ft`,
    p.tenure && (p.lease_years != null ? `${p.tenure}, ${p.lease_years} yrs` : p.tenure),
  ].filter(Boolean).join(" · ");
const sortHomes = (list) =>
  [...list].sort((a, b) => {
    const s = (SORT_ORDER[a.status] ?? 9) - (SORT_ORDER[b.status] ?? 9);
    if (s) return s;
    if (a.status === "viewing_booked" && a.viewing_at && b.viewing_at) return a.viewing_at.localeCompare(b.viewing_at);
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
const directionsHref = (p) =>
  p.lat != null && p.lng != null
    ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}`
    : `https://maps.apple.com/?daddr=${encodeURIComponent([p.address, p.postcode].filter(Boolean).join(", "))}`;
const calendarUrl = (key, id) =>
  `${SUPABASE_URL}/functions/v1/hh-calendar?key=${encodeURIComponent(key)}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
const normAgency = (s) =>
  String(s || "").toLowerCase().replace(/&/g, " and ")
    .replace(/\b(estate agents?|ltd|limited|llp|plc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
function matchAgent(agents, agency, phone) {
  const d = digits(phone);
  if (d.length >= 9) {
    const byPhone = agents.find((a) => digits(a.phone) === d);
    if (byPhone) return byPhone;
  }
  const n = normAgency(agency);
  if (!n) return null;
  return agents.find((a) => {
    const m = normAgency(a.agency);
    return m && (m === n || n.startsWith(m) || m.startsWith(n));
  }) || null;
}
const rightmoveId = (url) => (String(url || "").match(/properties\/(\d+)/) || [])[1] || null;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?\b/gi;
function streetKey(address) {
  const parts = String(address || "").toLowerCase().split(",")
    .map((s) => s.replace(UK_POSTCODE, "").replace(/^\s*\d+[a-z]?\s+/, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s && !/\b(flat|apartment|maisonette|studio|floor)\b/.test(s));
  return parts[0] || null;
}
function findDuplicate(properties, d) {
  const id = rightmoveId(d.rightmove_url);
  if (id) {
    const hit = properties.find((p) => p.id !== d.id && rightmoveId(p.rightmove_url) === id);
    if (hit) return { p: hit, sure: true };
  }
  const key = streetKey(d.address);
  if (!key) return null;
  const price = toInt(d.price);
  const hit = properties.find((p) => p.id !== d.id && streetKey(p.address) === key &&
    (price == null || p.price == null || Math.abs(p.price - price) / p.price <= 0.1));
  return hit ? { p: hit, sure: false } : null;
}
const locationNote = (precision) =>
  ({
    postcode: "Placed from the postcode. Drag the pin if it's not quite right.",
    street: "Placed on the street from the listing. Drag the pin to the exact building.",
    area: "Only the postcode area was found. Drag the pin to the right street.",
    manual: "Pin placed by you.",
    none: "Couldn't find this address. Tap the map to drop a pin.",
  })[precision] || "";
const partialAddress = (address) => !/\d/.test(String(address || "").split(",")[0] || "");

// ---------------------------------------------------------------------------
// Images and PDFs
// ---------------------------------------------------------------------------
async function openImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error("Couldn't open that image");
  }
  return { img, url };
}
function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the image"))), "image/jpeg", quality));
}
async function resizeImage(blob, maxSide, quality = 0.85) {
  const { img, url } = await openImage(blob);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return canvasToJpeg(c, quality);
}
async function cropImage(blob, box, maxWidth = 1400, quality = 0.82) {
  const { img, url } = await openImage(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = box.left * W, sy = box.top * H;
  const sw = Math.max(1, (box.right - box.left) * W), sh = Math.max(1, (box.bottom - box.top) * H);
  const scale = Math.min(1, maxWidth / sw);
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return canvasToJpeg(c, quality);
}
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const FULL_BOX = { left: 0, top: 0, right: 1, bottom: 1 };

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_BASE + "pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.mjs";
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}
// Render the part of a (very tall) full-page PDF around the listing photo, so it can be
// cropped like a screenshot. Returns the image and the photo box within it.
async function pdfPhotoRegion(file, pageNumber, box) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(clamp(pageNumber || 1, 1, pdf.numPages));
    const scale = 1200 / page.getViewport({ scale: 1 }).width;
    const H = page.getViewport({ scale }).height;
    const boxTop = box.top * H, boxBottom = box.bottom * H;
    const margin = Math.max((boxBottom - boxTop) * 0.4, 240);
    const top = Math.max(0, boxTop - margin);
    const height = Math.round(Math.min(H, boxBottom + margin, top + 4000) - top);
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport: page.getViewport({ scale, offsetY: -top }) }).promise;
    const blob = await canvasToJpeg(canvas, 0.9);
    return {
      blob,
      box: { left: box.left, right: box.right, top: clamp((boxTop - top) / height, 0, 1), bottom: clamp((boxBottom - top) / height, 0, 1) },
    };
  } finally {
    try { task.destroy(); } catch (e) { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 18l-6-6 6-6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  up: <path d="m6 15 6-6 6 6" />,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  compare: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  paste: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  nav: <path d="M12 2.5 20 21l-8-4-8 4z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
};
function Icon({ name, size = 24, stroke = 1.9, color }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || "currentColor"} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
let pushToast = () => {};
function toast(message, kind = "info") { pushToast({ message, kind, id: Math.random() }); }
function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((x) => [...x.slice(-1), t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3600);
    };
    return () => { pushToast = () => {}; };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.message}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data store, with an offline queue and live updates
// ---------------------------------------------------------------------------
const CACHE_KEY = "hh-data-v2";
const QUEUE_KEY = "hh-queue-v1";
const loadJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } };
const saveJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full */ } };
const SIGN_SECONDS = 7 * 24 * 3600;
const LIVE_TABLES = ["hh_properties", "hh_agents", "hh_checklist_items", "hh_offers", "hh_settings"];

function isNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|timed out|offline/i.test(String(err?.message || err || ""));
}

// One pending change. Later changes to the same thing replace earlier ones.
function queueKey(e) {
  if (e.kind === "check") return `check:${e.id}:${e.item}`;
  if (e.kind === "upsert") return `row:${e.table}:${e.row.id}`;
  return `${e.kind}:${e.table}:${e.id}`;
}
function runQueued(e) {
  if (e.kind === "update") return sb.from(e.table).update(e.patch).eq("id", e.id);
  if (e.kind === "check") return sb.rpc("hh_set_check", { p_property: e.id, p_item: e.item, p_value: e.value });
  if (e.kind === "upsert") return sb.from(e.table).upsert(e.row);
  if (e.kind === "delete") return sb.from(e.table).delete().eq("id", e.id);
  return Promise.resolve({ error: null });
}
// Re-apply changes still waiting to sync on top of freshly loaded data
function overlayQueue(queue, data) {
  let { properties, offers } = data;
  for (const e of queue) {
    if (e.kind === "update" && e.table === "hh_properties") properties = properties.map((p) => (p.id === e.id ? { ...p, ...e.patch } : p));
    if (e.kind === "check") properties = properties.map((p) => (p.id === e.id ? { ...p, checklist: { ...(p.checklist || {}), [e.item]: e.value } } : p));
    if (e.kind === "upsert" && e.table === "hh_offers") offers = [...offers.filter((o) => o.id !== e.row.id), e.row];
    if (e.kind === "delete" && e.table === "hh_offers") offers = offers.filter((o) => o.id !== e.id);
  }
  return { ...data, properties, offers };
}

function useHouseHunt() {
  const cached = useMemo(() => loadJSON(CACHE_KEY, null), []);
  const [properties, setProperties] = useState(cached?.properties ?? []);
  const [agents, setAgents] = useState(cached?.agents ?? []);
  const [items, setItems] = useState(cached?.items ?? []);
  const [offers, setOffers] = useState(cached?.offers ?? []);
  const [settings, setSettings] = useState(cached?.settings ?? {});
  const [photos, setPhotos] = useState(cached?.photos ?? {});
  const [loaded, setLoaded] = useState(!!cached);
  const [offline, setOffline] = useState(false);
  const queueRef = useRef(loadJSON(QUEUE_KEY, []));
  const [pending, setPending] = useState(queueRef.current.length);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const flushing = useRef(false);

  useEffect(() => {
    if (loaded) saveJSON(CACHE_KEY, { properties, agents, items, offers, settings, photos });
  }, [properties, agents, items, offers, settings, photos, loaded]);

  const saveQueue = () => { saveJSON(QUEUE_KEY, queueRef.current); setPending(queueRef.current.length); };
  const enqueue = (entry) => {
    const key = queueKey(entry);
    const q = queueRef.current;
    const i = q.findIndex((e) => !e.inflight && queueKey(e) === key);
    if (i >= 0 && entry.kind === "update") q[i] = { ...q[i], patch: { ...q[i].patch, ...entry.patch } };
    else if (i >= 0) q[i] = entry;
    else q.push(entry);
    saveQueue();
    setOffline(true);
  };

  const signPhotos = useCallback(async (props) => {
    const soon = Date.now() + 24 * 3600 * 1000;
    const need = [...new Set(props.map((p) => p.photo_path).filter(Boolean))]
      .filter((path) => !(photosRef.current[path] && photosRef.current[path].exp > soon));
    if (!need.length) return;
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(need, SIGN_SECONDS);
    if (error || !data) return;
    const exp = Date.now() + SIGN_SECONDS * 1000;
    const next = {};
    data.forEach((d) => { if (d.signedUrl && d.path) next[d.path] = { url: d.signedUrl, exp }; });
    setPhotos((ph) => ({ ...ph, ...next }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [p, a, i, o, s] = await Promise.all([
        sb.from("hh_properties").select("*").order("created_at", { ascending: false }),
        sb.from("hh_agents").select("*").order("created_at", { ascending: true }),
        sb.from("hh_checklist_items").select("*").order("position", { ascending: true }),
        sb.from("hh_offers").select("*").order("made_at", { ascending: true }),
        sb.from("hh_settings").select("*"),
      ]);
      const err = p.error || a.error || i.error || o.error || s.error;
      if (err) throw err;
      const data = overlayQueue(queueRef.current, { properties: p.data, offers: o.data });
      setProperties(data.properties);
      setOffers(data.offers);
      setAgents(a.data);
      setItems(i.data);
      setSettings(Object.fromEntries(s.data.map((r) => [r.key, r.value])));
      setLoaded(true);
      if (!queueRef.current.length) setOffline(false);
      signPhotos(p.data);
    } catch (e) {
      console.error(e);
      setOffline(true);
      setLoaded(true);
    }
  }, [signPhotos]);

  // Send queued changes, oldest first. Stops at the first network failure.
  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    let sent = 0;
    try {
      while (queueRef.current.length) {
        const entry = queueRef.current[0];
        entry.inflight = true;
        let res;
        try { res = await runQueued(entry); } catch (e) { res = { error: e }; }
        entry.inflight = false;
        if (res.error && isNetworkError(res.error)) break;
        if (res.error) { console.error(res.error); toast("One change couldn't be saved and was dropped", "error"); }
        queueRef.current = queueRef.current.filter((e) => e !== entry);
        saveQueue();
        sent += 1;
      }
    } finally {
      flushing.current = false;
    }
    if (sent && !queueRef.current.length) {
      toast(`Synced ${plural(sent, "change")}`);
      await refresh();
    }
  }, [refresh]);

  const sync = useCallback(async () => { await flush(); await refresh(); }, [flush, refresh]);

  useEffect(() => {
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", sync);
    const timer = setInterval(() => { if (queueRef.current.length) flush(); }, 20000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", sync);
      clearInterval(timer);
    };
  }, [sync, flush]);

  // Live updates: when the other phone changes something, reload
  useEffect(() => {
    if (!sb.channel) return;
    let timer = null;
    const channel = sb.channel("hh-live");
    LIVE_TABLES.forEach((table) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 400);
      }));
    channel.subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(channel); };
  }, [refresh]);

  // Try to save now; if there's no signal, keep it on the phone and sync later.
  const attempt = useCallback(async (entry) => {
    let res;
    try { res = await runQueued(entry); } catch (e) { res = { error: e }; }
    if (!res.error) {
      if (queueRef.current.length) flush();
      return { status: "saved", data: res.data };
    }
    if (isNetworkError(res.error)) { enqueue(entry); return { status: "queued" }; }
    console.error(res.error);
    toast("Couldn't save that change", "error");
    refresh();
    throw res.error;
  }, [flush, refresh]);

  const api = useMemo(() => ({
    async saveProperty(row) {
      const { data, error } = await sb.from("hh_properties").upsert(row).select().single();
      if (error) throw isNetworkError(error) ? new Error("No signal — this needs a connection to save") : error;
      setProperties((ps) => (ps.some((p) => p.id === data.id) ? ps.map((p) => (p.id === data.id ? data : p)) : [data, ...ps]));
      return data;
    },
    async patchProperty(id, patch) {
      setProperties((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return (await attempt({ kind: "update", table: "hh_properties", id, patch })).status;
    },
    async setCheck(id, item, value) {
      setProperties((ps) => ps.map((p) => (p.id === id ? { ...p, checklist: { ...(p.checklist || {}), [item]: value } } : p)));
      try {
        const res = await attempt({ kind: "check", id, item, value });
        if (res.status === "saved" && res.data) setProperties((ps) => ps.map((p) => (p.id === id ? { ...p, checklist: res.data } : p)));
      } catch (e) { /* toast shown */ }
    },
    async deleteProperty(p) {
      const { error } = await sb.from("hh_properties").delete().eq("id", p.id);
      if (error) throw error;
      if (p.photo_path) sb.storage.from(PHOTO_BUCKET).remove([p.photo_path]).catch(() => {});
      setProperties((ps) => ps.filter((x) => x.id !== p.id));
      setOffers((os) => os.filter((o) => o.property_id !== p.id));
    },
    async saveOffer(row) {
      setOffers((os) => [...os.filter((o) => o.id !== row.id), row]);
      return (await attempt({ kind: "upsert", table: "hh_offers", row })).status;
    },
    async deleteOffer(id) {
      setOffers((os) => os.filter((o) => o.id !== id));
      return (await attempt({ kind: "delete", table: "hh_offers", id })).status;
    },
    async saveAgent(row) {
      const { data, error } = await sb.from("hh_agents").upsert(row).select().single();
      if (error) throw isNetworkError(error) ? new Error("No signal — this needs a connection to save") : error;
      setAgents((as) => (as.some((a) => a.id === data.id) ? as.map((a) => (a.id === data.id ? data : a)) : [...as, data]));
      return data;
    },
    async deleteAgent(id) {
      const { error } = await sb.from("hh_agents").delete().eq("id", id);
      if (error) throw error;
      setAgents((as) => as.filter((a) => a.id !== id));
      setProperties((ps) => ps.map((p) => (p.agent_id === id ? { ...p, agent_id: null } : p)));
    },
    async saveItems(previous, next) {
      const rows = next.filter((i) => i.label.trim()).map((i, idx) => ({ id: i.id, label: i.label.trim(), position: idx + 1 }));
      const removed = previous.filter((i) => !rows.some((r) => r.id === i.id)).map((i) => i.id);
      if (rows.length) {
        const { error } = await sb.from("hh_checklist_items").upsert(rows);
        if (error) throw error;
      }
      if (removed.length) {
        const { error } = await sb.from("hh_checklist_items").delete().in("id", removed);
        if (error) throw error;
      }
      setItems(rows);
    },
    async saveSetting(key, value) {
      const { error } = await sb.from("hh_settings").upsert({ key, value });
      if (error) throw error;
      setSettings((s) => ({ ...s, [key]: value }));
    },
    async uploadPhoto(blob, propertyId) {
      const path = `properties/${propertyId}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGN_SECONDS);
      if (data?.signedUrl) setPhotos((ph) => ({ ...ph, [path]: { url: data.signedUrl, exp: Date.now() + SIGN_SECONDS * 1000 } }));
      return path;
    },
    async removePhoto(path) {
      await sb.storage.from(PHOTO_BUCKET).remove([path]);
    },
    async callImport(body) {
      const { data, error } = await sb.functions.invoke("hh-import", { body });
      if (error) {
        let message = error.message || "Something went wrong";
        try {
          const j = await error.context.json();
          if (j?.error) message = j.error;
        } catch (e) { /* not JSON */ }
        if (isNetworkError(message)) message = "No signal — importing needs a connection";
        throw new Error(message);
      }
      return data;
    },
  }), [attempt]);

  const agentById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const offersFor = useCallback((pid) => offers.filter((o) => o.property_id === pid)
    .sort((a, b) => (b.made_at || "").localeCompare(a.made_at || "")), [offers]);
  const photoUrl = useCallback((path) => (path && photos[path] ? photos[path].url : null), [photos]);

  return { properties, agents, items, offers, settings, loaded, offline, pending, refresh, sync, agentById, offersFor, photoUrl, ...api };
}

// ---------------------------------------------------------------------------
// Routing (hash based, so reloads keep your place)
// ---------------------------------------------------------------------------
function parseHash() {
  const [name = "homes", a, b] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "homes", a, b };
}
function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
function Redirect({ to }) {
  useEffect(() => { location.replace("#/" + to); }, [to]);
  return null;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function StatusPill({ status, small, children }) {
  const s = STATUS[status] || STATUS.shortlisted;
  return (
    <span className={"pill" + (small ? " sm" : "")} style={{ background: s.bg, color: s.fg }}>
      {children || (small ? s.short : s.label)}
    </span>
  );
}
function WarnPill({ children, small }) {
  return <span className={"pill warn" + (small ? " sm" : "")}>{children}</span>;
}
function HomeBadges({ p, settings, small }) {
  const listing = listingWarning(p);
  const short = isShortLease(p, settings);
  if (!listing && !short) return null;
  return (
    <>
      {listing && <WarnPill small={small}>{listing}</WarnPill>}
      {short && <WarnPill small={small}>Short lease</WarnPill>}
    </>
  );
}
function Thumb({ url, size = 88, height, radius }) {
  const h = height ?? size;
  const iconSize = Math.max(18, Math.round((typeof h === "number" ? h : 60) / 3));
  return (
    <span className="thumb" style={{ width: size, height: h, borderRadius: radius }} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name="building" size={iconSize} stroke={1.5} />}
    </span>
  );
}
function BackBar({ to, title, children }) {
  return (
    <header className="bar-head">
      <a className="icon-btn" href={"#/" + to} aria-label="Back"><Icon name="back" stroke={2} /></a>
      {title && <h1>{title}</h1>}
      {!title && <span className="spacer" />}
      {children}
    </header>
  );
}
function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
function Field({ label, id, missing, hint, children }) {
  return (
    <div className={"field" + (missing ? " field-missing" : "")}>
      <label htmlFor={id}>{label}{missing && <span className="miss-tag">Not found</span>}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
function MoneyInput({ id, value, onChange, placeholder }) {
  return (
    <div className="prefix-input">
      <span>£</span>
      <input id={id} className="input" inputMode="numeric" autoComplete="off" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function TabBar({ active }) {
  const homesHref = sessionStorage.getItem("hh-homes-view") === "map" ? "#/map" : "#/homes";
  const tab = (key, href, icon, label) => (
    <a href={href} className={"tab" + (active === key ? " active" : "")} aria-current={active === key ? "page" : undefined}>
      <Icon name={icon} stroke={active === key ? 2 : 1.8} />
      {label}
    </a>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {tab("homes", homesHref, "home", "Homes")}
      {tab("agents", "#/agents", "users", "Agents")}
      {tab("compare", "#/compare", "compare", "Compare")}
    </nav>
  );
}
function SyncBar({ store }) {
  if (!store.offline && !store.pending) return null;
  let text;
  if (store.pending && store.offline) text = `No signal — ${plural(store.pending, "change")} saved on this phone. They'll sync when you're back online.`;
  else if (store.pending) text = "Syncing your changes…";
  else text = "Offline — showing your last saved copy";
  return <div className="offline-bar" role="status">{text}</div>;
}

// Leaflet helpers
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
function addTiles(map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}
function homesCentre(properties) {
  const placed = properties.filter((p) => p.lat != null && p.lng != null);
  if (!placed.length) return null;
  return [placed.reduce((s, p) => s + p.lat, 0) / placed.length, placed.reduce((s, p) => s + p.lng, 0) / placed.length];
}

// ---------------------------------------------------------------------------
// Homes — list and map
// ---------------------------------------------------------------------------
function Homes({ store, view }) {
  const [filter, setFilter] = useState(() => sessionStorage.getItem("hh-filter") || "all");
  useEffect(() => { sessionStorage.setItem("hh-filter", filter); }, [filter]);
  useEffect(() => { sessionStorage.setItem("hh-homes-view", view); }, [view]);

  const { properties } = store;
  const counts = {};
  properties.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  const allPool = view === "map" ? properties.filter((p) => p.status !== "not_for_us") : properties;
  const active = filter !== "all" && !counts[filter] ? "all" : filter;
  const shown = sortHomes(active === "all" ? allPool : properties.filter((p) => p.status === active));
  const chips = [{ key: "all", label: "All", count: allPool.length }, ...STATUSES.filter((s) => counts[s.key]).map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))];

  return (
    <div className="screen">
      <header className="page-head">
        <div className="head-row">
          <div>
            <p className="eyebrow">Our house hunt</p>
            <h1 className="title">Homes</h1>
          </div>
          <div className="head-actions">
            <a className="icon-btn" href="#/settings" aria-label="Settings"><Icon name="settings" size={22} /></a>
            <a className="btn btn-primary btn-pill" href="#/import"><Icon name="plus" size={18} stroke={2.2} />Import</a>
          </div>
        </div>
        <nav className="segmented" aria-label="View">
          <a href="#/homes" aria-current={view === "list" ? "page" : undefined}>List</a>
          <a href="#/map" aria-current={view === "map" ? "page" : undefined}>Map</a>
        </nav>
        {properties.length > 0 && (
          <div className="chips">
            {chips.map((c) => (
              <button key={c.key} type="button" className="chip" aria-pressed={active === c.key} onClick={() => setFilter(c.key)}>
                {c.label} {c.count}
              </button>
            ))}
          </div>
        )}
      </header>

      {view === "map" ? (
        <HomesMap homes={shown} store={store} />
      ) : (
        <main className="scroll">
          {!store.loaded && <p className="center-msg">Loading…</p>}
          {store.loaded && properties.length === 0 && (
            <div className="empty">
              <Icon name="building" size={40} stroke={1.4} />
              <h2>No homes yet</h2>
              <p>Tap Import to add your first flat from Rightmove screenshots or a full-page PDF.</p>
              <a className="btn btn-primary btn-pill" href="#/import"><Icon name="plus" size={18} stroke={2.2} />Import</a>
            </div>
          )}
          {shown.map((p) => <PropertyCard key={p.id} p={p} store={store} />)}
        </main>
      )}
    </div>
  );
}

function offerSummary(offer) {
  if (!offer) return "";
  const outcome = offer.outcome === "countered" && offer.counter_amount
    ? `countered ${shortMoney(offer.counter_amount)}`
    : (OUTCOME[offer.outcome]?.label || "").toLowerCase();
  return `Offer ${shortMoney(offer.amount)} · ${outcome}`;
}

function cardMeta(p, store) {
  const latest = store.offersFor(p.id)[0];
  if ((p.status === "offer_made" || p.status === "offer_accepted") && latest) return offerSummary(latest);
  if (p.status === "viewing_booked" && p.viewing_at) return fmtViewing(p.viewing_at);
  const score = checklistScore(p, store.items);
  if (score > 0) return `Checklist ${score}/${store.items.length}`;
  if (p.viewing_at && new Date(p.viewing_at) < new Date()) return `Viewed ${fmtDay(p.viewing_at)}`;
  if (p.viewing_at) return fmtViewing(p.viewing_at);
  if (p.status === "shortlisted" && p.created_at) return `Added ${fmtDay(p.created_at)}`;
  return "";
}

function PropertyCard({ p, store }) {
  const agent = store.agentById[p.agent_id];
  const meta = cardMeta(p, store);
  const facts = factsLine(p);
  const reduced = lastReduction(p);
  return (
    <a className={"card prop-card" + (p.status === "not_for_us" ? " dim" : "")} href={`#/property/${p.id}`}>
      <div className="prop-top">
        <Thumb url={store.photoUrl(p.photo_path)} />
        <div className="prop-main">
          <div className="pill-row">
            <StatusPill status={p.status} />
            <HomeBadges p={p} settings={store.settings} small />
          </div>
          <span className="prop-address">{p.address}</span>
          <span className="prop-price">{money(p.price)}</span>
          {reduced && <span className="reduced">Reduced from {money(reduced.price)}</span>}
        </div>
      </div>
      {facts && <span className="prop-facts">{facts}</span>}
      {(agent || meta) && (
        <div className="prop-foot">
          <span>{agentLabel(agent)}</span>
          <span className="meta">{meta}</span>
        </div>
      )}
    </a>
  );
}

function HomesMap({ homes, store }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fitted = useRef(false);
  const [selectedId, setSelectedId] = useState(null);
  const placed = homes.filter((p) => p.lat != null && p.lng != null);
  const unplaced = homes.length - placed.length;
  const key = placed.map((p) => `${p.id}:${p.lat}:${p.lng}:${p.status}:${p.price}`).join("|");
  const selected = placed.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!window.L) return;
    const map = L.map(el.current, { zoomControl: false, attributionControl: false });
    addTiles(map);
    L.control.attribution({ position: "topright", prefix: false }).addAttribution(OSM_ATTRIBUTION).addTo(map);
    map.setView(UK_CENTRE, 5);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", () => setSelectedId(null));
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layerRef.current.clearLayers();
    placed.forEach((p) => {
      const s = STATUS[p.status] || STATUS.shortlisted;
      const icon = L.divIcon({
        className: "pin-wrap",
        html: `<span class="pin${p.id === selectedId ? " selected" : ""}" style="background:${s.pin}">${shortMoney(p.price)}</span>`,
        iconSize: null,
      });
      L.marker([p.lat, p.lng], { icon, title: p.address, zIndexOffset: p.id === selectedId ? 1000 : 0 })
        .on("click", () => setSelectedId(p.id))
        .addTo(layerRef.current);
    });
    if (!fitted.current && placed.length) {
      map.fitBounds(L.latLngBounds(placed.map((p) => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 15 });
      fitted.current = true;
    }
  }, [key, selectedId]);

  return (
    <div className="map-wrap">
      <div className="map" ref={el} aria-label="Map of homes" />
      <div className="map-legend" aria-hidden="true">
        {STATUSES.filter((s) => s.key !== "not_for_us").map((s) => <span key={s.key}><i style={{ background: s.pin }} />{s.short}</span>)}
      </div>
      {unplaced > 0 && <span className="map-note">{unplaced} without a location — add it from Edit</span>}
      {!window.L && <p className="center-msg">The map couldn't load. Check your connection.</p>}
      {selected && (
        <a className="map-card" href={`#/property/${selected.id}`}>
          <Thumb url={store.photoUrl(selected.photo_path)} size={68} />
          <span className="info">
            <StatusPill status={selected.status}>
              {selected.status === "viewing_booked" && selected.viewing_at ? `Viewing ${fmtViewing(selected.viewing_at)}` : undefined}
            </StatusPill>
            <span className="prop-address">{selected.address}</span>
            <span className="prop-price" style={{ fontSize: 15 }}>{money(selected.price)}</span>
          </span>
          <Icon name="chevron" size={20} color="#56635C" />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drafts (what the review screen edits)
// ---------------------------------------------------------------------------
const DRAFT_FIELDS = ["price", "beds", "baths", "size_sqft", "tenure", "lease_years", "service_charge", "ground_rent", "council_tax", "listing_status", "rightmove_url"];

function emptyDraft(link = "") {
  return {
    mode: "new", id: uuid(), fromImport: false,
    address: "", postcode: "", price: "", beds: "", baths: "", size_sqft: "", tenure: "", lease_years: "",
    service_charge: "", ground_rent: "", council_tax: "", listing_status: "", key_features: [], rightmove_url: link,
    status: "shortlisted", viewing_date: "", viewing_time: "",
    lat: null, lng: null, precision: "none",
    agentChoice: "none", agentMatched: false, newAgent: { name: "", agency: "", phone: "", email: "" },
    photo: null, photoCandidate: null, existingPhotoPath: null, photoRemoved: false,
    missing: [], source: "", changes: [], dupeDismissed: false,
  };
}

function draftFromListing(listing, location, photo, sourceLabel, link, store) {
  const d = emptyDraft(link.trim());
  const match = matchAgent(store.agents, listing.agency, listing.agent_phone);
  return {
    ...d,
    fromImport: true,
    address: listing.address || "",
    postcode: listing.postcode || "",
    price: asText(listing.price), beds: asText(listing.beds), baths: asText(listing.baths),
    size_sqft: asText(listing.size_sqft), tenure: listing.tenure || "", lease_years: asText(listing.lease_years),
    service_charge: asText(listing.service_charge), ground_rent: asText(listing.ground_rent),
    council_tax: listing.council_tax || "", listing_status: listing.listing_status || "",
    key_features: listing.key_features || [],
    lat: location ? location.lat : null, lng: location ? location.lng : null,
    precision: location ? location.precision : "none",
    agentChoice: match ? match.id : listing.agency || listing.agent_phone ? "new" : "none",
    agentMatched: !!match,
    newAgent: { name: "", agency: listing.agency || "", phone: listing.agent_phone || "", email: "" },
    photo,
    missing: listing.missing || [],
    source: sourceLabel,
  };
}

function draftFromProperty(p) {
  const v = p.viewing_at ? new Date(p.viewing_at) : null;
  return {
    ...emptyDraft(),
    mode: "edit", id: p.id,
    address: p.address || "", postcode: p.postcode || "", price: asText(p.price), beds: asText(p.beds),
    baths: asText(p.baths), size_sqft: asText(p.size_sqft), tenure: p.tenure || "", lease_years: asText(p.lease_years),
    service_charge: asText(p.service_charge), ground_rent: asText(p.ground_rent), council_tax: p.council_tax || "",
    listing_status: p.listing_status || "", key_features: p.key_features || [], rightmove_url: p.rightmove_url || "",
    status: p.status,
    viewing_date: v ? dateInput(v) : "", viewing_time: v ? timeInput(v) : "",
    lat: p.lat, lng: p.lng, precision: p.lat != null ? "manual" : "none",
    agentChoice: p.agent_id || "none",
    existingPhotoPath: p.photo_path || null,
  };
}

// Apply a fresh import (or a duplicate new draft) to a home you already have.
// Your address, pin, agent, status and notes are kept; listing facts are updated.
function draftUpdatingHome(existing, incoming) {
  const d = { ...draftFromProperty(existing), mode: "update", fromImport: true, source: incoming.source };
  const changes = [];
  for (const f of DRAFT_FIELDS) {
    const next = String(incoming[f] ?? "").trim();
    const prev = String(d[f] ?? "").trim();
    if (f === "rightmove_url" && prev && rightmoveId(prev) === rightmoveId(next)) continue;
    if (next && next !== prev) {
      changes.push({ field: f, from: prev, to: next });
      d[f] = next;
    }
  }
  if (!d.key_features.length && incoming.key_features?.length) d.key_features = incoming.key_features;
  if (d.lat == null && incoming.lat != null) { d.lat = incoming.lat; d.lng = incoming.lng; d.precision = incoming.precision; }
  if (d.agentChoice === "none" && incoming.agentChoice !== "none") {
    d.agentChoice = incoming.agentChoice; d.agentMatched = incoming.agentMatched; d.newAgent = incoming.newAgent;
  }
  d.photoCandidate = incoming.photo || null;
  if (!existing.photo_path && incoming.photo) { d.photo = incoming.photo; d.photoCandidate = null; }
  d.changes = changes;
  return d;
}

function describeChange(c) {
  const isMoney = ["price", "service_charge", "ground_rent"].includes(c.field);
  const show = (v) => (v === "" ? "blank" : isMoney ? money(toInt(v)) : v);
  const label = FIELD_LABELS[c.field] || c.field;
  return `${label[0].toUpperCase() + label.slice(1)}: ${show(c.from)} → ${show(c.to)}`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
function ImportScreen({ store, setDraft, target }) {
  const [shots, setShots] = useState([]);
  const [text, setText] = useState("");
  const [link, setLink] = useState(target?.rightmove_url || "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const addFiles = (fileList) => {
    const next = [...shots];
    for (const f of Array.from(fileList || [])) {
      if (next.length >= 4) { toast("Up to 4 files"); break; }
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
      if (!isPdf && !f.type.startsWith("image/")) continue;
      if (isPdf && f.size > MAX_PDF_BYTES) { toast("That PDF is over 8 MB — try screenshots instead", "error"); continue; }
      next.push({ id: uuid(), file: f, kind: isPdf ? "pdf" : "image", url: isPdf ? null : URL.createObjectURL(f), name: f.name });
    }
    setShots(next);
  };
  const removeShot = (id) => setShots((s) => s.filter((x) => x.id !== id));

  async function readListing() {
    if (!shots.length && !text.trim()) { toast("Add screenshots, a PDF or the listing text first"); return; }
    setBusy(true);
    try {
      const attachments = [];
      for (const s of shots) {
        if (s.kind === "pdf") attachments.push({ media_type: "application/pdf", data: await blobToBase64(s.file) });
        else attachments.push({ media_type: "image/jpeg", data: await blobToBase64(await resizeImage(s.file, 1568)) });
      }
      const res = await store.callImport({ action: "import", attachments, text });
      const listing = res.listing;

      // Work out the photo: crop straight from a screenshot, or render that part of the PDF
      let photo = null;
      const lp = listing.photo;
      const shot = lp ? shots[lp.index] : null;
      if (shot) {
        const box = { left: lp.left, top: lp.top, right: lp.right, bottom: lp.bottom };
        if (shot.kind === "pdf") {
          try {
            const region = await pdfPhotoRegion(shot.file, lp.page, box);
            photo = { file: region.blob, box: region.box, from: "the PDF" };
          } catch (e) {
            console.error(e);
            toast("Couldn't get the photo out of the PDF — add one on the next screen");
          }
        } else {
          photo = { file: shot.file, box, from: `screenshot ${lp.index + 1}` };
        }
      }
      const pdfs = shots.filter((s) => s.kind === "pdf").length;
      const images = shots.length - pdfs;
      const sourceLabel = [images && plural(images, "screenshot"), pdfs && (pdfs === 1 ? "the PDF" : `${pdfs} PDFs`)].filter(Boolean).join(" and ") || "the pasted text";
      const fresh = draftFromListing(listing, res.location, photo, sourceLabel, link, store);
      setDraft(target ? draftUpdatingHome(target, fresh) : fresh);
      go("review");
    } catch (e) {
      console.error(e);
      toast(e.message || "Couldn't read the listing", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <BackBar to={target ? `property/${target.id}` : "homes"} title={target ? "Update from Rightmove" : "Import from Rightmove"} />
      <main className="scroll roomy">
        <p className="lead">
          {target
            ? `Add new screenshots or a PDF of ${target.address}. You'll see what's changed before anything is saved.`
            : "Add screenshots or a full-page PDF of the listing, or paste the page text. Claude fills in the details for you to check before saving."}
        </p>

        <section className="card import-card">
          <div className="card-head">
            <Icon name="image" size={22} color="#1E6A50" stroke={1.8} />
            <h2>Screenshots or PDF</h2>
            <span className="count">{shots.length} of 4</span>
          </div>
          <div className="shots">
            {shots.map((s, i) => (
              <div key={s.id} className={"shot" + (s.kind === "pdf" ? " pdf" : "")}>
                {s.kind === "pdf" ? (
                  <span className="pdf-tile"><Icon name="file" size={26} stroke={1.6} />PDF</span>
                ) : <img src={s.url} alt={`Screenshot ${i + 1}`} />}
                <button type="button" className="remove" aria-label={`Remove file ${i + 1}`} onClick={() => removeShot(s.id)}>
                  <Icon name="x" size={16} stroke={2.4} />
                </button>
              </div>
            ))}
            {shots.length < 4 && (
              <button type="button" className="shot-add" aria-label="Add screenshots or a PDF" onClick={() => fileRef.current.click()}>
                <Icon name="plus" stroke={2} />
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <p className="hint">
            Quickest: in Safari, take a screenshot of the listing, tap <b>Full Page</b>, save it as a PDF to Files, then add it here.
            Or add screenshots of the top of the listing (for the photo) and the Key information and Leasehold sections.
          </p>
        </section>

        <section className="card import-card">
          <div className="card-head">
            <Icon name="paste" size={22} color="#1E6A50" stroke={1.8} />
            <label htmlFor="paste" style={{ fontSize: 16, fontWeight: 700 }}>Or paste the listing text</label>
          </div>
          <textarea id="paste" className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="In Safari: Select All on the listing, Copy, then paste here" />
        </section>

        <Field label="Rightmove link (optional)" id="link" hint="Share → Copy on the listing, then paste. It spots duplicates and opens the listing later.">
          <input id="link" className="input" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.rightmove.co.uk/properties/…" />
        </Field>

        {!target && (
          <button type="button" className="link-btn" style={{ alignSelf: "center" }}
            onClick={() => { setDraft(emptyDraft(link.trim())); go("review"); }}>
            Enter the details yourself instead
          </button>
        )}
      </main>
      <div className="footer-action">
        <button type="button" className="btn btn-primary btn-block" onClick={readListing} disabled={busy}>Read listing</button>
      </div>
      {busy && (
        <div className="busy" role="status">
          <div className="spinner" />
          Reading the listing…
          <p>This usually takes 10–30 seconds{shots.some((s) => s.kind === "pdf") ? ", a little longer for a PDF" : ""}.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review / edit / update a home
// ---------------------------------------------------------------------------
function PhotoPreview({ photo, existingUrl }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!photo) { setUrl(null); return; }
    let live = true, made = null;
    cropImage(photo.file, photo.box, 900, 0.8)
      .then((b) => { if (live) { made = URL.createObjectURL(b); setUrl(made); } })
      .catch(() => live && setUrl(null));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [photo]);
  const src = photo ? url : existingUrl;
  return (
    <div className="photo-box" role="img" aria-label="Property photo">
      {src ? <img src={src} alt="" /> : (
        <>
          <Icon name="building" size={40} stroke={1.4} />
          <span>{photo ? "Preparing photo…" : "No photo yet"}</span>
        </>
      )}
    </div>
  );
}

function CropEditor({ file, box, onDone, onCancel }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [b, setB] = useState(box);
  const frameRef = useRef(null);
  const drag = useRef(null);

  const start = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = frameRef.current.getBoundingClientRect();
    drag.current = { mode, x: e.clientX, y: e.clientY, rect, b0: b };
    try { frameRef.current.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.rect.width;
    const dy = (e.clientY - d.y) / d.rect.height;
    const MIN = 0.06;
    let { left, top, right, bottom } = d.b0;
    if (d.mode === "move") {
      const w = right - left, h = bottom - top;
      left = clamp(left + dx, 0, 1 - w); top = clamp(top + dy, 0, 1 - h);
      right = left + w; bottom = top + h;
    } else {
      if (d.mode.includes("l")) left = clamp(left + dx, 0, right - MIN);
      if (d.mode.includes("r")) right = clamp(right + dx, left + MIN, 1);
      if (d.mode.includes("t")) top = clamp(top + dy, 0, bottom - MIN);
      if (d.mode.includes("b")) bottom = clamp(bottom + dy, top + MIN, 1);
    }
    setB({ left, top, right, bottom });
  };
  const end = () => { drag.current = null; };
  const pct = (v) => `${v * 100}%`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Adjust crop">
      <div className="overlay-head">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <h2>Adjust crop</h2>
        <button type="button" className="btn btn-primary" onClick={() => onDone(b)}>Done</button>
      </div>
      <div className="crop-stage">
        <div className="crop-frame" ref={frameRef} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <img src={url} alt="Image to crop" draggable="false" />
          <div className="crop-box" style={{ left: pct(b.left), top: pct(b.top), width: pct(b.right - b.left), height: pct(b.bottom - b.top) }}
            onPointerDown={start("move")}>
            {["tl", "tr", "bl", "br"].map((h) => <span key={h} className={"crop-handle " + h} onPointerDown={start(h)} />)}
          </div>
        </div>
      </div>
      <p className="overlay-foot">Drag the box to move it, or a corner to resize.</p>
    </div>
  );
}

function LocationPicker({ lat, lng, onChange, fallback }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!window.L) return;
    const map = L.map(el.current, { attributionControl: false, scrollWheelZoom: false });
    addTiles(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addAttribution(OSM_ATTRIBUTION).addTo(map);
    const has = lat != null && lng != null;
    map.setView(has ? [lat, lng] : fallback || UK_CENTRE, has ? 16 : fallback ? 12 : 5);
    map.on("click", (e) => onChangeRef.current(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat == null || lng == null) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({ className: "pin-wrap", html: '<span class="drop-pin"></span>', iconSize: null }),
      }).addTo(map);
      markerRef.current.on("dragend", (e) => { const ll = e.target.getLatLng(); onChangeRef.current(ll.lat, ll.lng); });
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    } else {
      markerRef.current.setLatLng([lat, lng]);
      if (!map.getBounds().contains([lat, lng])) map.panTo([lat, lng]);
    }
  }, [lat, lng]);

  if (!window.L) return <p className="hint">The map couldn't load. Check your connection.</p>;
  return <div className="loc-map" ref={el} aria-label="Map: drag the pin, or tap to place it" />;
}

function ReviewScreen({ store, initial }) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [newFeature, setNewFeature] = useState("");
  const [locating, setLocating] = useState(false);
  const photoInput = useRef(null);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setAgentField = (k, v) => setD((x) => ({ ...x, newAgent: { ...x.newAgent, [k]: v } }));
  const isMissing = (k) => d.mode === "new" && d.missing.includes(k) && !String(d[k] ?? "").trim();
  const editing = d.mode !== "new";
  const backTo = editing ? `property/${d.id}` : "import";
  const existingUrl = !d.photoRemoved ? store.photoUrl(d.existingPhotoPath) : null;
  const fallbackCentre = useMemo(() => homesCentre(store.properties), []);
  const missingLabels = d.missing.filter((m) => FIELD_LABELS[m]).map((m) => FIELD_LABELS[m]);
  const dupe = d.mode === "new" && !d.dupeDismissed ? findDuplicate(store.properties, d) : null;
  const title = { new: "Check details", edit: "Edit home", update: "Check changes" }[d.mode];

  const pickPhoto = (file) => {
    if (!file) return;
    setD((x) => ({ ...x, photo: { file, box: FULL_BOX, from: null }, photoRemoved: false }));
    setCropping(true);
  };

  async function findLocation() {
    if (!d.address.trim()) { toast("Add the address first"); return; }
    setLocating(true);
    try {
      const res = await store.callImport({ action: "geocode", address: d.address, postcode: d.postcode });
      if (res.location) setD((x) => ({ ...x, lat: res.location.lat, lng: res.location.lng, precision: res.location.precision }));
      else { set("precision", "none"); toast("Couldn't find that address — tap the map instead"); }
    } catch (e) {
      toast(e.message || "Couldn't look that up", "error");
    } finally {
      setLocating(false);
    }
  }

  function addFeature() {
    const f = newFeature.trim();
    if (!f) return;
    set("key_features", [...d.key_features, f]);
    setNewFeature("");
  }

  async function save() {
    if (!d.address.trim()) { toast("Add the address first", "error"); return; }
    setSaving(true);
    try {
      let agentId = null;
      if (d.agentChoice === "new") {
        const na = d.newAgent;
        if (na.name.trim() || na.agency.trim()) {
          const a = await store.saveAgent({
            name: na.name.trim() || null, agency: na.agency.trim() || null,
            phone: na.phone.trim() || null, email: na.email.trim() || null,
          });
          agentId = a.id;
        }
      } else if (d.agentChoice !== "none") {
        agentId = d.agentChoice;
      }

      let photoPath = d.photoRemoved ? null : d.existingPhotoPath;
      if (d.photo) photoPath = await store.uploadPhoto(await cropImage(d.photo.file, d.photo.box), d.id);

      const price = toInt(d.price);
      const previous = store.properties.find((p) => p.id === d.id);
      const history = Array.isArray(previous?.price_history) ? previous.price_history : [];
      const viewingAt = d.viewing_date ? new Date(`${d.viewing_date}T${d.viewing_time || "12:00"}`).toISOString() : null;
      const row = {
        id: d.id,
        address: d.address.trim(),
        postcode: d.postcode.trim() || null,
        price, beds: toInt(d.beds), baths: toInt(d.baths), size_sqft: toInt(d.size_sqft),
        tenure: d.tenure || null, lease_years: toInt(d.lease_years),
        service_charge: toInt(d.service_charge), ground_rent: toInt(d.ground_rent),
        council_tax: d.council_tax.trim().toUpperCase() || null,
        listing_status: d.listing_status || null,
        key_features: d.key_features,
        rightmove_url: d.rightmove_url.trim() || null,
        agent_id: agentId,
        status: d.status,
        viewing_at: viewingAt,
        lat: d.lat, lng: d.lng,
        photo_path: photoPath,
        price_history: previous && previous.price != null && price != null && price !== previous.price
          ? [...history, { price: previous.price, at: new Date().toISOString() }]
          : history,
      };
      const saved = await store.saveProperty(row);
      if (d.existingPhotoPath && d.existingPhotoPath !== photoPath) store.removePhoto(d.existingPhotoPath).catch(() => {});
      toast({ new: "Home saved", edit: "Changes saved", update: "Home updated" }[d.mode]);
      location.replace(`#/property/${saved.id}`);
    } catch (e) {
      console.error(e);
      toast(e.message || "Couldn't save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const p = store.properties.find((x) => x.id === d.id);
    if (!p || !window.confirm(`Delete ${p.address}? This can't be undone.`)) return;
    try {
      await store.deleteProperty(p);
      toast("Home deleted");
      location.replace("#/homes");
    } catch (e) {
      toast(e.message || "Couldn't delete", "error");
    }
  }

  const input = (key, props = {}) => (
    <input id={key} className="input" value={d[key]} onChange={(e) => set(key, e.target.value)} {...props} />
  );
  const numeric = { inputMode: "numeric", autoComplete: "off" };
  const selectedAgent = store.agentById[d.agentChoice];

  return (
    <div className="screen">
      <BackBar to={backTo} title={title} />
      <main className="scroll roomy">
        {dupe && (
          <div className="banner" role="alert">
            <Icon name="alert" size={20} stroke={2} />
            <div className="banner-body">
              <span>
                {dupe.sure ? "You already have this listing" : "This looks like one you already have"}:{" "}
                <b>{dupe.p.address}</b>, {money(dupe.p.price)}.
              </span>
              <div className="banner-actions">
                <button type="button" className="btn btn-primary" onClick={() => setD(draftUpdatingHome(dupe.p, d))}>Update that home</button>
                <button type="button" className="btn btn-outline" onClick={() => set("dupeDismissed", true)}>It's a different flat</button>
              </div>
            </div>
          </div>
        )}

        {d.mode === "update" && (
          <div className={"banner" + (d.changes.length ? "" : " ok")} role="status">
            <Icon name={d.changes.length ? "refresh" : "check"} size={20} stroke={2} />
            <div className="banner-body">
              {d.changes.length ? (
                <>
                  <span>Changed since you saved it, from {d.source}:</span>
                  <ul className="changes">{d.changes.map((c) => <li key={c.field}>{describeChange(c)}</li>)}</ul>
                  <span className="hint" style={{ color: "inherit" }}>Your address, pin, agent, status, checklist and notes are kept.</span>
                </>
              ) : <span>Nothing's changed since you saved it.</span>}
            </div>
          </div>
        )}

        {d.mode === "new" && d.fromImport && (
          <div className={"banner" + (missingLabels.length ? "" : " ok")} role="status">
            <Icon name={missingLabels.length ? "alert" : "check"} size={20} stroke={2} />
            <span>
              Filled from {d.source}.{" "}
              {missingLabels.length
                ? `Not found: ${missingLabels.join(", ")}. Add them or leave blank.`
                : "Check everything looks right."}
            </span>
          </div>
        )}

        <section className="section">
          <h2 className="section-title">Photo</h2>
          <PhotoPreview photo={d.photo} existingUrl={existingUrl} />
          {d.photo?.from && <p className="hint">Cropped from {d.photo.from}.</p>}
          {d.photoCandidate && (
            <button type="button" className="btn btn-outline" onClick={() => setD((x) => ({ ...x, photo: x.photoCandidate, photoCandidate: null, photoRemoved: false }))}>
              Use the photo from the new {d.photoCandidate.from && d.photoCandidate.from.startsWith("screenshot") ? "screenshots" : "PDF"}
            </button>
          )}
          <div className="grid2">
            <button type="button" className="btn btn-outline" disabled={!d.photo} onClick={() => setCropping(true)}>Adjust crop</button>
            <button type="button" className="btn btn-outline" onClick={() => photoInput.current.click()}>
              {d.photo || existingUrl ? "Use a different photo" : "Add a photo"}
            </button>
          </div>
          {(d.photo || existingUrl) && (
            <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }}
              onClick={() => setD((x) => ({ ...x, photo: null, photoRemoved: true }))}>Remove photo</button>
          )}
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ""; }} />
        </section>

        <section className="section">
          <h2 className="section-title">The property</h2>
          <Field label="Address" id="address"
            hint={partialAddress(d.address) && d.address ? "Rightmove hides the house number. Add it once the agent gives you the full address." : undefined}>
            {input("address", { autoComplete: "off" })}
          </Field>
          <div className="grid2">
            <Field label="Asking price" id="price" missing={isMissing("price")}>
              <MoneyInput id="price" value={d.price} onChange={(v) => set("price", v)} />
            </Field>
            <Field label="Council tax band" id="council_tax" missing={isMissing("council_tax")}>
              {input("council_tax", { maxLength: 1, autoCapitalize: "characters" })}
            </Field>
          </div>
          <div className="grid3">
            <Field label="Beds" id="beds" missing={isMissing("beds")}>{input("beds", numeric)}</Field>
            <Field label="Baths" id="baths" missing={isMissing("baths")}>{input("baths", numeric)}</Field>
            <Field label="Sq ft" id="size_sqft" missing={isMissing("size_sqft")}>{input("size_sqft", numeric)}</Field>
          </div>
          <Field label="Postcode" id="postcode">{input("postcode", { autoCapitalize: "characters", autoComplete: "off" })}</Field>
        </section>

        <section className="section">
          <h2 className="section-title">Tenure and costs</h2>
          <div className="grid2">
            <Field label="Tenure" id="tenure" missing={isMissing("tenure")}>
              <select id="tenure" className="select" value={d.tenure} onChange={(e) => set("tenure", e.target.value)}>
                <option value="">Not known</option>
                {TENURES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Lease years left" id="lease_years" missing={isMissing("lease_years")}>{input("lease_years", numeric)}</Field>
            <Field label="Service charge / yr" id="service_charge" missing={isMissing("service_charge")}>
              <MoneyInput id="service_charge" value={d.service_charge} onChange={(v) => set("service_charge", v)} />
            </Field>
            <Field label="Ground rent / yr" id="ground_rent" missing={isMissing("ground_rent")}>
              <MoneyInput id="ground_rent" value={d.ground_rent} onChange={(v) => set("ground_rent", v)} />
            </Field>
          </div>
          {toInt(d.lease_years) != null && toInt(d.lease_years) < leaseLimit(store.settings) && (!d.tenure || d.tenure === "Leasehold") && (
            <p className="hint warn-text">Short lease — under {leaseLimit(store.settings)} years. Leases below about 80 years cost more to extend, and some lenders are cautious. Worth asking a solicitor about.</p>
          )}
        </section>

        <section className="section">
          <h2 className="section-title">Location</h2>
          <LocationPicker lat={d.lat} lng={d.lng} fallback={fallbackCentre}
            onChange={(lat, lng) => setD((x) => ({ ...x, lat, lng, precision: "manual" }))} />
          <div className="loc-row">
            <p className="hint">{locationNote(d.lat != null ? d.precision : "none")}</p>
            <button type="button" className="link-btn" onClick={findLocation} disabled={locating}>
              {locating ? "Looking…" : "Find from address"}
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">Key features</h2>
          {d.key_features.length > 0 && (
            <div className="feature-chips">
              {d.key_features.map((f, i) => (
                <span key={f + i} className="feature">
                  {f}
                  <button type="button" aria-label={`Remove ${f}`} onClick={() => set("key_features", d.key_features.filter((_, j) => j !== i))}>
                    <Icon name="x" size={14} stroke={2.4} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="add-row">
            <label htmlFor="feature" className="sr-only">Add a key feature</label>
            <input id="feature" className="input" value={newFeature} placeholder="Add a feature"
              onChange={(e) => setNewFeature(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }} />
            <button type="button" className="btn btn-outline" onClick={addFeature}>Add</button>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">Estate agent</h2>
          <Field label="Agent" id="agent"
            hint={d.agentMatched && selectedAgent ? "Matched to an agent you already have." : undefined}>
            <select id="agent" className="select" value={d.agentChoice}
              onChange={(e) => setD((x) => ({ ...x, agentChoice: e.target.value, agentMatched: false }))}>
              <option value="none">No agent</option>
              {store.agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
              <option value="new">New agent…</option>
            </select>
          </Field>
          {d.agentChoice === "new" && (
            <>
              <div className="grid2">
                <Field label="Name" id="agent-name">
                  <input id="agent-name" className="input" value={d.newAgent.name} placeholder="Optional" onChange={(e) => setAgentField("name", e.target.value)} />
                </Field>
                <Field label="Agency" id="agent-agency" missing={d.mode === "new" && d.missing.includes("agency") && !d.newAgent.agency.trim()}>
                  <input id="agent-agency" className="input" value={d.newAgent.agency} onChange={(e) => setAgentField("agency", e.target.value)} />
                </Field>
              </div>
              <div className="grid2">
                <Field label="Phone" id="agent-phone" missing={d.mode === "new" && d.missing.includes("agent_phone") && !d.newAgent.phone.trim()}>
                  <input id="agent-phone" className="input" type="tel" value={d.newAgent.phone} onChange={(e) => setAgentField("phone", e.target.value)} />
                </Field>
                <Field label="Email" id="agent-email">
                  <input id="agent-email" className="input" type="email" value={d.newAgent.email} placeholder="Optional" onChange={(e) => setAgentField("email", e.target.value)} />
                </Field>
              </div>
            </>
          )}
        </section>

        <section className="section">
          <h2 className="section-title">Tracking</h2>
          <div className="grid2">
            <Field label="Status" id="status">
              <select id="status" className="select" value={d.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="On Rightmove" id="listing_status">
              <select id="listing_status" className="select" value={d.listing_status} onChange={(e) => set("listing_status", e.target.value)}>
                <option value="">Not known</option>
                {LISTING_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field label="Viewing date" id="viewing_date">{input("viewing_date", { type: "date" })}</Field>
            <Field label="Time" id="viewing_time">{input("viewing_time", { type: "time" })}</Field>
          </div>
          <Field label="Rightmove link" id="rightmove_url">{input("rightmove_url", { type: "url", inputMode: "url", placeholder: "Optional" })}</Field>
        </section>

        {d.mode === "edit" && (
          <button type="button" className="btn btn-danger" onClick={remove}><Icon name="trash" size={18} />Delete this home</button>
        )}
      </main>
      <div className="footer-action">
        <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={saving}>
          {saving ? "Saving…" : { new: "Save home", edit: "Save changes", update: "Save update" }[d.mode]}
        </button>
      </div>
      {cropping && d.photo && (
        <CropEditor file={d.photo.file} box={d.photo.box} onCancel={() => setCropping(false)}
          onDone={(box) => { setD((x) => ({ ...x, photo: { ...x.photo, box } })); setCropping(false); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property page
// ---------------------------------------------------------------------------
function PropertyScreen({ store, id, tab }) {
  const p = store.properties.find((x) => x.id === id);
  const [sheet, setSheet] = useState(null);
  if (!p) {
    return (
      <div className="screen">
        <BackBar to="homes" />
        <p className="center-msg">{store.loaded ? "This home isn't here any more." : "Loading…"}</p>
      </div>
    );
  }
  const agent = store.agentById[p.agent_id];
  const score = checklistScore(p, store.items);
  const onChecklist = tab === "checklist";
  const reduced = lastReduction(p);
  const calendarKey = typeof store.settings.calendar_key === "string" ? store.settings.calendar_key : null;

  return (
    <div className="screen">
      <header className="bar-head">
        <a className="icon-btn" href="#/homes" aria-label="Back to homes"><Icon name="back" stroke={2} /></a>
        {onChecklist ? (
          <div className="bar-title">
            <h1>{p.address}</h1>
            <span>{[money(p.price), STATUS[p.status]?.label].join(" · ")}</span>
          </div>
        ) : <span className="spacer" />}
        <a className="icon-btn" href={`#/edit/${p.id}`} aria-label="Edit home"><Icon name="edit" size={22} /></a>
      </header>

      <main className="scroll roomy" style={{ paddingTop: 0 }}>
        {!onChecklist && (
          <>
            <div className="photo-box hero" role="img" aria-label="Property photo">
              {store.photoUrl(p.photo_path) ? <img src={store.photoUrl(p.photo_path)} alt="" /> : (
                <><Icon name="building" size={44} stroke={1.4} /><span>No photo</span></>
              )}
            </div>
            <div className="prop-head">
              <div className="pill-row">
                <button type="button" className="pill" style={{ background: STATUS[p.status].bg, color: STATUS[p.status].fg }}
                  onClick={() => setSheet("status")} aria-label={`Status: ${STATUS[p.status].label}. Change status`}>
                  {STATUS[p.status].label}<Icon name="down" size={16} stroke={2.2} />
                </button>
                <HomeBadges p={p} settings={store.settings} />
              </div>
              <h1>{p.address}</h1>
              <p className="price">{money(p.price)}</p>
              {reduced && <p className="reduced">Reduced from {money(reduced.price)} on {fmtDay(reduced.at)}</p>}
              <div className="link-row">
                <a className="btn btn-primary btn-pill" href={directionsHref(p)} target="_blank" rel="noopener">
                  <Icon name="nav" size={18} stroke={2} />Directions
                </a>
                {p.rightmove_url && (
                  <a className="btn btn-outline btn-pill" href={p.rightmove_url} target="_blank" rel="noopener">
                    Rightmove<Icon name="external" size={16} stroke={2} />
                  </a>
                )}
              </div>
            </div>
            <div className="card info-card">
              <Icon name="calendar" color="#1E6A50" stroke={1.8} />
              <div className="text">
                <span className="label">Viewing</span>
                <span className="value">{p.viewing_at ? fmtViewing(p.viewing_at) : "Not booked"}</span>
                {p.viewing_at && calendarKey && (
                  <a className="small-link" href={calendarUrl(calendarKey, p.id)} target="_blank" rel="noopener">Add to calendar</a>
                )}
              </div>
              <button type="button" className="link-btn" onClick={() => setSheet("viewing")}>{p.viewing_at ? "Change" : "Add"}</button>
            </div>
          </>
        )}

        <nav className="segmented" aria-label="Property sections">
          <a href={`#/property/${p.id}`} aria-current={!onChecklist ? "page" : undefined}>Details</a>
          <a href={`#/property/${p.id}/checklist`} aria-current={onChecklist ? "page" : undefined}>
            Checklist &amp; notes {!onChecklist && store.items.length > 0 && <span className="count">{score}/{store.items.length}</span>}
          </a>
        </nav>

        {onChecklist ? <ChecklistTab p={p} store={store} /> : <DetailsTab p={p} agent={agent} store={store} onOffer={(o) => setSheet({ offer: o || null })} />}
      </main>

      {sheet === "status" && (
        <Sheet title="Status" onClose={() => setSheet(null)}>
          <div className="card option-list">
            {STATUSES.map((s) => (
              <button key={s.key} type="button" className="option" onClick={() => {
                setSheet(s.key === "viewing_booked" && !p.viewing_at ? "viewing" : s.key === "offer_made" && !store.offersFor(p.id).length ? { offer: null } : null);
                if (s.key !== p.status) store.patchProperty(p.id, { status: s.key }).catch(() => {});
              }}>
                <StatusPill status={s.key} />
                {s.key === p.status && <span className="tick"><Icon name="check" stroke={2.4} /></span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "viewing" && <ViewingSheet p={p} store={store} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === "object" && <OfferSheet p={p} offer={sheet.offer} store={store} onClose={() => setSheet(null)} />}
    </div>
  );
}

function ViewingSheet({ p, store, onClose }) {
  const v = p.viewing_at ? new Date(p.viewing_at) : null;
  const [date, setDate] = useState(v ? dateInput(v) : "");
  const [time, setTime] = useState(v ? timeInput(v) : "");
  const [address, setAddress] = useState(p.address || "");
  const [postcode, setPostcode] = useState(p.postcode || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const viewing_at = date ? new Date(`${date}T${time || "12:00"}`).toISOString() : null;
    const patch = { viewing_at };
    if (viewing_at && p.status === "shortlisted") patch.status = "viewing_booked";
    const addressChanged = address.trim() && (address.trim() !== p.address || postcode.trim() !== (p.postcode || ""));
    if (addressChanged) { patch.address = address.trim(); patch.postcode = postcode.trim() || null; }
    try {
      const status = await store.patchProperty(p.id, patch);
      onClose();
      // Re-place the pin from the full address so Directions go to the door
      if (addressChanged && status === "saved") {
        try {
          const res = await store.callImport({ action: "geocode", address: patch.address, postcode: patch.postcode });
          if (res.location) {
            await store.patchProperty(p.id, { lat: res.location.lat, lng: res.location.lng });
            toast(res.location.precision === "postcode" ? "Pin moved to the full address" : "Pin updated — check it in Edit");
          }
        } catch (e) { /* keep the old pin */ }
      }
    } catch (e) {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Viewing" onClose={onClose} footer={
      <>
        {p.viewing_at && <button type="button" className="btn btn-outline" onClick={() => { onClose(); store.patchProperty(p.id, { viewing_at: null }).catch(() => {}); }}>Clear</button>}
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
      </>
    }>
      <div className="grid2">
        <Field label="Date" id="v-date"><input id="v-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Time" id="v-time"><input id="v-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <Field label="Full address" id="v-address"
        hint={partialAddress(p.address)
          ? "Agents usually give the house number once a viewing's booked. Add it (and the full postcode) so Directions take you to the door."
          : undefined}>
        <input id="v-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label="Postcode" id="v-postcode">
        <input id="v-postcode" className="input" value={postcode} autoCapitalize="characters" onChange={(e) => setPostcode(e.target.value)} />
      </Field>
      {p.status === "shortlisted" && <p className="hint">Saving a date moves this home to Viewing booked.</p>}
    </Sheet>
  );
}

function OfferSheet({ p, offer, store, onClose }) {
  const [amount, setAmount] = useState(offer ? String(offer.amount) : "");
  const [date, setDate] = useState(dateInput(offer ? new Date(offer.made_at) : new Date()));
  const [outcome, setOutcome] = useState(offer?.outcome || "waiting");
  const [counter, setCounter] = useState(asText(offer?.counter_amount));
  const [notes, setNotes] = useState(offer?.notes || "");

  const save = async () => {
    const value = toInt(amount);
    if (!value) { toast("Add the amount", "error"); return; }
    const row = {
      id: offer?.id || uuid(),
      property_id: p.id,
      amount: value,
      made_at: new Date(`${date}T12:00`).toISOString(),
      outcome,
      counter_amount: outcome === "countered" ? toInt(counter) : null,
      notes,
      created_at: offer?.created_at || new Date().toISOString(),
    };
    onClose();
    try {
      const status = await store.saveOffer(row);
      if (outcome === "accepted" && p.status !== "offer_accepted") {
        await store.patchProperty(p.id, { status: "offer_accepted" });
        toast("Offer accepted — status updated");
      } else if (!offer && !["offer_made", "offer_accepted"].includes(p.status)) {
        await store.patchProperty(p.id, { status: "offer_made" });
      }
      if (status === "queued") toast("Saved on this phone — it'll sync when you're back online");
    } catch (e) { /* toast shown */ }
  };
  const remove = async () => {
    if (!window.confirm("Delete this offer?")) return;
    onClose();
    store.deleteOffer(offer.id).catch(() => {});
  };
  return (
    <Sheet title={offer ? "Offer" : "Log an offer"} onClose={onClose} footer={
      <>
        {offer && <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>}
        <button type="button" className="btn btn-primary" onClick={save}>Save</button>
      </>
    }>
      <div className="grid2">
        <Field label="Amount" id="o-amount"><MoneyInput id="o-amount" value={amount} onChange={setAmount} /></Field>
        <Field label="Date" id="o-date"><input id="o-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="What happened" id="o-outcome">
        <select id="o-outcome" className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </Field>
      {outcome === "countered" && (
        <Field label="Their counter-offer" id="o-counter"><MoneyInput id="o-counter" value={counter} onChange={setCounter} /></Field>
      )}
      <Field label="Notes" id="o-notes">
        <textarea id="o-notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Agent said the seller wants a quick sale" />
      </Field>
    </Sheet>
  );
}

function DetailsTab({ p, agent, store, onOffer }) {
  const short = isShortLease(p, store.settings);
  const costs = runningCosts(p, store.settings);
  const offers = store.offersFor(p.id);
  const showOffers = offers.length > 0 || ["viewed", "offer_made", "offer_accepted"].includes(p.status);
  const facts = [
    ["Bedrooms", p.beds], ["Bathrooms", p.baths],
    ["Size", p.size_sqft != null ? `${p.size_sqft} sq ft` : null], ["Tenure", p.tenure],
    ["Lease left", p.lease_years != null ? `${p.lease_years} years` : null, short], ["Council tax", p.council_tax ? `Band ${p.council_tax}` : null],
    ["Service charge", p.service_charge != null ? `${money(p.service_charge)} / yr` : null],
    ["Ground rent", p.ground_rent != null ? `${money(p.ground_rent)} / yr` : null],
  ];
  return (
    <>
      <section className="card facts" aria-label="Key facts">
        {facts.map(([label, value, warn]) => (
          <div key={label} className="fact">
            <span className="label">{label}</span>
            <span className={"value" + (warn ? " warn-text" : "")}>{value ?? "–"}{warn && " · short"}</span>
          </div>
        ))}
      </section>
      {short && (
        <p className="hint warn-text">
          Under {leaseLimit(store.settings)} years left. Leases below about 80 years cost more to extend, and some lenders are cautious — worth asking a solicitor.
        </p>
      )}

      {costs && (
        <div className="card info-card">
          <span className="text">
            <span className="label">Running costs</span>
            <span className="value">{money(costs.monthly)} a month</span>
            <span className="label" style={{ fontWeight: 600 }}>{costs.parts.join(" · ")}</span>
            {costs.councilTaxMissing && (
              <a className="small-link" href="#/settings">Add council tax amounts in Settings to include it</a>
            )}
          </span>
        </div>
      )}

      {showOffers && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Offers</h2>
            <button type="button" className="link-btn" onClick={() => onOffer(null)}>Log an offer</button>
          </div>
          {offers.length > 0 ? (
            <div className="card option-list">
              {offers.map((o) => (
                <button key={o.id} type="button" className="option offer-row" onClick={() => onOffer(o)}>
                  <span className="offer-main">
                    <span className="offer-amount">{money(o.amount)}</span>
                    <span className="hint" style={{ fontSize: 12 }}>
                      {fmtDay(o.made_at)} · {OUTCOME[o.outcome]?.label}
                      {o.outcome === "countered" && o.counter_amount ? ` at ${money(o.counter_amount)}` : ""}
                    </span>
                    {o.notes && <span className="hint" style={{ fontSize: 12 }}>{o.notes}</span>}
                  </span>
                  <Icon name="chevron" size={18} color="#56635C" />
                </button>
              ))}
            </div>
          ) : <p className="hint">No offers yet.</p>}
        </section>
      )}

      {p.key_features?.length > 0 && (
        <section className="section">
          <h2 className="section-title">Key features</h2>
          <div className="feature-chips">{p.key_features.map((f, i) => <span key={f + i} className="feature">{f}</span>)}</div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Estate agent</h2>
        {agent ? (
          <div className="card agent-card">
            <a className="agent-link" href={`#/agent/${agent.id}`}>
              <span className="avatar" aria-hidden="true">{initials(agent)}</span>
              <span className="agent-text">
                <span className="name">{agentTitle(agent)}</span>
                {agent.name && agent.agency && <span className="sub">{agent.agency}</span>}
              </span>
            </a>
            <a className={"round-btn outline" + (agent.email ? "" : " disabled")} href={agent.email ? `mailto:${agent.email}` : undefined} aria-label={`Email ${agentTitle(agent)}`}>
              <Icon name="mail" size={22} />
            </a>
            <a className={"round-btn" + (agent.phone ? "" : " disabled")} href={agent.phone ? telHref(agent.phone) : undefined} aria-label={`Call ${agentTitle(agent)}`}>
              <Icon name="phone" size={22} />
            </a>
          </div>
        ) : (
          <a className="card info-card" href={`#/edit/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <Icon name="users" color="#1E6A50" stroke={1.8} />
            <span className="text"><span className="value">No agent yet</span><span className="label">Tap to add one</span></span>
          </a>
        )}
      </section>

      <a className="btn btn-outline" href={`#/import/${p.id}`}>
        <Icon name="refresh" size={18} stroke={2} />Update from Rightmove
      </a>
    </>
  );
}

function ChecklistTab({ p, store }) {
  const items = store.items;
  const done = checklistScore(p, items);
  return (
    <>
      <div className="section" style={{ gap: 8 }}>
        <div className="progress-head">
          <h2>Viewing checklist</h2>
          <span>{done} of {items.length} ticked</span>
        </div>
        <div className="progress" aria-hidden="true"><div style={{ width: items.length ? `${(done / items.length) * 100}%` : 0 }} /></div>
      </div>
      <section className="card checklist" aria-label="Checklist">
        {items.map((item) => {
          const on = p.checklist?.[item.id] === true;
          return (
            <button key={item.id} type="button" className="check-row" aria-pressed={on} onClick={() => store.setCheck(p.id, item.id, !on)}>
              <span className="check-box" aria-hidden="true">{on && <Icon name="check" size={16} stroke={3} />}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
        {items.length === 0 && <p className="hint" style={{ padding: 16 }}>No checklist items yet. Add some in Settings.</p>}
      </section>
      <a className="link-btn" href="#/settings" style={{ alignSelf: "flex-start", textDecoration: "none" }}>Edit checklist items</a>
      <NotesBox key={p.id} p={p} store={store} />
    </>
  );
}

function NotesBox({ p, store }) {
  const [text, setText] = useState(p.notes || "");
  const [state, setState] = useState("saved");
  const timer = useRef(null);
  const latest = useRef(text);
  const savedText = useRef(p.notes || "");

  useEffect(() => {
    // Pick up the other person's changes when we're not mid-edit
    if ((state === "saved" || state === "queued") && (p.notes || "") !== savedText.current) {
      savedText.current = p.notes || "";
      latest.current = savedText.current;
      setText(savedText.current);
    }
  }, [p.notes]);

  const commit = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (value === savedText.current) { setState((s) => (s === "editing" ? "saved" : s)); return; }
    setState("saving");
    try {
      const status = await store.patchProperty(p.id, { notes: value });
      savedText.current = value;
      setState(latest.current === value ? status : "editing");
    } catch (e) {
      setState("error");
    }
  };
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (latest.current !== savedText.current) store.patchProperty(p.id, { notes: latest.current }).catch(() => {});
  }, []);

  const label = {
    editing: "Typing…", saving: "Saving…", saved: "Saved · you can both edit",
    queued: "Saved on this phone · will sync", error: "Not saved — try again",
  }[state];
  return (
    <section className="section" style={{ gap: 8 }}>
      <div className="notes-head">
        <label htmlFor="notes">Notes</label>
        <span className={"save-state" + (state === "error" ? " error" : "")}>{label}</span>
      </div>
      <textarea id="notes" className="textarea" rows={6} value={text} placeholder="Anything to remember about this one…"
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          setState("editing");
          clearTimeout(timer.current);
          timer.current = setTimeout(commit, 900);
        }}
        onBlur={commit} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
function AgentSheet({ agent, store, onClose, onSaved }) {
  const [f, setF] = useState({
    name: agent?.name || "", agency: agent?.agency || "", phone: agent?.phone || "",
    email: agent?.email || "", notes: agent?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.name.trim() && !f.agency.trim()) { toast("Add a name or an agency", "error"); return; }
    setBusy(true);
    try {
      const saved = await store.saveAgent({
        ...(agent ? { id: agent.id } : {}),
        name: f.name.trim() || null, agency: f.agency.trim() || null,
        phone: f.phone.trim() || null, email: f.email.trim() || null, notes: f.notes,
      });
      onClose();
      onSaved && onSaved(saved);
    } catch (e) {
      toast(e.message || "Couldn't save", "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${agentTitle(agent)}? Their homes will stay, just without an agent.`)) return;
    try {
      await store.deleteAgent(agent.id);
      onClose();
      location.replace("#/agents");
    } catch (e) {
      toast(e.message || "Couldn't delete", "error");
    }
  };
  return (
    <Sheet title={agent ? "Edit agent" : "New agent"} onClose={onClose} footer={
      <>
        {agent && <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>}
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
      </>
    }>
      <Field label="Name" id="a-name"><input id="a-name" className="input" value={f.name} onChange={set("name")} placeholder="e.g. Sarah Thompson" /></Field>
      <Field label="Agency" id="a-agency"><input id="a-agency" className="input" value={f.agency} onChange={set("agency")} placeholder="e.g. Harbour & Co" /></Field>
      <Field label="Phone" id="a-phone"><input id="a-phone" className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Email" id="a-email"><input id="a-email" className="input" type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Notes" id="a-notes"><textarea id="a-notes" className="textarea" rows={3} value={f.notes} onChange={set("notes")} /></Field>
    </Sheet>
  );
}

function AgentsScreen({ store }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const counts = {};
  store.properties.forEach((p) => { if (p.agent_id) counts[p.agent_id] = (counts[p.agent_id] || 0) + 1; });
  const term = q.trim().toLowerCase();
  const list = store.agents
    .filter((a) => !term || [a.name, a.agency, a.phone].some((v) => String(v || "").toLowerCase().includes(term)))
    .sort((a, b) => agentTitle(a).localeCompare(agentTitle(b)));
  return (
    <div className="screen">
      <header className="page-head">
        <div className="head-row">
          <div>
            <p className="eyebrow">Our house hunt</p>
            <h1 className="title">Agents</h1>
          </div>
          <button type="button" className="btn btn-primary btn-pill" onClick={() => setAdding(true)}><Icon name="plus" size={18} stroke={2.2} />Add</button>
        </div>
        {store.agents.length > 0 && (
          <div className="search">
            <Icon name="search" size={20} stroke={2} />
            <label htmlFor="q" className="sr-only">Search agents</label>
            <input id="q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or agency" />
          </div>
        )}
      </header>
      <main className="scroll">
        {store.loaded && store.agents.length === 0 && (
          <div className="empty">
            <Icon name="users" size={40} stroke={1.4} />
            <h2>No agents yet</h2>
            <p>Agents are added for you when you import a listing, or you can add one yourself.</p>
          </div>
        )}
        {list.map((a) => (
          <div key={a.id} className="card agent-card">
            <a className="agent-link" href={`#/agent/${a.id}`}>
              <span className="avatar" aria-hidden="true">{initials(a)}</span>
              <span className="agent-text">
                <span className="name">{agentTitle(a)}</span>
                {a.name && a.agency && <span className="sub">{a.agency}</span>}
                <span className="count">{counts[a.id] ? `${counts[a.id]} ${counts[a.id] === 1 ? "property" : "properties"}` : "No properties"}</span>
              </span>
            </a>
            <a className={"round-btn" + (a.phone ? "" : " disabled")} href={a.phone ? telHref(a.phone) : undefined} aria-label={`Call ${agentTitle(a)}`}>
              <Icon name="phone" size={22} />
            </a>
          </div>
        ))}
      </main>
      {adding && <AgentSheet store={store} onClose={() => setAdding(false)} onSaved={(a) => go(`agent/${a.id}`)} />}
    </div>
  );
}

function AgentScreen({ store, id }) {
  const a = store.agentById[id];
  const [editing, setEditing] = useState(false);
  if (!a) {
    return (
      <div className="screen">
        <BackBar to="agents" />
        <p className="center-msg">{store.loaded ? "This agent isn't here any more." : "Loading…"}</p>
      </div>
    );
  }
  const homes = sortHomes(store.properties.filter((p) => p.agent_id === a.id));
  return (
    <div className="screen">
      <BackBar to="agents">
        <button type="button" className="icon-btn" aria-label="Edit agent" onClick={() => setEditing(true)}><Icon name="edit" size={22} /></button>
      </BackBar>
      <main className="scroll roomy">
        <div className="agent-profile">
          <span className="avatar lg" aria-hidden="true">{initials(a)}</span>
          <h1>{agentTitle(a)}</h1>
          {a.name && a.agency && <p>{a.agency}</p>}
        </div>
        <div className="grid2">
          <a className="btn btn-primary btn-block" href={a.phone ? telHref(a.phone) : undefined}
            style={a.phone ? undefined : { opacity: 0.45, pointerEvents: "none" }}>
            <Icon name="phone" size={20} stroke={2} />Call
          </a>
          <a className="btn btn-outline btn-block" href={a.email ? `mailto:${a.email}` : undefined}
            style={a.email ? undefined : { opacity: 0.45, pointerEvents: "none" }}>
            <Icon name="mail" size={20} stroke={2} />Email
          </a>
        </div>
        <section className="card contact">
          <div className="contact-row">
            <span className="label">Phone</span>
            {a.phone ? <a href={telHref(a.phone)}>{a.phone}</a> : <span className="value">–</span>}
          </div>
          <div className="contact-row">
            <span className="label">Email</span>
            {a.email ? <a href={`mailto:${a.email}`}>{a.email}</a> : <span className="value">–</span>}
          </div>
          {a.notes && (
            <div className="contact-row">
              <span className="label">Notes</span>
              <span className="value" style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{a.notes}</span>
            </div>
          )}
        </section>
        <section className="section" style={{ gap: 10 }}>
          <h2 className="section-title">Properties ({homes.length})</h2>
          {homes.map((p) => (
            <a key={p.id} className="card mini-card" href={`#/property/${p.id}`}>
              <div className="row"><span className="addr">{p.address}</span><span className="price">{money(p.price)}</span></div>
              <div className="sub"><StatusPill status={p.status} small />{cardMeta(p, store)}</div>
            </a>
          ))}
          {homes.length === 0 && <p className="hint">No homes linked to this agent yet.</p>}
        </section>
      </main>
      {editing && <AgentSheet agent={a} store={store} onClose={() => setEditing(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
const shortName = (address) => {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return /^(flat|apartment|apt|unit|top|ground|first|second|garden|basement)\b/i.test(parts[0]) || /^\d+[a-z]?$/i.test(parts[0])
    ? parts[1] : parts[0];
};

function CompareScreen({ store }) {
  const candidates = sortHomes(store.properties.filter((p) => p.status !== "not_for_us"));
  const [ids, setIds] = useState(() => loadJSON("hh-compare", null));
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { if (ids) saveJSON("hh-compare", ids); }, [ids]);
  const chosen = (ids || candidates.slice(0, 3).map((p) => p.id))
    .map((id) => store.properties.find((p) => p.id === id)).filter(Boolean);
  const n = store.items.length;

  const rows = [
    { label: "Price", get: (p) => p.price, show: money, best: "min" },
    { label: "Size", get: (p) => p.size_sqft, show: (v) => `${v} sq ft`, best: "max" },
    { label: "£ per sq ft", get: (p) => (p.price && p.size_sqft ? Math.round(p.price / p.size_sqft) : null), show: (v) => `£${v}`, best: "min" },
    { label: "Beds / baths", get: (p) => (p.beds == null && p.baths == null ? null : (p.beds || 0) * 100 + (p.baths || 0)), show: (v, p) => `${p.beds ?? "–"} / ${p.baths ?? "–"}`, best: "max" },
    { label: "Tenure", get: (p) => p.tenure, show: (v) => v },
    { label: "Lease left", get: (p) => p.lease_years, show: (v) => `${v} yrs`, best: "max", warn: (p) => isShortLease(p, store.settings) },
    { label: "Service charge", get: (p) => p.service_charge, show: money, best: "min" },
    { label: "Ground rent", get: (p) => p.ground_rent, show: money, best: "min" },
    { label: "Council tax", get: (p) => p.council_tax, show: (v) => v, best: "min" },
    { label: "Running costs / mo", get: (p) => runningCosts(p, store.settings)?.monthly ?? null, show: money, best: "min" },
    { label: "Checklist", get: (p) => { const s = checklistScore(p, store.items); return s > 0 ? s : null; }, show: (v) => `${v}/${n}`, best: "max" },
    { label: "Latest offer", get: (p) => store.offersFor(p.id)[0]?.amount ?? null, show: (v, p) => `${money(v)} · ${OUTCOME[store.offersFor(p.id)[0].outcome]?.label.toLowerCase()}` },
  ];
  const isBest = (row, value, values) => {
    if (!row.best || value == null) return false;
    const present = values.filter((v) => v != null);
    if (present.length < 2 || present.every((v) => v === present[0])) return false;
    const sorted = [...present].sort((x, y) => (typeof x === "string" ? x.localeCompare(y) : x - y));
    return value === (row.best === "min" ? sorted[0] : sorted[sorted.length - 1]);
  };
  const cols = `86px repeat(${Math.max(chosen.length, 1)}, minmax(0, 1fr))`;

  return (
    <div className="screen">
      <header className="page-head">
        <div className="head-row" style={{ alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow">Our house hunt</p>
            <h1 className="title">Compare</h1>
          </div>
          {candidates.length > 1 && <button type="button" className="btn btn-outline btn-pill" onClick={() => setChoosing(true)}>Choose homes</button>}
        </div>
      </header>
      <main className="scroll">
        {chosen.length < 2 ? (
          <div className="empty">
            <Icon name="compare" size={40} stroke={1.4} />
            <h2>Nothing to compare yet</h2>
            <p>{candidates.length < 2 ? "Add at least two homes to compare them side by side." : "Choose two or three homes to compare."}</p>
          </div>
        ) : (
          <>
            <section className="card compare" aria-label="Comparison">
              <div className="compare-row head" style={{ gridTemplateColumns: cols }}>
                <span />
                {chosen.map((p) => (
                  <a key={p.id} className="compare-col" href={`#/property/${p.id}`}>
                    <Thumb url={store.photoUrl(p.photo_path)} size="100%" height={54} radius={8} />
                    <span className="name">{shortName(p.address)}</span>
                    <StatusPill status={p.status} small />
                  </a>
                ))}
              </div>
              {rows.map((row) => {
                const values = chosen.map(row.get);
                if (values.every((v) => v == null)) return null;
                return (
                  <div key={row.label} className="compare-row" style={{ gridTemplateColumns: cols }}>
                    <span className="label">{row.label}</span>
                    {chosen.map((p, i) => (
                      <span key={p.id} className={"cell" + (isBest(row, values[i], values) ? " best" : "") + (row.warn && row.warn(p) ? " warn" : "")}>
                        {values[i] == null ? "–" : row.show(values[i], p)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </section>
            <div className="legend-best">
              <span><i aria-hidden="true" />Best of the {chosen.length === 2 ? "two" : "three"}</span>
              <span><i aria-hidden="true" className="warn" />Short lease</span>
            </div>
          </>
        )}
      </main>
      {choosing && (
        <ChooseSheet candidates={candidates} selected={chosen.map((p) => p.id)} onClose={() => setChoosing(false)}
          onSave={(next) => { setIds(next); setChoosing(false); }} />
      )}
    </div>
  );
}

function ChooseSheet({ candidates, selected, onClose, onSave }) {
  const [picked, setPicked] = useState(selected);
  const toggle = (id) => setPicked((x) => {
    if (x.includes(id)) return x.filter((i) => i !== id);
    if (x.length >= 3) { toast("Pick up to three"); return x; }
    return [...x, id];
  });
  return (
    <Sheet title="Choose up to three" onClose={onClose} footer={<button type="button" className="btn btn-primary" onClick={() => onSave(picked)}>Compare</button>}>
      <div className="card option-list">
        {candidates.map((p) => (
          <button key={p.id} type="button" className="option" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
            <span className="check-box" style={picked.includes(p.id) ? { background: "#1E6A50", borderColor: "#1E6A50" } : undefined}>
              {picked.includes(p.id) && <Icon name="check" size={16} stroke={3} />}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span>{p.address}</span>
              <span className="hint" style={{ fontSize: 12 }}>{money(p.price)} · {STATUS[p.status].label}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function SettingsScreen({ store, session }) {
  const [list, setList] = useState(() => store.items.map((i) => ({ ...i })));
  const [busy, setBusy] = useState(false);
  const [lease, setLease] = useState(String(leaseLimit(store.settings)));
  const [tax, setTax] = useState(() => Object.fromEntries(BANDS.map((b) => [b, asText(store.settings.council_tax?.[b])])));
  useEffect(() => { setList(store.items.map((i) => ({ ...i }))); }, [store.items]);
  useEffect(() => {
    setLease(String(leaseLimit(store.settings)));
    setTax(Object.fromEntries(BANDS.map((b) => [b, asText(store.settings.council_tax?.[b])])));
  }, [store.settings]);
  const changed = JSON.stringify(list.map((i) => [i.id, i.label])) !== JSON.stringify(store.items.map((i) => [i.id, i.label]));
  const calendarKey = typeof store.settings.calendar_key === "string" ? store.settings.calendar_key : null;
  const feed = calendarKey ? calendarUrl(calendarKey).replace(/^https:/, "webcal:") : null;

  const move = (i, dir) => setList((l) => {
    const j = i + dir;
    if (j < 0 || j >= l.length) return l;
    const next = [...l];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const saveChecklist = async () => {
    setBusy(true);
    try { await store.saveItems(store.items, list); toast("Checklist saved"); }
    catch (e) { toast(e.message || "Couldn't save", "error"); }
    finally { setBusy(false); }
  };
  const saveCosts = async () => {
    setBusy(true);
    try {
      const amounts = {};
      BANDS.forEach((b) => { const v = toInt(tax[b]); if (v != null) amounts[b] = v; });
      await store.saveSetting("council_tax", amounts);
      await store.saveSetting("lease_warning_years", toInt(lease) || DEFAULT_LEASE_WARNING);
      toast("Saved");
    } catch (e) { toast(e.message || "Couldn't save", "error"); }
    finally { setBusy(false); }
  };
  const copyFeed = async () => {
    try { await navigator.clipboard.writeText(feed); toast("Link copied"); }
    catch (e) { window.prompt("Copy this link", feed); }
  };

  return (
    <div className="screen">
      <BackBar to={sessionStorage.getItem("hh-homes-view") === "map" ? "map" : "homes"} title="Settings" />
      <main className="scroll roomy">
        <section className="section">
          <h2 className="section-title">Viewing checklist</h2>
          <p className="hint">Changes apply to every home. Removing an item hides its ticks.</p>
          {list.map((item, i) => (
            <div key={item.id} className="item-row">
              <label htmlFor={"item-" + item.id} className="sr-only">Checklist item {i + 1}</label>
              <input id={"item-" + item.id} className="input" value={item.label}
                onChange={(e) => setList((l) => l.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><Icon name="up" size={20} /></button>
              <button type="button" className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}><Icon name="down" size={20} /></button>
              <button type="button" className="icon-btn" aria-label={`Remove ${item.label}`} onClick={() => setList((l) => l.filter((x) => x.id !== item.id))}><Icon name="trash" size={20} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-outline" onClick={() => setList((l) => [...l, { id: uuid(), label: "" }])}>
            <Icon name="plus" size={18} stroke={2.2} />Add item
          </button>
          <button type="button" className="btn btn-primary" onClick={saveChecklist} disabled={!changed || busy}>Save checklist</button>
        </section>

        <section className="section">
          <h2 className="section-title">Running costs and leases</h2>
          <p className="hint">Council tax per year for each band, from your council's website. Used for each home's monthly running costs.</p>
          <div className="band-grid">
            {BANDS.map((b) => (
              <Field key={b} label={`Band ${b}`} id={"band-" + b}>
                <MoneyInput id={"band-" + b} value={tax[b]} onChange={(v) => setTax((t) => ({ ...t, [b]: v }))} />
              </Field>
            ))}
          </div>
          <Field label="Warn me when the lease is under" id="lease-limit" hint="Years left. Leases below about 80 years cost more to extend.">
            <div className="suffix-input">
              <input id="lease-limit" className="input" inputMode="numeric" value={lease} onChange={(e) => setLease(e.target.value)} />
              <span>years</span>
            </div>
          </Field>
          <button type="button" className="btn btn-primary" onClick={saveCosts} disabled={busy}>Save</button>
        </section>

        <section className="section">
          <h2 className="section-title">Viewings in your calendar</h2>
          {feed ? (
            <>
              <p className="hint">Subscribe once on each phone and every booked viewing appears in Calendar, with the address and agent. Calendar checks for changes about once an hour.</p>
              <a className="btn btn-primary" href={feed}><Icon name="calendar" size={18} stroke={2} />Subscribe in Calendar</a>
              <button type="button" className="btn btn-outline" onClick={copyFeed}><Icon name="copy" size={18} stroke={2} />Copy link</button>
              <p className="hint">Keep this link private: anyone with it can see your viewings.</p>
            </>
          ) : <p className="hint">The calendar link isn't set up yet. Run the latest schema.sql in Supabase.</p>}
        </section>

        <section className="section">
          <h2 className="section-title">Account</h2>
          <p className="hint">Signed in as {session.user.email}</p>
          <button type="button" className="btn btn-outline" onClick={() => store.sync().then(() => toast("Up to date"))}>Refresh data</button>
          <button type="button" className="btn btn-danger" onClick={() => sb.auth.signOut()}>Sign out</button>
          <p className="hint">House Hunt {APP_VERSION}</p>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign in and the shell
// ---------------------------------------------------------------------------
function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(err.message === "Invalid login credentials" ? "That email and password don't match." : err.message);
    setBusy(false);
  };
  return (
    <form className="signin" onSubmit={submit}>
      <div>
        <p className="eyebrow">Our house hunt</p>
        <h1>Sign in</h1>
      </div>
      <p className="hint">Use the same login as the gym tracker.</p>
      <Field label="Email" id="email"><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Password" id="password"><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function Main({ session }) {
  const store = useHouseHunt();
  const route = useRoute();
  const [draft, setDraft] = useState(null);
  const memberKey = "hh-member-" + session.user.id;
  const [member, setMember] = useState(() => (localStorage.getItem(memberKey) === "yes" ? true : null));

  useEffect(() => {
    sb.rpc("hh_is_member").then(({ data, error }) => {
      if (error) return; // offline: trust the last answer
      setMember(data === true);
      localStorage.setItem(memberKey, data === true ? "yes" : "no");
    });
  }, [memberKey]);

  if (member === false) {
    return (
      <div className="center-msg">
        <Icon name="alert" size={40} stroke={1.6} />
        <p>This account isn't set up for the house hunt yet.<br />Add it to <code>hh_members</code> in Supabase.</p>
        <button type="button" className="btn btn-outline" onClick={() => sb.auth.signOut()}>Sign out</button>
      </div>
    );
  }

  let screen;
  let tab = null;
  switch (route.name) {
    case "map":
      screen = <Homes store={store} view="map" />; tab = "homes"; break;
    case "import": {
      const target = route.a ? store.properties.find((x) => x.id === route.a) : null;
      screen = route.a && !target
        ? (store.loaded ? <Redirect to="homes" /> : <p className="center-msg">Loading…</p>)
        : <ImportScreen key={route.a || "new"} store={store} setDraft={setDraft} target={target} />;
      break;
    }
    case "review":
      screen = draft ? <ReviewScreen key={draft.id + draft.mode} store={store} initial={draft} /> : <Redirect to="import" />; break;
    case "edit": {
      const p = store.properties.find((x) => x.id === route.a);
      screen = p ? <ReviewScreen key={"edit-" + p.id} store={store} initial={draftFromProperty(p)} />
        : store.loaded ? <Redirect to="homes" /> : <p className="center-msg">Loading…</p>;
      break;
    }
    case "property":
      screen = <PropertyScreen key={route.a} store={store} id={route.a} tab={route.b} />; tab = "homes"; break;
    case "agents":
      screen = <AgentsScreen store={store} />; tab = "agents"; break;
    case "agent":
      screen = <AgentScreen key={route.a} store={store} id={route.a} />; tab = "agents"; break;
    case "compare":
      screen = <CompareScreen store={store} />; tab = "compare"; break;
    case "settings":
      screen = <SettingsScreen store={store} session={session} />; tab = "homes"; break;
    default:
      screen = <Homes store={store} view="list" />; tab = "homes";
  }

  return (
    <div className="app">
      <SyncBar store={store} />
      {screen}
      {tab && <TabBar active={tab} />}
      <Toasts />
    </div>
  );
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="boot">Loading House Hunt…</div>;
  if (!session) return <SignIn />;
  return <Main key={session.user.id} session={session} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
