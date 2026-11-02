// Network first, so updates arrive at once; the cache makes the app open offline.
const PREFIX = 'macros-'; // other apps can share this origin, so touch only these caches
const CACHE = PREFIX + 'v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'vendor/zxing.min.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub and Open Food Facts go straight to the network
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (!res.ok) return cached().then((c) => c || res); // keep a working copy instead of an error page
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(cached)
  );
});
