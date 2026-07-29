// OkiroSport â€” Service Worker
// Estrategia:
//  Â· EstÃ¡ticos (css/js/iconos/fuentes): cache-first con actualizaciÃ³n en segundo plano
//  Â· NavegaciÃ³n (index.html): network-first con fallback a cachÃ© (offline)
//  Â· API (/logs, /rutinas, ...): siempre red â€” nunca cachear datos
const VERSION = 'okiro-v6.6.0';
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

// Rutas de API â€” nunca pasan por cachÃ©
const API_PREFIXES = ['/logs', '/proyectos', '/rutinas', '/ejercicios', '/sesiones',
                      '/nutricion', '/strava', '/notion', '/ia', '/auth', '/health',
                      '/resumen', '/push', '/cruce', '/party', '/tareas', '/medidas'];   // /resumen faltaba: se cacheaba el dashboard de HOY como si fuera estatico

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      /* {cache:'reload'} fuerza descarga fresca, ignorando la cachÃ© HTTP */
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

// â”€â”€ MISIÃ“N DIARIA (push) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// El sistema avisa, no anima: tÃ­tulo y cuerpo llegan ya redactados del backend.
self.addEventListener('push', (event) => {
  let d = { titulo: 'OKIRO', cuerpo: 'MisiÃ³n diaria disponible.' };
  try { d = { ...d, ...event.data.json() }; } catch { /* payload vacÃ­o: valores por defecto */ }
  event.waitUntil(
    self.registration.showNotification(d.titulo, {
      body: d.cuerpo,
      icon:  '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      tag:   'okiro-mision',        // reemplaza el aviso anterior en vez de apilarlo
      renotify: false,
      requireInteraction: false
    })
  );
});

// Al tocar el aviso: reutilizar la ventana abierta si la hay, no abrir otra
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo GET; el resto (POST/PUT/DELETE) va directo a red
  if (event.request.method !== 'GET') return;

  // API â†’ siempre red (los datos nunca se sirven de cachÃ©)
  if (url.origin === location.origin &&
      API_PREFIXES.some(p => url.pathname === p || url.pathname.startsWith(p + '/'))) {
    return;
  }

  // NavegaciÃ³n â†’ network-first, fallback al index cacheado (modo offline)
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

  // EstÃ¡ticos (mismo origen + Google Fonts) â†’ cache-first con revalidaciÃ³n
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
