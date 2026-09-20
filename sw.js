const CACHE_NAME = 'item-storage-v1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './search.js',
  './manifest.json',
  './icon.svg',
  'https://cdn.jsdelivr.net/npm/pinyin-match/dist/main.js',
  'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js'
];

// Install Service Worker and cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate Service Worker and clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch listener - Network-first with Cache fallback for standard files,
// and Cache-first for vendor scripts/assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // For CDN vendor scripts, cache first
  if (url.host === 'cdn.jsdelivr.net' || url.pathname.endsWith('.svg')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
  } else {
    // Network first, fallback to cache
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache the successful response
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  }
});