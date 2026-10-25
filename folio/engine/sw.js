// Offline support: the shell and all content are cached on install. Content is refreshed in the background.
const VERSION = '{{VERSION}}';
const PRECACHE = {{PRECACHE_RAW}};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fresh;
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(VERSION)).put(request, res.clone());
    return res;
  } catch (err) {
    if (request.mode === 'navigate') return (await caches.match('./')) || Response.error();
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isContent = url.pathname.includes('/content/') || url.pathname.endsWith('/search-index.json');
  event.respondWith(isContent ? staleWhileRevalidate(request) : cacheFirst(request));
});
