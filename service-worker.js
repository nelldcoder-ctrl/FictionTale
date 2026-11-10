importScripts('./app-version.js');

const CACHE_NAME = `fictiontales-shell-v${self.FICTION_TALE_VERSION}`;
// Files the app cannot run offline without. If one of these is missing, installation fails on purpose.
const CORE_FILES = [
  './',
  './index.html',
  './styles.css',
  './app-version.js',
  './storage.js',
  './script.js',
  './features.js',
];

// Nice to have offline (icons, fonts, manifest). A missing file here is logged but never blocks installation.
const OPTIONAL_FILES = [
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './fonts/eb-garamond-400-normal.woff2',
  './fonts/eb-garamond-500-normal.woff2',
  './fonts/eb-garamond-600-normal.woff2',
  './fonts/eb-garamond-400-italic.woff2',
  './fonts/eb-garamond-500-italic.woff2',
  './fonts/karla-400-normal.woff2',
  './fonts/karla-600-normal.woff2',
];

async function cacheAll(cache, urls) {
  const results = await Promise.allSettled(urls.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  return urls.filter((url, index) => results[index].status === 'rejected');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const missingCore = await cacheAll(cache, CORE_FILES);
    if (missingCore.length) {
      throw new Error(`Required files could not be cached: ${missingCore.join(', ')}`);
    }
    const missingOptional = await cacheAll(cache, OPTIONAL_FILES);
    if (missingOptional.length) {
      console.warn('Fiction Tale: these optional files were not cached (check they exist on the server):', missingOptional.join(', '));
    }
    await self.skipWaiting();
  })());
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
