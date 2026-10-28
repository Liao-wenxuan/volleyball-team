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
 * 隐私口径：链接里带着全队数据（队长一个人管，没必要拆成 N 条链接），
 * 但**页面上只显示本人**——队员第一次打开要先认领「我是谁」，
 * 认领结果存在本机 localStorage（不随链接走），之后直接进自己的档案。
 * 想看别人必须点「换个人」重新认领，不会一打开就把全队摊开。
 *
 * 编码格式：首字符是版本标记
 *   '1' = deflate-raw 压缩（CompressionStream，现代浏览器都支持）
 *   '0' = 未压缩 JSON（老浏览器兜底，编码侧只在不支持压缩时用）
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SELF_KEY = 'xgy_share_self'; // 本机记住「我是谁」，不随链接走

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
  const ST_LABEL = { present: '出勤', late: '迟到', leave: '请假', absent: '缺席' };
  const ST_CLS = { present: 'ok', late: 'late', leave: 'leave', absent: 'off' };
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

  function fmtSnapshot(at) {
    const d = new Date(at);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  function shell(team, inner) {
    const logo = (document.querySelector('.brand-img') || {}).src || '';
    const el = document.createElement('div');
    el.id = 'shareView';
    el.innerHTML = `
      <div class="sv-bar">
        ${logo ? `<img class="sv-logo" src="${logo}" alt="" aria-hidden="true">` : ''}
        <span class="sv-bar-txt"><strong>${esc(team)}</strong><em>TEAM FEED · SNAPSHOT</em></span>
      </div>${inner}`;
    document.body.classList.add('sv-mode');
    const prev = document.getElementById('shareView');
    if (prev) prev.remove();
    document.body.appendChild(el);
    return el;
  }

  /* ══════════ 认领：你是谁 ══════════ */
  function renderPicker(data) {
    const el = shell(data.team || '信工院排球队', `
      <section class="sv-hero">
        <div class="sv-hero-top mono">
          <span><i class="sv-dot"></i>TEAM SIGNAL · LIVE</span>
          <span>XGY · VB</span>
        </div>
        <h1 class="sv-h1">
          <span class="sv-line">先认领</span>
          <span class="sv-line">你是<em>谁。</em></span>
        </h1>
        <div class="sv-hero-mid">
          <div class="sv-hero-copy">
            <span class="mono">PICK → YOUR NAME</span>
            <p>只显示你自己的出勤和技能，别人的数据不会摊开。选一次，下次打开直接进。</p>
          </div>
          <div class="sv-burst" aria-hidden="true">
            <i style="--r:0deg"></i><i style="--r:45deg"></i><i style="--r:90deg"></i><i style="--r:135deg"></i><b></b>
          </div>
        </div>
        <div class="sv-scan" aria-hidden="true"></div>
        <div class="sv-halo" aria-hidden="true"></div>
      </section>
      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>ROSTER / ${data.players.length}</span><i>+</i></div>
        <h2>点一下你的名字。</h2>
        <div class="sv-pick">
          ${data.players.map((p) => {
            const [a, b] = ROLE_STYLE[p.pos] || ['#7b6cff', '#46e0ff'];
            return `<button type="button" class="sv-pick-btn" data-pid="${esc(p.id)}">
              <span class="sv-avatar" style="--a:${a};--b:${b}">${esc((p.n || '?')[0])}</span>
              <span class="sv-pick-txt"><b>${esc(p.n)}</b><em>${esc(p.pos)}${p.no ? ' · #' + esc(p.no) : ''}</em></span>
            </button>`;
          }).join('')}
        </div>
      </section>
      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">GENERATED BY CAPTAIN · NO SIGN-UP NEEDED</p>
      </footer>`);
    document.title = `${data.team || '信工院排球队'} · 队伍动态`;
    el.querySelectorAll('.sv-pick-btn').forEach((btn) => {
      btn.onclick = () => {
        try { localStorage.setItem(SELF_KEY, btn.dataset.pid); } catch (e) { /* 隐私模式下忽略 */ }
        const me = data.players.find((p) => p.id === btn.dataset.pid);
        if (me) renderSelf(data, me);
      };
    });
    return el;
  }

  /* ══════════ 本人档案 ══════════ */
  function renderSelf(data, me) {
    const r = rateOf(me.att);
    const marked = (me.att.p || 0) + (me.att.l || 0) + (me.att.v || 0) + (me.att.a || 0);
    const teamAtt = data.players.reduce((acc, p) => {
      acc.p += p.att.p || 0; acc.l += p.att.l || 0; acc.v += p.att.v || 0; acc.a += p.att.a || 0;
      return acc;
    }, { p: 0, l: 0, v: 0, a: 0 });
    const teamRate = rateOf(teamAtt);

    const timeline = (data.sessions || []).map((s) => {
      const st = (s.st || {})[me.id] || '';
      return `<div class="sv-tl-row">
        <span class="sv-sdate mono">${esc(s.d)}</span>
        <span class="sv-stime">${esc(s.t || '')}</span>
        <span class="sv-tl-badge ${ST_CLS[st] || 'none'}">${st ? ST_LABEL[st] : '未登记'}</span>
      </div>`;
    }).join('');

    const el = shell(data.team || '信工院排球队', `
      <section class="sv-hero">
        <div class="sv-hero-top mono">
          <span><i class="sv-dot"></i>MY FEED · ${esc(me.pos || '')}</span>
          <span>${esc(me.no ? '#' + me.no : 'XGY')}</span>
        </div>
        <h1 class="sv-h1">
          <span class="sv-line">${esc(me.n)}</span>
          <span class="sv-line">出勤<em>${r == null ? '—' : r + '%'}</em></span>
        </h1>
        <div class="sv-hero-mid">
          <div class="sv-hero-copy">
            <span class="mono">TRAIN → RECORD → GROW</span>
            <p>共登记 ${marked} 次训练 · 出 ${me.att.p || 0} · 迟 ${me.att.l || 0} · 请 ${me.att.v || 0} · 缺 ${me.att.a || 0}</p>
          </div>
          <div class="sv-burst" aria-hidden="true">
            <i style="--r:0deg"></i><i style="--r:45deg"></i><i style="--r:90deg"></i><i style="--r:135deg"></i><b></b>
          </div>
        </div>
        <div class="sv-scan" aria-hidden="true"></div>
        <div class="sv-halo" aria-hidden="true"></div>
      </section>

      <section class="sv-stats">
        <div class="sv-stat"><b>${r == null ? '—' : r + '%'}</b><span>我的出勤</span></div>
        <div class="sv-stat"><b>${(me.att.p || 0) + (me.att.l || 0)}</b><span>到场次数</span></div>
        <div class="sv-stat"><b>${me.att.l || 0}</b><span>迟到</span></div>
        <div class="sv-stat"><b>${teamRate == null ? '—' : teamRate + '%'}</b><span>全队出勤</span></div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>MY SKILLS / 01</span><i>+</i></div>
        <h2>我的六项。</h2>
        <div class="sv-radar-wrap">${radarSVG(me.sk || [5, 5, 5, 5, 5, 5], 300)}</div>
        <p class="sv-note mono">0–10 SCALE · ${esc(me.n)}</p>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>MY RECORD / 02</span><i>+</i></div>
        <h2>最近训练。</h2>
        <div class="sv-tl">${timeline || '<p class="sv-empty">还没有训练记录</p>'}</div>
      </section>

      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">GENERATED BY CAPTAIN · NO SIGN-UP NEEDED</p>
        <button type="button" class="sv-switch" id="svSwitch">换个人 / 看错了</button>
      </footer>`);
    document.title = `${me.n} · 我的训练档案`;
    const sw = document.getElementById('svSwitch');
    if (sw) sw.onclick = () => {
      try { localStorage.removeItem(SELF_KEY); } catch (e) { /* ignore */ }
      renderPicker(data);
    };
    return el;
  }

  function render(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    if (!players.length) { renderError(); return; }
    let saved = null;
    try { saved = localStorage.getItem(SELF_KEY); } catch (e) { /* ignore */ }
    const me = saved && players.find((p) => p.id && p.id === saved);
    if (me) renderSelf(data, me);
    else renderPicker(data);
  }

  function renderError() {
    const el = shell('信工院排球队', `
      <section class="sv-hero sv-hero-err">
        <div class="sv-hero-top mono"><span><i class="sv-dot off"></i>SIGNAL LOST</span><span>XGY · VB</span></div>
        <h1 class="sv-h1"><span class="sv-line">链接不完整</span><span class="sv-line">或已<em>过期。</em></span></h1>
        <div class="sv-hero-mid"><div class="sv-hero-copy">
          <span class="mono">COPY → FULL → LINK</span>
          <p>请确认链接完整（微信里点右上角在浏览器打开试试），或者让队长重新生成一次。</p>
        </div></div>
      </section>`);
    document.title = '链接无效';
    return el;
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
    decode(m[1]).then(render).catch(renderError);
  }

  boot();
  // 已经打开着主应用、再粘一条分享链接进来（只变了 hash，不会重新加载），也要能接管
  window.addEventListener('hashchange', boot);

  /* ══════════ 给主应用的接口 ══════════ */
  window.XGYShare = { buildURL, encode };
})();
