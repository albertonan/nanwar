// Service worker de NanWar: guarda el juego en caché para jugar sin conexión.
// La página se pide primero a la red (así llegan las actualizaciones) y, si no hay conexión, sale de la caché.
// El resto de archivos sale de la caché y se refresca en segundo plano.
const CACHE = 'nanwar-v1';
const SHELL = [
    './',
    './index.html',
    './europa-data.js',
    './manifest.webmanifest',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-512.png',
    './icons/apple-touch-icon.png',
    './fonts/barlow-400-latin.woff2',
    './fonts/barlow-400-latin-ext.woff2',
    './fonts/barlow-600-latin.woff2',
    './fonts/barlow-600-latin-ext.woff2',
    './fonts/barlow-700-latin.woff2',
    './fonts/barlow-700-latin-ext.woff2'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => {
                    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                    return res;
                })
                .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(hit => {
            const network = fetch(req)
                .then(res => {
                    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                    return res;
                })
                .catch(() => hit);
            return hit || network;
        })
    );
});
