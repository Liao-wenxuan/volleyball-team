/* ═══════════════════════════════════════════════════════════════
 * Service Worker：PWA 离线支持
 *
 * 策略
 * - 预缓存应用壳（页面 + 样式 + 脚本 + 图标）：装完即离线可用
 *   （业务数据本来就在 localStorage，不依赖网络）
 * - 导航请求：网络优先，失败回缓存 → 有网时总能拿到新版
 * - 静态资源：缓存优先 + 后台更新（stale-while-revalidate）
 * - 跨域请求（AI 直连 DeepSeek 等）一律不拦，直接放行
 *
 * 发新版：把 VERSION 加一，旧缓存在 activate 时自动清掉。
 * ═══════════════════════════════════════════════════════════════ */
const VERSION = 'v1';
const CACHE = `xgy-pwa-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './cloud.js',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  // 跨域（AI 接口等）不拦
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，断网回缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同源静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
