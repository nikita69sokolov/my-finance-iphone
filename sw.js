const CACHE = 'my-finance-shell-v1.7.0';
const ASSETS = ['./','./index.html','./styles.css?v=1.7.0','./updates.js?v=1.7.0','./app.js?v=1.7.0','./insights.js?v=1.7.0','./dashboard.js?v=1.7.0','./funds.js?v=1.7.0','./funds-ui.js?v=1.7.0','./records.js?v=1.7.0','./records-ui.js?v=1.7.0','./assistant.js?v=1.7.0','./assistant-ui.js?v=1.7.0','./import-v14.js?v=1.7.0','./vendor/pdf.min.mjs','./vendor/pdf.worker.min.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('my-finance-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll({type:'window',includeUncontrolled:true})).then(clients=>clients.forEach(client=>client.postMessage({type:'APP_UPDATED',version:'1.7.0'}))));
});
self.addEventListener('message', event => {
  if(event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
async function freshNavigation(request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 4000);
  try {
    const response = await fetch(request, {cache:'no-cache', signal:abort.signal});
    if(response.ok){
      // Keep one offline entry, rather than every cache-busting navigation URL.
      try{await (await caches.open(CACHE)).put('./index.html',response.clone());}catch(_){}
      return response;
    }
  } catch(_) {}
  finally {clearTimeout(timer);}
  return await caches.match(request) || await caches.match('./index.html') || new Response('Приложение пока не доступно. Подключись к интернету и открой его ещё раз.', {status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if(request.mode === 'navigate') {
    const base = new URL('./', self.location.href);
    if([base.pathname,base.pathname+'index.html'].includes(new URL(request.url).pathname)) event.respondWith(freshNavigation(request));
    return;
  }
  if(request.cache === 'no-store') {event.respondWith(fetch(request));return;}
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));}
    return response;
  })));
});
