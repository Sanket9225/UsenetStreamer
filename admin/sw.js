const CACHE_NAME = 'usenetstreamer-admin-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  '/assets/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(scopePath)) return;
  if (event.request.method !== 'GET') return;

  const pathname = url.pathname;
  const isAppShell = pathname.endsWith('/')
    || pathname.endsWith('/index.html')
    || pathname.endsWith('/app.js')
    || pathname.endsWith('/styles.css')
    || pathname.endsWith('/manifest.json');

  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
