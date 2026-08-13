// OKIRO — Service Worker
// Estrategia:
//  · Estáticos (css/js/iconos/fuentes): cache-first con actualización en segundo plano
//  · Navegación (index.html): network-first con fallback a caché (offline)
//  · API (/logs, /rutinas, ...): siempre red — nunca cachear datos
//
// Este archivo estuvo guardado con la codificación rota (las tildes salían
// como dos símbolos), y no era solo cosa de los comentarios: el texto de aviso
// de más abajo es el que sale en la notificación si el push llega sin
// contenido. Lo vigila tools/test-codificacion.js.
const VERSION = 'okiro-v7.3.0';
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
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/ejercicios.json'    // catálogo de técnica: se quiere disponible en el gimnasio
];

// Rutas de API — nunca pasan por caché
const API_PREFIXES = ['/logs', '/proyectos', '/rutinas', '/ejercicios', '/sesiones',
                      '/nutricion', '/strava', '/notion', '/ia', '/auth', '/health',
                      '/resumen', '/push', '/cruce', '/party', '/tareas', '/medidas', '/mision', '/progreso'];   // /resumen faltaba: se cacheaba el dashboard de HOY como si fuera estático

// ...salvo la técnica, que cuelga de /ejercicios pero son archivos fijos: las
// animaciones (media) y los vídeos de persona real (video). Ninguno cambia de
// contenido nunca, así que se quedan guardados. Es lo que hace que la técnica
// se vea al instante en el gimnasio, donde la cobertura es mala — y que un
// clip de 330 KB se descargue una sola vez en la vida.
const MEDIA_PREFIXES = ['/ejercicios/media/', '/ejercicios/video/'];

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

// ── MISIÓN DIARIA (push) ─────────────────────────────────────────────────
// El sistema avisa, no anima: título y cuerpo llegan ya redactados del backend.
self.addEventListener('push', (event) => {
  let d = { titulo: 'OKIRO', cuerpo: 'Misión diaria disponible.' };
  try { d = { ...d, ...event.data.json() }; } catch { /* payload vacío: valores por defecto */ }
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

  // Medias de técnica → cache-first de verdad: si ya está, ni se pregunta
  if (url.origin === location.origin && MEDIA_PREFIXES.some(p => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      }))
    );
    return;
  }

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
