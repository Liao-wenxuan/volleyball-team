/* ═══════════════════════════════════════════════════════════════
 * Service Worker：PWA 离线支持
 *
 * 策略
 * - 预缓存应用壳（页面 + 样式 + 脚本 + 图标）：装完即离线可用
 *   （业务数据本来就在 localStorage，不依赖网络）
 * - 页面导航：网络优先，失败回缓存
 * - 静态资源：缓存优先，断网秒开。
 *   「发版拿到新代码」靠版本号：build.mjs 给 HTML 引用和本文件 SHELL 统一加 ?v=N，
 *   发版后 URL 变了缓存必然 miss，联网拉新版 → 不会复现「打开还是旧代码」。
 *   （曾经改成网络优先来防旧版，结果每次刷新都全量重下 160KB，跨境链路下刷新要好几秒）
 * - API 请求一律不拦（数据实时性靠服务器）
 * - 跨域请求（AI 直连 DeepSeek 等）一律不拦，直接放行
 *
 * 发新版：把 VERSION 加一，跑 node build.mjs（会同步刷新 HTML 引用和 SHELL 的 ?v=N）。
 * ═══════════════════════════════════════════════════════════════ */
// v57: 进站动线黑白化——加载页/门禁昼夜 token（昼白夜黑，随时间），星球开关切登录页背景
// v56: 页脚波浪跟主题走（原硬编码极光紫/青，r55 漏网）
// v55: 新增「排球」主题（暖棕+球衣蓝，与门禁同色板）并设为默认；老库 aurora 一次性迁移
// v54: 修门禁 logo 白爪画白底（浅色模式 color:#fff 特异性 (0,2,1) 压过暖棕 (0,2,0)）
// v53: 进站动线统一暖奶油排球风（加载页/遮罩/右栏表单全部去冷紫，跟主题解耦）
// v52: 登录门禁换排球猫（左侧猫主场跟手/回避/垮脸/欢呼，右侧表单不变；加密码明文切换）
// v36: 队员端改走「单文件档案」——分享弹窗直接下载 .html（断网可看，请假仍走回执码）；/m 停止宣传
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
const VERSION = 'v61';
const CACHE = `xgy-pwa-${VERSION}`;
// qr / xlsx / card / share / playercard 是「分享、导出、表格导入」才用的按需模块，
// 不放进预缓存——否则首次访问会在后台白下 37KB，抢本就稀薄的跨境带宽。
// 它们第一次被用到时由 fetch 处理器缓存（cache-first → 网络 → 存缓存）。
const SHELL = [
  './',
  './index.html',
  './style.css?v=v61',
  './app.js?v=v61',
  './cloud.js?v=v61',
  './manifest.webmanifest?v=v61',
  './assets/icon-192.png?v=v61',
  './assets/icon-512.png?v=v61',
  './assets/maskable-512.png?v=v61',
  './assets/loader-pose1.png?v=v61',
  './assets/loader-pose2.png?v=v61',
  './assets/loader-pose3.png?v=v61'
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
  // API 一律走网络，绝不缓存（数据实时性靠服务器，本地兜底没意义）
  if (url.pathname.startsWith('/api/')) return;

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

  // 静态资源：缓存优先，断网也能秒开。
  // 「发版拿到新代码」靠版本号：build.mjs 给 index.html 的引用和这里的 SHELL 都加 ?v=N，
  // HTML 本身网络优先，发版后 HTML 引用新 URL → 缓存必然 miss → 联网拉新版，不会复现旧版 bug。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
