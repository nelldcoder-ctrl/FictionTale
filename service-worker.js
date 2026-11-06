importScripts('./app-version.js');

const CACHE_NAME = `fictiontales-shell-v${self.FICTION_TALE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app-version.js',
  './storage.js',
  './script.js',
  './features.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  const networkFirst = request.destination === 'document'
    || request.destination === 'script'
    || request.destination === 'style'
    || /\.(html|js|css)$/i.test(url.pathname);

  if (networkFirst) {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw error;
      }

      if (response.ok && response.type === 'basic') {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {
          console.error('Failed to cache the network response:', error);
        }
      }
      return response;
    })());
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
