// Fotos a ZIP — service worker: funciona sense connexió i rep fotos compartides des de la Galeria
const VERSION = 'fz-v8';
const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'fz-shared').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Compartir des de la Galeria → desa les fotos i obre l'app
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const files = form.getAll('photos');
      const cache = await caches.open('fz-shared');
      let i = 0;
      for (const f of files) {
        if (!(f instanceof File)) continue;
        await cache.put(new Request(`./shared/${Date.now()}-${i++}`), new Response(f, { headers: {
          'content-type': f.type || 'application/octet-stream',
          'x-name': encodeURIComponent(f.name || `foto-${i}.jpg`),
          'x-modified': String(f.lastModified || Date.now())
        }}));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Primer la xarxa (per tenir sempre la darrera versió), si no hi ha connexió, la còpia guardada
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
