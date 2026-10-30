/*
 * Verdigris Sky Duel - service worker: makes the game installable and playable offline.
 *
 * - Game files (same origin): network first, so a new deploy shows up on the next load;
 *   the cached copy is used when offline or when the network is slower than NET_TIMEOUT.
 * - Versioned CDN libraries and fonts: cache first (their URLs never change content).
 * - Everything else (PeerJS signalling for co-op) goes straight to the network.
 * Bump VERSION only when the list of precached files changes.
 */
const VERSION = 'vsd-v6';
const NET_TIMEOUT = 4000;
const SHELL = [
  './', 'index.html', 'i18n.js', 'pwa.js', 'manifest.webmanifest',
  'mp/', 'mp/index.html', 'mp/game.js', 'mp/sim.js',
  'campaign/', 'campaign/index.html', 'campaign/game.js', 'shared/dragon.js',
  'campaign/core/umd.js', 'campaign/core/math.js', 'campaign/core/events.js', 'campaign/core/data.js',
  'campaign/core/terrain.js', 'campaign/core/growth.js', 'campaign/core/hunger.js', 'campaign/core/flight.js', 'campaign/core/prey.js', 'campaign/core/region.js', 'campaign/core/lair.js', 'campaign/core/state.js', 'campaign/core/save.js',
  'campaign/render/flora.js', 'campaign/render/terrain.js', 'campaign/render/prey-view.js', 'campaign/render/hatch-scene.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
];
const CACHE_FIRST_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com'];
const SWR_HOSTS = ['fonts.googleapis.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    // Libraries are best effort: a CDN hiccup must not block installing the game.
    await Promise.all(LIBS.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && cache.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('vsd-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req, url)); return; }
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) { event.respondWith(cacheFirst(req)); return; }
  if (SWR_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(req)); }
});

async function networkFirst(req, url) {
  const cache = await caches.open(VERSION);
  // ?lang=cs and similar must still find the cached page.
  const key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req;
  const network = fetch(req).then(res => {
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });
  network.catch(() => {}); // a late failure after the timeout is not an error
  const timeout = new Promise(resolve => setTimeout(resolve, NET_TIMEOUT));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (_) { /* offline - fall through to cache */ }
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  return network; // nothing cached yet: wait for the network after all
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
  return cached || network;
}
