// House Hunt service worker
// Bump CACHE on every deploy (househunt-v1 → househunt-v2 …) so phones drop the old copy.
const CACHE = "househunt-v15";

const APP_FILES = [
  "./",
  "./index.html",
  "./app.jsx",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const LIBRARIES = [
  "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
  "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache each file on its own so one slow CDN file can't block the install.
    // App files skip Safari's own cache (GitHub lets it keep them for 10 minutes), so a new
    // version never installs with an old app.jsx.
    await Promise.all([
      ...APP_FILES.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})),
      ...LIBRARIES.map((url) => cache.add(url).catch(() => {})),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("househunt-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const CACHE_FIRST_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // App files: network first (so updates show straight away), fall back to the cached copy offline.
  // "no-cache" makes Safari check with GitHub every time rather than use its 10-minute copy;
  // when nothing has changed that check is tiny.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }
  // Libraries and fonts: cached copy first
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
  // Everything else (Supabase, map tiles, photos) goes straight to the network
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(new Request(req, { cache: "no-cache" }), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}
