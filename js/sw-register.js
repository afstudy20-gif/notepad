// Register service worker for PWA install + offline shell.
// SW uses network-first for HTML/JS so updates roll out without manual refresh.
// Externalized from an inline <script> so the page can enforce a strict
// script-src CSP (no 'unsafe-inline').
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=114').catch((err) => {
      console.warn('[sw] register failed', err);
    });
  });
}
