// Service worker de la PWA de Crédito Vecino.
// - Navegación: red primero; sin conexión se sirve la última versión de la aplicación.
// - /assets/* (archivos con hash de Vite) e iconos: caché primero, son inmutables.
// - Fuentes de Google: se reutiliza la copia guardada y se actualiza en segundo plano.
// - /api/* y /mcp NUNCA se guardan: las cifras financieras siempre vienen del servidor.
const VERSION = 'cv-v1';
const CASCARON = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSION).then((c) => c.addAll(CASCARON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function redPrimero(peticion) {
  const cache = await caches.open(VERSION);
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) cache.put('/', respuesta.clone());
    return respuesta;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

async function cachePrimero(peticion) {
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) cache.put(peticion, respuesta.clone());
  return respuesta;
}

async function guardadaYActualizar(peticion) {
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(peticion);
  const red = fetch(peticion).then((r) => { if (r.ok || r.type === 'opaque') cache.put(peticion, r.clone()); return r; }).catch(() => guardada);
  return guardada ?? red;
}

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) return;
    if (request.mode === 'navigate') return evento.respondWith(redPrimero(request));
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return evento.respondWith(cachePrimero(request));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evento.respondWith(guardadaYActualizar(request));
  }
});
