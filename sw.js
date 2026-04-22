// Minimal SW: PWA install only, no fetch caching (avoids stale app code).
const CACHE = 'notepad-v17';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
// No fetch handler → browser default network behavior. PWA install still works.
