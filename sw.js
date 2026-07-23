// sw.js — offline support for "حاسبة الأهداف اليومية"
//
// Strategy:
// - App shell (the HTML page itself): cache-first, then update in the background
//   (stale-while-revalidate) so the app opens instantly offline and stays fresh online.
// - Everything else (XLSX lib, pdf.js lib + worker, Google Fonts CSS + font files):
//   cache-first with network fallback, cached the first time they're successfully
//   fetched. Once cached, they never need the network again.
//
// Bump CACHE_NAME whenever you change this file or want to force clients to refresh
// their cached app shell.
const CACHE_NAME = 'kpi-targets-cache-v1';

// Known third-party assets to warm the cache with as soon as the SW installs,
// so the very first offline run (even before the user has revisited every tab)
// already has them available.
const PRECACHE_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', (event) => {
  // Activate this SW as soon as it finishes installing, don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Also cache the page that registered this worker (whatever its real filename is),
      // so the very first offline load works even if the user hasn't reloaded since install.
      const shellUrl = self.registration.scope;
      const urls = [shellUrl, ...PRECACHE_URLS];
      return Promise.all(
        urls.map((url) =>
          fetch(url, { mode: 'cors' })
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                return cache.put(url, res);
              }
            })
            .catch(() => {
              // Ignore failures at install time (e.g. offline install, or a CORS-blocked
              // asset) — the fetch handler below will still try to cache it on first
              // successful runtime request.
            })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests; let everything else (if any) pass straight through.
  if (req.method !== 'GET') return;

  const isNavigation = req.mode === 'navigate' || req.destination === 'document';

  if (isNavigation) {
    // App shell: answer from cache immediately if we have it (instant offline load),
    // and in parallel fetch a fresh copy from the network to update the cache for
    // next time. If there's no cached copy yet and the network fails, we have
    // nothing to show — that's expected on a first-ever offline visit.
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else (CDN scripts, font CSS, font files, icons, etc.):
  // cache-first, falling back to network, and cache whatever the network gives us.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // No cache and no network — nothing we can do for this request.
          return cached;
        });
    })
  );
});
