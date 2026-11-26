/* Private pages, auth, reservations and tokens are NEVER stored in Cache Storage. */
const CACHE='cpugrab-public-v2';
const STATIC=['/offline.html','/offline-catalog.js','/brand/logo.png','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)));});
// No skipWaiting: an existing checkout finishes on its current application version.
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cpugrab-public-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET')return;
 if(url.origin===self.location.origin&&request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));return;}
 const local=url.origin===self.location.origin&&(STATIC.includes(url.pathname)||url.pathname.startsWith('/images/')||url.pathname.startsWith('/icons/')||url.pathname.startsWith('/brand/')||/^\/_next\/static\/.*\.(?:js|css|woff2?)$/.test(url.pathname));
 const publicStorage=url.pathname.startsWith('/storage/v1/object/public/campus-images/');
 if(!local&&!publicStorage)return;
 event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());const keys=await cache.keys();if(keys.length>180){const removable=keys.find(k=>!STATIC.includes(new URL(k.url).pathname));if(removable)await cache.delete(removable);}}return response;}));
});
