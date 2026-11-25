// Brewlab service worker — makes the app installable and lets the shell open offline.
// Data is never cached: /api/* and /uploads/* always go to the network, so the app can't
// show stale stash / brew data. Hashed build assets are cache-first (their URLs change
// every build); the page itself is network-first with the cached copy as offline fallback.
// Every cache write is inside event.waitUntil: iOS stops a service worker as soon as the response
// is sent, so a write outside it can be lost — and the offline copy would stay an old version.
const CACHE = "brewlab-shell-v5"; // bump when shell files (icons, manifest) change — or to drop an old cached page
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.png", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return; // always live

  // Each fetch is split once, before anything reads it: one copy for the page, one for the cache.
  const fetchTwo = () => fetch(req).then((res) => ({ page: res, keep: res.ok ? res.clone() : null }));
  const store = (key, keep) => (keep ? caches.open(CACHE).then((c) => c.put(key, keep)) : null);

  // Page navigations: network first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    const net = fetchTwo();
    event.respondWith(net.then((r) => r.page, () => caches.match("/")));
    event.waitUntil(net.then((r) => store("/", r.keep), () => {}));
    return;
  }

  // Content-hashed build assets: cache first.
  if (url.pathname.startsWith("/assets/")) {
    const got = caches.match(req).then((hit) => (hit ? { page: hit, keep: null } : fetchTwo()));
    event.respondWith(got.then((r) => r.page));
    event.waitUntil(got.then((r) => store(req, r.keep), () => {}));
    return;
  }

  // Icons / manifest: stale-while-revalidate.
  const net = fetchTwo();
  event.respondWith(caches.match(req).then((hit) => hit || net.then((r) => r.page)));
  event.waitUntil(net.then((r) => store(req, r.keep), () => {}));
});
