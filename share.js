/* ═══════════════════════════════════════════════════════════════
 * share.js — 队员只读视图（队伍动态分享页）
 *
 * 纯前端、零后端：
 * - 队长侧（app.js 调用）：XGYShare.buildURL(payload) 把队伍快照
 *   JSON → deflate-raw → base64url，编成 `#share=...` 链接
 * - 队员侧：打开带 #share= 的链接时，本脚本抢在 app.js 之前
 *   置 __XGY_SHARE_MODE，主应用直接跳过初始化；然后解码并把
 *   只读视图渲染进 #shareView，其余界面元素全部隐藏
 *
 * 编码格式：首字符是版本标记
 *   '1' = deflate-raw 压缩（CompressionStream，现代浏览器都支持）
 *   '0' = 未压缩 JSON（老浏览器兜底，编码侧只在不支持压缩时用）
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════ base64url + 压缩编解码 ══════════ */
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== 'undefined') {
      const buf = await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      ).arrayBuffer();
      return '1' + b64url(new Uint8Array(buf));
    }
    return '0' + b64url(raw);
  }

  async function decode(str) {
    const tag = str[0];
    const bytes = unb64url(str.slice(1));
    if (tag === '1') {
      const buf = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      ).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    }
    if (tag === '0') return JSON.parse(new TextDecoder().decode(bytes));
    throw new Error('unknown share payload tag: ' + tag);
  }

  async function buildURL(payload) {
    const data = await encode(payload);
    // 用 location.href 而不是 origin+pathname：单文件走 file:// 时 origin 是 "null"，
    // 拼出来的路径会丢掉 file:// 前缀，队员点开就打不开
    return location.href.split('#')[0] + '#share=' + data;
  }

  /* ══════════ 常量（与 app.js 保持一致，刻意独立，分享页不依赖主应用） ══════════ */
  const SKILL_LABELS = ['发球', '一传', '二传', '扣球', '拦网', '防守'];
  const ROLE_STYLE = {
    '主攻': ['#ff8a5c', '#ffc46b'],
    '副攻': ['#7b6cff', '#4aa8ff'],
    '二传': ['#46e0ff', '#37e39b'],
    '接应': ['#fb7299', '#ff9d6e'],
    '自由人': ['#37e39b', '#b8f06a']
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ══════════ 统计 ══════════ */
  function rateOf(att) {
    const marked = (att.p || 0) + (att.l || 0) + (att.v || 0) + (att.a || 0);
    if (!marked) return null;
    return Math.round((((att.p || 0) + (att.l || 0)) / marked) * 100);
  }

  /* ══════════ 六维雷达（SVG） ══════════ */
  function radarSVG(values, size) {
    const cx = size / 2, cy = size / 2, R = size / 2 - 34;
    const pt = (i, r) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const ring = (f) => {
      const pts = [];
      for (let i = 0; i < 6; i++) pts.push(pt(i, R * f).join(','));
      return pts.join(' ');
    };
    const poly = [];
    for (let i = 0; i < 6; i++) {
      const v = Math.max(0, Math.min(10, Number(values[i]) || 0));
      poly.push(pt(i, R * (v / 10)).join(','));
    }
    const axes = [];
    const labels = [];
    for (let i = 0; i < 6; i++) {
      const [x, y] = pt(i, R);
      axes.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="sv-radar-axis"/>`);
      const [lx, ly] = pt(i, R + 18);
      labels.push(`<text x="${lx}" y="${ly}" class="sv-radar-label" text-anchor="middle" dominant-baseline="middle">${SKILL_LABELS[i]}</text>`);
    }
    const dots = poly.map((p) => {
      const [x, y] = p.split(',');
      return `<circle cx="${x}" cy="${y}" r="2.5" class="sv-radar-dot"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" class="sv-radar" role="img" aria-label="技能雷达图">
      <polygon points="${ring(1)}" class="sv-radar-ring"/>
      <polygon points="${ring(0.66)}" class="sv-radar-ring"/>
      <polygon points="${ring(0.33)}" class="sv-radar-ring"/>
      ${axes.join('')}
      <polygon points="${poly.join(' ')}" class="sv-radar-poly"/>
      ${dots}
      ${labels.join('')}
    </svg>`;
  }

  /* ══════════ 视图渲染 ══════════ */
  function playerRow(p) {
    const [a, b] = ROLE_STYLE[p.pos] || ['#7b6cff', '#46e0ff'];
    const r = rateOf(p.att);
    return `<div class="sv-player">
      <span class="sv-avatar" style="--a:${a};--b:${b}">${esc((p.n || '?')[0])}</span>
      <div class="sv-pmain">
        <div class="sv-prow"><b>${esc(p.n)}</b><em>${esc(p.pos)}${p.no ? ' · #' + esc(p.no) : ''}</em></div>
        <div class="sv-pbar"><i style="width:${r == null ? 0 : r}%"></i></div>
      </div>
      <div class="sv-prate"><b>${r == null ? '—' : r + '%'}</b><span>出勤率</span></div>
      <div class="sv-pcounts">
        <span>出 ${p.att.p || 0}</span><span>迟 ${p.att.l || 0}</span>
        <span>请 ${p.att.v || 0}</span><span>缺 ${p.att.a || 0}</span>
      </div>
    </div>`;
  }

  function sessionRow(s) {
    const marked = (s.p || 0) + (s.l || 0) + (s.v || 0) + (s.a || 0);
    const r = marked ? Math.round((((s.p || 0) + (s.l || 0)) / marked) * 100) : null;
    return `<div class="sv-session">
      <span class="sv-sdate mono">${esc(s.d)}</span>
      <span class="sv-stime">${esc(s.t || '')}</span>
      <span class="sv-scount">${marked ? `到场 ${(s.p || 0) + (s.l || 0)}/${marked}` : '未登记'}</span>
      <span class="sv-srate">${r == null ? '—' : r + '%'}</span>
    </div>`;
  }

  function fmtSnapshot(at) {
    const d = new Date(at);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  function render(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const team = data.team || '信工院排球队';

    const totals = { p: 0, l: 0, v: 0, a: 0 };
    players.forEach((pl) => {
      totals.p += pl.att.p || 0; totals.l += pl.att.l || 0;
      totals.v += pl.att.v || 0; totals.a += pl.att.a || 0;
    });
    const teamRate = rateOf(totals);
    const avgSkills = [0, 1, 2, 3, 4, 5].map((i) => {
      if (!players.length) return 0;
      const sum = players.reduce((acc, pl) => acc + (Number((pl.sk || [])[i]) || 0), 0);
      return Math.round((sum / players.length) * 10) / 10;
    });
    const perfect = players.filter((pl) => {
      const m = (pl.att.p || 0) + (pl.att.l || 0) + (pl.att.v || 0) + (pl.att.a || 0);
      return m > 0 && pl.att.p === m;
    }).length;

    // 复用主应用内嵌的排球 logo（不重复打包 base64）
    const logoSrc = (document.querySelector('.brand-img') || {}).src || '';

    const el = document.createElement('div');
    el.id = 'shareView';
    el.innerHTML = `
      <div class="sv-bar">
        ${logoSrc ? `<img class="sv-logo" src="${logoSrc}" alt="" aria-hidden="true">` : ''}
        <span class="sv-bar-txt"><strong>${esc(team)}</strong><em>TEAM FEED · SNAPSHOT</em></span>
      </div>

      <section class="sv-hero">
        <div class="sv-hero-top mono">
          <span><i class="sv-dot"></i>TEAM SIGNAL · LIVE</span>
          <span>XGY · VB</span>
        </div>
        <h1 class="sv-h1">
          <span class="sv-line">每一次到场</span>
          <span class="sv-line">都<em>算数。</em></span>
        </h1>
        <div class="sv-hero-mid">
          <div class="sv-hero-copy">
            <span class="mono">TRAIN → RECORD → GROW</span>
            <p>${players.length} 名队员 · ${sessions.length ? `最近 ${sessions.length} 次训练` : '训练数据同步中'}${teamRate != null ? ` · 出勤率 ${teamRate}%` : ''}</p>
          </div>
          <div class="sv-burst" aria-hidden="true">
            <i style="--r:0deg"></i><i style="--r:45deg"></i><i style="--r:90deg"></i><i style="--r:135deg"></i><b></b>
          </div>
        </div>
        <div class="sv-hero-foot mono">
          <span>EVERY PRACTICE COUNTS.</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v14M6 12l6 6 6-6"/></svg>
        </div>
        <div class="sv-scan" aria-hidden="true"></div>
        <div class="sv-halo" aria-hidden="true"></div>
      </section>

      <section class="sv-stats">
        <div class="sv-stat"><b>${players.length}</b><span>队员</span></div>
        <div class="sv-stat"><b>${sessions.length}</b><span>近期训练</span></div>
        <div class="sv-stat"><b>${teamRate == null ? '—' : teamRate + '%'}</b><span>出勤率</span></div>
        <div class="sv-stat"><b>${perfect}</b><span>全勤</span></div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>ATTENDANCE / 01</span><i>+</i></div>
        <h2>出勤总览。</h2>
        <div class="sv-list">${players.map(playerRow).join('') || '<p class="sv-empty">还没有队员数据</p>'}</div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>SKILLS / 02</span><i>+</i></div>
        <h2>技能全景。</h2>
        <div class="sv-radar-wrap">${radarSVG(avgSkills, 300)}</div>
        <p class="sv-note mono">TEAM AVERAGE · 0–10 SCALE</p>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>RECENT / 03</span><i>+</i></div>
        <h2>最近训练。</h2>
        <div class="sv-sessions">${sessions.map(sessionRow).join('') || '<p class="sv-empty">还没有训练记录</p>'}</div>
      </section>

      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">GENERATED BY CAPTAIN · NO SIGN-UP NEEDED</p>
      </footer>`;

    document.title = `${team} · 队伍动态`;
    document.body.classList.add('sv-mode');
    document.body.appendChild(el);
  }

  function renderError() {
    const el = document.createElement('div');
    el.id = 'shareView';
    el.innerHTML = `<section class="sv-hero sv-hero-err">
      <div class="sv-hero-top mono"><span><i class="sv-dot off"></i>SIGNAL LOST</span><span>XGY · VB</span></div>
      <h1 class="sv-h1"><span class="sv-line">链接不完整</span><span class="sv-line">或已<em>过期。</em></span></h1>
      <div class="sv-hero-mid"><div class="sv-hero-copy">
        <span class="mono">COPY → FULL → LINK</span>
        <p>请确认链接完整（微信里点右上角在浏览器打开试试），或者让队长重新生成一次。</p>
      </div></div>
    </section>`;
    document.title = '链接无效';
    document.body.classList.add('sv-mode');
    document.body.appendChild(el);
  }

  /* ══════════ 启动：命中 #share= 就接管页面 ══════════ */
  let mountedHash = null;
  function boot() {
    const m = location.hash.match(/^#share=(.+)$/);
    if (!m) {
      // 分享页上把 hash 清掉 → 回主应用（此时主应用多半没初始化过，刷新最干净）
      if (mountedHash) location.reload();
      return;
    }
    if (mountedHash === m[1]) return; // 同一条链接不重复渲染
    mountedHash = m[1];
    // 主应用已经启动过也没关系：置标记 + 加 sv-mode 之后主界面照样被隐藏
    window.__XGY_SHARE_MODE = true;
    const prev = document.getElementById('shareView');
    if (prev) prev.remove(); // 换了一条分享链接
    decode(m[1]).then(render).catch(renderError);
  }

  boot();
  // 已经打开着主应用、再粘一条分享链接进来（只变了 hash，不会重新加载），也要能接管
  window.addEventListener('hashchange', boot);

  /* ══════════ 给主应用的接口 ══════════ */
  window.XGYShare = { buildURL, encode };
})();
