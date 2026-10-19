// Service worker de NanWar: guarda el juego en caché para jugar sin conexión.
// La página, el mapa y el manifiesto se piden siempre a la red (saltándose la caché HTTP), así que con conexión
// siempre llega la última versión; sin conexión salen de la copia guardada. Iconos y tipografía no cambian: caché.
// version.json nunca se guarda: la página lo consulta para saber si hay una versión nueva.
// VERSION la escribe tools/release.mjs en cada publicación (cambiarla hace que el navegador instale este worker de nuevo).
const VERSION = '2026.10.19-164329';
const CACHE = `nanwar-${VERSION}`;
const SHELL = [
    './',
    './index.html',
    './europa-data.js',
    './vista-realista.js',
    './relieve.png',
    './mundo-data.js',
    './relieve-mundo.png',
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
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'no-cache' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request, url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.endsWith('/version.json')) return;   // siempre a la red, nunca a la caché

    const store = res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
    };

    if (/\/(icons|fonts)\//.test(url.pathname)) {
        event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(store)));
        return;
    }

    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then(store)
            .catch(() => caches.match(req, { ignoreSearch: true })
                .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
});
