// Self-unregistering service worker
// When old production SW detects this as an update, it replaces itself with this no-op version
// which then clears all caches and unregisters
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
      .then(() => self.registration.unregister())
  );
});
