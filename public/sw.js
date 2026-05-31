/**
 * pfd-saas service worker — Sprint 2 Phase 4.
 *
 * Minimal PWA shell. Three concerns:
 *
 *  1. Install. Pre-cache the offline fallback page + the app icon. We
 *     do NOT pre-cache HTML / API responses — those need to stay fresh.
 *
 *  2. Activate. Wipe any old cache versions so a SW update actually
 *     takes effect.
 *
 *  3. Fetch. Strategy:
 *       - non-GET                  → straight to network (don't cache POST/PATCH/DELETE)
 *       - /api/*                   → network-first, no cache fallback (data must be fresh; offline = let the page handle the error)
 *       - /_next/static/* + /icon* → cache-first (immutable bundles + icon)
 *       - HTML navigations          → network-first, offline.html on failure
 *       - everything else           → network, cache the response opportunistically
 */

const CACHE_VERSION = 'pfd-saas-v1';
const PRECACHE_URLS = ['/offline.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs. Anything else goes to the network
  // untouched so we don't accidentally intercept Auth.js callbacks or
  // Yahoo Finance fetches.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API calls: prefer fresh data. If offline, surface the failure to
  // the caller (route handlers return 401/500; the page renders the
  // error). We don't cache /api/* responses — they're tenant-specific
  // and time-sensitive.
  if (url.pathname.startsWith('/api/')) {
    return; // network default
  }

  // Static bundles + icon — immutable. Cache first, then network.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((resp) => {
            // Only cache successful responses.
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
            }
            return resp;
          })
        );
      }),
    );
    return;
  }

  // HTML navigations — network first, offline page on failure.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html').then((r) => r ?? new Response('Offline', { status: 503 }))),
    );
    return;
  }

  // Everything else: try network, fall back to cache if present.
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r ?? new Response('Offline', { status: 503 }))),
  );
});
