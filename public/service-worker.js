const VERSION = "v2";
const SHELL_CACHE = `cricket-shell-${VERSION}`;
const RUNTIME_CACHE = `cricket-runtime-${VERSION}`;
const PRECACHE = ["/players", "/teams", "/turfs", "/tcl", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"];
const CDN = /(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|res\.cloudinary\.com)$/;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(PRECACHE.map(async (url) => {
      const res = await fetch(url);
      if (res.ok && !res.redirected) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const MATCH_OPTS = { ignoreSearch: true, ignoreVary: true };

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function cacheFirst(req) {
  const cached = await caches.match(req, MATCH_OPTS);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

// Network first so online users always get fresh pages/scripts; the cache
// is only used when the network fails or takes longer than 4 seconds.
async function networkFirst(req, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetchWithTimeout(req, 4000);
    const cacheable = res.ok && !res.redirected && (req.mode !== "navigate" || !url.search);
    if (cacheable) {
      const isAsset = /\.(css|js)$/.test(url.pathname);
      // css/js URLs carry ?t=Date.now(), so key them by path only
      cache.put(isAsset ? url.origin + url.pathname : req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req, MATCH_OPTS);
    if (cached) return cached;
    if (req.mode === "navigate") {
      return new Response(
        "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='font-family:sans-serif;background:#1f1f1f;color:#fff;padding:2rem'><h2>You're offline</h2><p>This page hasn't been opened on this device yet. Open it once with internet, then it will work offline.</p>",
        { headers: { "Content-Type": "text/html" } }
      );
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (CDN.test(url.hostname)) event.respondWith(cacheFirst(req));
    return;
  }
  if (/^\/(assets|icons|images|uploads)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req, url));
});