// Service Worker: PWA install + offline support.
// Strategy:
//   - HTML/JS/CSS (app shell): network-first, fallback cache
//   - Static icons + vendor libs: cache-first
//   - Cross-origin (CDN libs): cache opaque responses, cache-first fallback
const VERSION = 'v53';
const CACHE = `notepad-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './install.html',
  './style.css?v=53',
  './app.js?v=53',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './widgets/new-note-card.json',
  './widgets/new-note-data.json',
  './vendor/mammoth.browser.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/html2pdf.bundle.min.js',
  './vendor/html-docx.js'
];

// CDN libs to lazy-cache on first request (kept opaque)
const CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'tessdata.projectnaptha.com'
]);

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

  // Cross-origin CDN libs: cache-first with opaque responses
  if (url.origin !== location.origin) {
    if (CDN_HOSTS.has(url.hostname)) {
      e.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req, { mode: 'no-cors' });
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline and not cached' });
        }
      })());
    }
    return; // other cross-origin → browser default
  }

  // Network-first for HTML and same-origin scripts/styles
  if (req.mode === 'navigate' || /\.(html|js|mjs|css)(\?.*)?$/i.test(url.pathname)) {
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

  // Cache-first for icons, vendor libs, and other static assets
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
