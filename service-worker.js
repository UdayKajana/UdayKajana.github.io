const SHELL_CACHE = 'kajana-shell-v6';
const SHELL_FILES = [
  './',
  './index.html',
  './application.html',
  './language-studio.html',
  './manifest.webmanifest',
  './firebase-config.js',
  './js/device-cache.js',
  './js/dictionary-cards.js',
  './js/dom.js',
  './js/firebase-init.js',
  './js/icons.js',
  './js/main.js',
  './js/quick-add.js',
  './js/reading.js',
  './js/script-practice.js',
  './js/section-notes.js',
  './js/sections.js',
  './js/speech.js',
  './js/state.js',
  './js/translate.js',
  './js/utils.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('kajana-shell-') && key !== SHELL_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isStaticAsset = ['script', 'style', 'font'].includes(request.destination);

  if (url.origin !== self.location.origin) {
    if (!isStaticAsset) return;
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request).then(async response => {
        if (response.ok || response.type === 'opaque') {
          try {
            await cache.put(request, response.clone());
          } catch (error) {
            console.warn('Could not cache a static asset.', error);
          }
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(error => console.warn('Could not refresh cached static asset.', error)));
        return cached;
      }
      return network;
    })());
    return;
  }

  if (/\.json$/.test(url.pathname) || url.pathname.includes('/.json')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        event.waitUntil(caches.open(SHELL_CACHE)
          .then(cache => cache.put(request, response.clone()))
          .catch(error => console.warn('Could not cache an app page.', error)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const fallback = url.pathname.endsWith('/language-studio.html')
        ? './language-studio.html'
        : (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')
          ? './index.html'
          : './application.html');
      return (await caches.match(fallback)) || new Response('This page is not available offline yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }));
    return;
  }

  if (isStaticAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) {
        event.waitUntil(fetch(request).then(response => {
          if (response.ok) return cache.put(request, response.clone());
        }).catch(error => console.warn('Could not refresh cached app asset.', error)));
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) {
        try {
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn('Could not cache an app asset.', error);
        }
      }
      return response;
    })());
  }
});
