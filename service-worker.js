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
const CORE_PATHS = new Set(CORE_FILES.map((file) => new URL(file, self.location).pathname));

// Nice to have offline (documentation, icons, fonts, manifest). Missing files never block installation.
const OPTIONAL_FILES = [
  './manifest.json',
  './content/changelogs.md',
  './content/tutorial/quick-start.md',
  './content/tutorial/detailed-guide.md',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './screenshots/fiction-tale-desktop.png',
  './screenshots/fiction-tale-mobile.png',
  './fonts/eb-garamond-400-normal.woff2',
  './fonts/eb-garamond-500-normal.woff2',
  './fonts/eb-garamond-600-normal.woff2',
  './fonts/eb-garamond-400-italic.woff2',
  './fonts/eb-garamond-500-italic.woff2',
  './fonts/karla-400-normal.woff2',
  './fonts/karla-600-normal.woff2',
];
const DOCUMENTATION_PATHS = new Set([
  './content/changelogs.md',
  './content/tutorial/quick-start.md',
  './content/tutorial/detailed-guide.md',
].map((file) => new URL(file, self.location).pathname));

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
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (DOCUMENTATION_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(new Request(request, { cache: 'no-cache' }));
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set('X-FictionTale-Documentation-Source', 'cache');
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
        throw error;
      }

      if (response.ok && response.type === 'basic') {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {
          console.error('Failed to cache the documentation network response:', error);
        }
      }
      return response;
    })());
    return;
  }
  if (CORE_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(new Request(request, { cache: 'no-cache' }));
        if (response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

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

