// Service Worker: PWA install + offline shell.
// Strategy:
//   - HTML/JS/CSS (app shell): network-first, fall back to cache when offline
//   - Static icons: cache-first
//   - Cross-origin (CDN libs): bypass — let browser handle
const VERSION = 'v37';
const CACHE = `notepad-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './style.css?v=37',
  './app.js?v=37',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // skip CDN libs

  // Network-first for HTML and same-origin scripts/styles
  if (req.mode === 'navigate' || /\.(html|js|css)(\?.*)?$/i.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match('./index.html');
      }
    })());
    return;
  }

  // Cache-first for icons and other static assets
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
