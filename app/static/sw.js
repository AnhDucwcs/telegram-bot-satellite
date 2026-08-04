const CACHE_NAME = 'sgn-route-v9';
const ASSETS_TO_CACHE = [
    '/static/index.html',
    '/static/app.css?v=4',
    '/static/app.js?v=12',
    'https://unpkg.com/ol@9.2.4/ol.css',
    'https://unpkg.com/ol@9.2.4/dist/ol.js',
    'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
    'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap',
    'https://unpkg.com/@phosphor-icons/web',
    'https://telegram.org/js/telegram-web-app.js'
];

// Install: cache all critical assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => {
            return self.skipWaiting();
        })
    );
});

// Activate: clean up old caches when version changes
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch: Cache-First strategy for static assets, Network-First for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API calls: always go to network
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/') || url.pathname.startsWith('/webhook')) {
        return;
    }

    // Static assets & CDN: cache-first
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cache immediately, but also update cache in background (stale-while-revalidate)
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                }).catch(() => {});
                return cachedResponse;
            }

            // Not in cache: fetch from network and cache it
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            });
        })
    );
});
