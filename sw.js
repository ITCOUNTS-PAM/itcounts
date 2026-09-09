/* ITCOUNTS NOTE · Service Worker
   策略：页面(导航)与 version.json 走「网络优先」，拿不到再回退缓存(离线兜底)；
   其余静态资源走「缓存优先 + 后台更新」。每次发布把 CACHE 版本号 +1，旧缓存自动清除。 */
var CACHE = 'itcounts-note-v85';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(CORE);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
    /* V.69：强制所有打开的页面重载到新版本——
       旧客户端没有 controllerchange 监听器（V.68 initVersion 才加的），新 SW 接管后 controllerchange
       触发但旧页面没处理，于是永远卡在旧版本上看到旧 bug。SW 层 client.navigate 无论客户端什么版本
       都会被重载；导航请求已被本 SW 设为 cache:'no-store' 直连网络，拿到的是全新 index.html。
       activate 只在版本号变更时触发一次，正常使用无影响。 */
    .then(function () {
      return self.clients.matchAll({ type: 'window' }).then(function (cs) {
        cs.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var isNav = e.request.mode === 'navigate';
  var isVersion = url.pathname.endsWith('version.json');

  if (isNav || isVersion) {
    /* V.57：服务器不返回 Cache-Control 头，浏览器会用「启发式缓存」把旧 index.html
       缓存很久 —— 导致 PAM 刷新多次仍看到旧页面（V.56 的 C 步骤日期没消失）。
       修法：导航/version.json 一律 cache:'no-store' 直连网络，绕过 HTTP 缓存。 */
    var netReq = new Request(e.request, { cache: 'no-store' });
    e.respondWith(
      fetch(netReq).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (m) { return m || caches.match('./index.html'); });
      })
    );
  } else {
    // 静态资源：缓存优先 + 后台刷新
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        var fetched = fetch(e.request).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || fetched;
      })
    );
  }
});
