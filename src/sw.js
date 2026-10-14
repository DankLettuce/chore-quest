// Service worker: caches the app shell so it opens offline. Check-offs made offline are
// queued in localStorage by the app and retried when the connection is back.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `chores-${VERSION}`;

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live

  if (req.mode === 'navigate') {
    // network first so updates land; fall back to the cached shell (ignoring ?k=...)
    e.respondWith(fetch(req).catch(async () => (await caches.match('/', { ignoreSearch: true })) || Response.error()));
    return;
  }
  if (url.pathname === '/manifest.webmanifest') {
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
