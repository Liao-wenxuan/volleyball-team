/* ============================================================
 * core —— 工具 / 常量 / 按需加载的模块
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 工具 ══════════ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const roundHalf = (v) => Math.round(Number(v) * 2) / 2;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let uidSeq = 0;
  const BUILD = '2026-11-14 · r35.17'; // 每次改版手动加一，页脚会显示，用来确认「跑的是哪一版」
  const uid = (p) => `${p}_${Date.now().toString(36)}_${(++uidSeq).toString(36)}`;
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ══════════ 常量 ══════════ */
  const DB_KEY = 'xgy_volleyball_v2';

  /* 云端模式下按球队分桶存本机缓存：同一个浏览器开两个标签登两个队时，
   * 缓存不会互相覆盖（否则断网时会读到另一个队的名单）。
   * 未登录的本地模式不加后缀，原数据原封不动。
   * 必须读实时 storage 而不是内存里的 db —— loadDB 跑在 cloud.js attach 之前，
   * 所以走 XGYCloud.dbScope()（它直接从 sessionStorage/localStorage 算）。 */
  function dbKey() {
    const c = window.XGYCloud;
    return DB_KEY + (c && typeof c.dbScope === 'function' ? c.dbScope() : '');
  }

  /* ══════════ 按需加载的模块 ══════════
   * qr / xlsx / card / share / playercard / courtcard 只有「分享、导出、表格导入」时才用得到，
   * 冷启动不再跟着下载（省约 37KB gzip，跨境链路下就是好几秒）。
   * 版本号从自己的 script src 里取，保证和 index.html 的 ?v=N 一致；
   * 单文件版里这些模块是内联的，window.XGY* 已存在，直接 resolve。 */
  const ASSET_VER = (() => {
    try {
      const s = document.currentScript && document.currentScript.src;
      return s ? (new URL(s).searchParams.get('v') || '') : '';
    } catch (e) { return ''; }
  })();
  const MODS = {
    qr: ['qr.js', 'XGYQR'],
    xlsx: ['xlsx.js', 'XGYXlsx'],
    card: ['card.js', 'XGYCard'],
    share: ['share.js', 'XGYShare'],
    playercard: ['playercard.js', 'XGYPlayerCard'],
    courtcard: ['courtcard.js', 'XGYCourt']
  };
  const modPending = {};
  function ensureMod(...names) {
    return Promise.all(names.map((n) => new Promise((resolve, reject) => {
      const spec = MODS[n];
      if (!spec) return reject(new Error(`未知模块 ${n}`));
      const [file, globe] = spec;
      if (window[globe]) return resolve();
      if (modPending[n]) return modPending[n].then(resolve, reject);
      const s = document.createElement('script');
      s.src = file + (ASSET_VER ? '?v=' + ASSET_VER : '');
      s.async = true;
      modPending[n] = new Promise((ok, fail) => {
        s.onload = () => (window[globe] ? ok() : fail(new Error(`${n} 模块异常`)));
        s.onerror = () => fail(new Error(`${n} 模块加载失败，检查网络后重试`));
      });
      document.head.appendChild(s);
      modPending[n].then(resolve, reject);
    })));
  }
  const SCHEMA = 2;
  const SKILLS = [
    { key: 'serve', label: '发球' },
    { key: 'receive', label: '一传' },
    { key: 'set', label: '二传' },
    { key: 'spike', label: '扣球' },
    { key: 'block', label: '拦网' },
    { key: 'defense', label: '防守' }
  ];
  const POSITIONS = ['主攻', '副攻', '二传', '接应', '自由人'];
  const GRADES = ['大一', '大二', '大三', '大四', '研一', '研二', '研三'];
  const ROLE_STYLE = {
    '主攻': ['#ff8a5c', '#ffc46b'],
    '副攻': ['#7b6cff', '#4aa8ff'],
    '二传': ['#46e0ff', '#37e39b'],
    '接应': ['#fb7299', '#ff9d6e'],
    '自由人': ['#37e39b', '#b8f06a']
  };
  const DEFAULT_TEMPLATE = [
    { id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '' },
    { id: 'fri', day: 5, label: '周五', start: '16:30', end: '18:30', venue: '' },
    { id: 'sun', day: 0, label: '周日', start: '08:30', end: '11:30', venue: '' }
  ];
  const COURT_SLOTS = [
    { pos: '主攻', x: 106, y: 196, color: '#ff8a5c' },
    { pos: '副攻', x: 170, y: 192, color: '#8f82ff' },
    { pos: '二传', x: 234, y: 196, color: '#46e0ff' },
    { pos: '接应', x: 88, y: 276, color: '#fb7299' },
    { pos: '自由人', x: 170, y: 282, color: '#37e39b' },
    { pos: '副攻', x: 252, y: 276, color: '#4aa8ff' }
  ];
  const PAGES = {
    dashboard: { title: '球队总览', kicker: 'TEAM OPS / OVERVIEW' },
    roster: { title: '人员管理', kicker: 'ROSTER / PLAYERS' },
    attendance: { title: '考勤管理', kicker: 'ATTENDANCE / WEEK' },
    tactics: { title: '阵型板', kicker: 'FORMATION / COURT' },
    growth: { title: '成长计划', kicker: 'SKILLS / GROWTH' },
    ai: { title: 'AI 助手', kicker: 'AI COACH / ASSISTANT' }
  };
  const SOURCE_LABEL = { training: '训练', match: '比赛', manual: '手动' };
