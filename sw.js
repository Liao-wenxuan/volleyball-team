/* ═══════════════════════════════════════════════════════════════
 * Service Worker：PWA 离线支持
 *
 * 策略
 * - 预缓存应用壳（页面 + 样式 + 脚本 + 图标）：装完即离线可用
 *   （业务数据本来就在 localStorage，不依赖网络）
 * - 页面导航：网络优先，失败回缓存
 * - 静态资源：网络优先，失败回缓存
 *   （原来是「缓存优先 + 后台更新」，结果改完代码用户第一次打开还是旧版，
 *     曾经把已修好的 bug 又复现了一遍；改成网络优先，联网时永远是最新代码）
 * - 跨域请求（AI 直连 DeepSeek 等）一律不拦，直接放行
 *
 * 发新版：把 VERSION 加一，旧缓存在 activate 时自动清掉。
 * ═══════════════════════════════════════════════════════════════ */
// v35: 多端轮询同步 + AI Key 服务端代理（浏览器不再拿明文 Key）
// v34: 阵型板标题跟阵型库统一（r33）；自由人进前排自动换牌 副攻2/副攻1
// v33: 训练后调整提示文案——部分登记考勤时明示还有多少人被隐藏
// v32: 登录默认地址跟站点走（修新设备登录静默失败）；训练后调整异常兜底可见
// v31: 登录时全量拉齐周数据（/api/weeks/all），新设备赛季统计不缺历史周
// v29: 登录态改按标签页隔离（sessionStorage），同浏览器两个标签可以各登一个队
// v28: 云端模式下「导入备份」真正写进服务器（POST /api/import，一个事务）
// v27: 管理端上线（/admin 独立入口）；修导航缓存污染（非主页导航不再写坏离线壳）
// v26: 头像菜单加退出登录 + 显示当前登录身份
// v25: 登录后可把本机数据搬到云端；队员性别入库
// v24: 账号体系 v2（删注册改发号、用户名登录、首登强制改密、账号管理页）
// v23: 登录门禁（公网进站先登录，file:/github.io 不挡）
// v22: 用户管理（角色/邀请码/成员管理/改密码/切队）
// v7: 分享弹窗加二维码（链接缩短 + 扫码进）
// v5: 训练卡 canvas；v4: 分享只读视图 share.js
const VERSION = 'v35';
const CACHE = `xgy-pwa-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './cloud.js',
  './qr.js',
  './card.js',
  './share.js',
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
          // 只有主页导航才刷新离线壳。任何 URL 都缓存成 ./index.html 的话，
          // 用户访问过 /admin 再断网，「离线打开教练端」会变成管理端页面
          if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同源静态资源：网络优先，断网回缓存
  // （联网时永远拿到最新代码；断网时仍有壳可开）
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
