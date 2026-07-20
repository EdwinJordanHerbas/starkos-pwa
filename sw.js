// OkiroSport — Service Worker
// Estrategia:
//  · Estáticos (css/js/iconos/fuentes): cache-first con actualización en segundo plano
//  · Navegación (index.html): network-first con fallback a caché (offline)
//  · API (/logs, /rutinas, ...): siempre red — nunca cachear datos
const VERSION = 'okiro-v3.0.6';
const STATIC_CACHE = `${VERSION}-static`;

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/css/styles.css',
  '/src/css/components.css',
  '/src/css/sections.css',
  '/src/css/animations.css',
  '/src/js/app.js',
  '/src/js/projects.js',
  '/src/js/gym.js',
  '/src/js/nutrition.js',
  '/src/js/ia.js',
  '/mock.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Rutas de API — nunca pasan por caché
const API_PREFIXES = ['/logs', '/proyectos', '/rutinas', '/ejercicios', '/sesiones',
                      '/nutricion', '/strava', '/notion', '/ia', '/auth', '/health'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      /* {cache:'reload'} fuerza descarga fresca, ignorando la caché HTTP */
      Promise.all(PRECACHE.map(url =>
        fetch(new Request(url, { cache: 'reload' }))
          .then(res => res.ok ? cache.put(url, res) : null)
          .catch(() => null)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo GET; el resto (POST/PUT/DELETE) va directo a red
  if (event.request.method !== 'GET') return;

  // API → siempre red (los datos nunca se sirven de caché)
  if (url.origin === location.origin &&
      API_PREFIXES.some(p => url.pathname === p || url.pathname.startsWith(p + '/'))) {
    return;
  }

  // Navegación → network-first, fallback al index cacheado (modo offline)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Estáticos (mismo origen + Google Fonts) → cache-first con revalidación
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetched = fetch(event.request)
        .then(res => {
          if (res.ok && (url.origin === location.origin || url.hostname.includes('gstatic') || url.hostname.includes('googleapis'))) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
