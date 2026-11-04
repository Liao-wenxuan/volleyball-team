/* 队员端专用 SW（作用域 /m/，注册地址是 /m/sw.js，作用域天然不越界）。
 * 与主站 sw 互不干扰：主站的 v31 壳只管教练端页面。
 * 策略：
 * - 页面导航（/m）：网络优先，断网回缓存
 * - 同源静态资源（图标等）：网络优先，失败回缓存
 * - /api/*：一律不缓存（数据实时性优先）
 */
const VERSION = 'm2';
const CACHE = `xgy-m-${VERSION}`;
const SHELL = ['./', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 数据不缓存

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.startsWith('/assets/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline'))))
  );
});
