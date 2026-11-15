const CACHE = 'my-finance-shell-v1.6.1';
const ASSETS = ['./','./index.html','./styles.css?v=1.6.1','./app.js?v=1.6.1','./insights.js?v=1.6.1','./dashboard.js?v=1.6.1','./records.js?v=1.6.1','./records-ui.js?v=1.6.1','./assistant.js?v=1.6.1','./assistant-ui.js?v=1.6.1','./import-v14.js?v=1.6.1','./vendor/pdf.min.mjs','./vendor/pdf.worker.min.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('my-finance-') && key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if(response.ok){ const copy=response.clone(); caches.open(CACHE).then(cache => cache.put(request,copy)); }
    return response;
  })));
});
