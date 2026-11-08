// Service Worker: macht die App installierbar und offline startfähig.
// Eigene Dateien: erst Netzwerk (damit Updates sofort ankommen), sonst Cache.
// Firebase-SDK (versioniert): erst Cache.
const VERSION = 'fv-v6';
const SHELL = [
  './', './index.html', './css/styles.css', './js/app.js', './js/util.js', './js/tmdb.js',
  './firebase-config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' umgeht den 10-Minuten-Cache von GitHub Pages
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + '-lib').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      // 'no-cache' = immer beim Server nachfragen, ob es eine neuere Version gibt
      fetch(req, { cache: 'no-cache' }).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(
      caches.open(VERSION + '-lib').then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; })))
    );
  }
});
