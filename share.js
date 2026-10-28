/* ═══════════════════════════════════════════════════════════════
 * share.js — 队员端「我的训练档案」
 *
 * 纯前端、零后端：
 * - 队长侧（app.js 调用）：XGYShare.buildURL(payload) 把队伍快照
 *   JSON → deflate-raw → base64url，编成 `#share=...` 链接
 * - 队员侧：打开带 #share= 的链接时，本脚本抢在 app.js 之前
 *   置 __XGY_SHARE_MODE，主应用直接跳过初始化；然后解码并把
 *   只读视图渲染进 #shareView，其余界面元素全部隐藏
 *
 * 三条设计原则：
 * 1. 进门前要验证：输入「姓名 + 球衣号码」对上了才放行，
 *    页面上不列全队名单，也不会告诉对方「有几个人」以外的信息。
 * 2. 只谈自己：出勤、进步、六维、点评，别人的数据一个字不出现。
 * 3. 进步要算得出来：拿每项技能「赛季起点」对比现在的分，
 *    不是拍脑袋夸，涨了多少分就说多少分。
 *
 * 编码格式：首字符是版本标记
 *   '1' = deflate-raw 压缩（CompressionStream，现代浏览器都支持）
 *   '0' = 未压缩 JSON（老浏览器兜底，编码侧只在不支持压缩时用）
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const NAME_KEY = 'xgy_share_name'; // 本机只记住上次输入的姓名，方便下次填

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
  const f1 = (n) => (Number(n) || 0).toFixed(1);

  /* ══════════ 统计 ══════════ */
  function rateOf(att) {
    const marked = (att.p || 0) + (att.l || 0) + (att.v || 0) + (att.a || 0);
    if (!marked) return null;
    return Math.round((((att.p || 0) + (att.l || 0)) / marked) * 100);
  }

  /* ══════════ 六维雷达（SVG） ══════════ */
  function radarSVG(values, size, weakIndex) {
    const cx = size / 2, cy = size / 2, R = size / 2 - 36;
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
      const [lx, ly] = pt(i, R + 19);
      const cls = i === weakIndex ? 'sv-radar-label is-weak' : 'sv-radar-label';
      labels.push(`<text x="${lx}" y="${ly}" class="${cls}" text-anchor="middle" dominant-baseline="middle">${SKILL_LABELS[i]}</text>`);
    }
    const dots = poly.map((p, i) => {
      const [x, y] = p.split(',');
      return `<circle cx="${x}" cy="${y}" r="${i === weakIndex ? 4 : 2.5}" class="sv-radar-dot${i === weakIndex ? ' is-weak' : ''}"/>`;
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
        <span class="sv-bar-txt"><strong>${esc(team)}</strong><em>MY TRAINING FILE</em></span>
      </div>${inner}`;
    document.body.classList.add('sv-mode');
    const prev = document.getElementById('shareView');
    if (prev) prev.remove();
    document.body.appendChild(el);
    return el;
  }

  function heroTop(right) {
    return `<div class="sv-hero-top mono">
      <span><i class="sv-dot"></i>TEAM SIGNAL · LIVE</span>
      <span>${esc(right || 'XGY · VB')}</span>
    </div>`;
  }

  /* ══════════ 第 1 步：姓名 + 号码 ══════════ */
  function renderGate(data) {
    const players = data.players || [];
    const needNo = players.some((p) => Number(p.no) > 0);
    let remembered = '';
    try { remembered = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* ignore */ }

    const el = shell(data.team || '信工院排球队', `
      <section class="sv-hero">
        ${heroTop()}
        <h1 class="sv-h1">
          <span class="sv-line">先确认</span>
          <span class="sv-line">你是<em>谁。</em></span>
        </h1>
        <div class="sv-hero-mid">
          <div class="sv-hero-copy">
            <span class="mono">NAME + JERSEY NUMBER</span>
            <p>填你报名时的名字和球衣号码。对上了，才看得到自己的出勤和进步。</p>
          </div>
          <div class="sv-burst" aria-hidden="true">
            <i style="--r:0deg"></i><i style="--r:45deg"></i><i style="--r:90deg"></i><i style="--r:135deg"></i><b></b>
          </div>
        </div>
        <div class="sv-scan" aria-hidden="true"></div>
        <div class="sv-halo" aria-hidden="true"></div>
      </section>

      <section class="sv-sec sv-gate">
        <div class="sv-sec-head mono"><span>VERIFY / ${players.length}</span><i>·</i></div>
        <form class="sv-form" id="svForm" autocomplete="off">
          <label class="sv-field"><span>姓名</span>
            <input id="svName" type="text" inputmode="text" maxlength="12" placeholder="比如 王丹婷" value="${esc(remembered)}">
          </label>
          <label class="sv-field"><span>球衣号码</span>
            <input id="svNo" type="text" inputmode="numeric" maxlength="3" placeholder="${needNo ? '比如 73' : '队里还没录号码，留空即可'}">
          </label>
          <p class="sv-err" id="svErr" hidden>姓名和号码对不上，再试一次。记不清就问队长。</p>
          <button type="submit" class="sv-btn">看我的档案<i>→</i></button>
        </form>
      </section>

      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">NO SIGN-UP · NO APP · JUST A LINK</p>
      </footer>`);
    document.title = `${data.team || '信工院排球队'} · 我的训练档案`;

    const form = el.querySelector('#svForm');
    const err = el.querySelector('#svErr');
    const nameEl = el.querySelector('#svName');
    const noEl = el.querySelector('#svNo');
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = norm(nameEl.value);
      const no = norm(noEl.value);
      const me = players.find((p) => {
        if (norm(p.n) !== name) return false;
        if (!needNo) return true;
        if (!Number(p.no)) return !no; // 没录号码的队员，号码留空也放行
        return String(Number(p.no)) === no;
      });
      if (!me) {
        err.hidden = false;
        form.classList.remove('shake');
        void form.offsetWidth; // 重排一次，让动画能重复触发
        form.classList.add('shake');
        noEl.focus();
        return;
      }
      err.hidden = true;
      try { localStorage.setItem(NAME_KEY, me.n); } catch (e2) { /* ignore */ }
      renderSelf(data, me);
    };
    if (remembered) noEl.focus(); else nameEl.focus();
    return el;
  }

  /* ══════════ 第 2 步：我的档案 ══════════ */
  function renderSelf(data, me) {
    const players = data.players || [];
    const att = me.att || { p: 0, l: 0, v: 0, a: 0 };
    const r = rateOf(att);
    const marked = (att.p || 0) + (att.l || 0) + (att.v || 0) + (att.a || 0);

    const sk = (me.sk || []).map((v) => Number(v) || 0);
    const base = (me.base || me.sk || []).map((v) => Number(v) || 0);
    const gainTotal = sk.reduce((a, v, i) => a + (v - base[i]), 0);

    // 最弱的一项 = 六维里最低的，分享页拿它当「下一步练什么」
    let weak = 0;
    for (let i = 1; i < sk.length; i++) if (sk[i] < sk[weak]) weak = i;

    const teamAtt = players.reduce((acc, p) => {
      const a = p.att || {};
      acc.p += a.p || 0; acc.l += a.l || 0; acc.v += a.v || 0; acc.a += a.a || 0;
      return acc;
    }, { p: 0, l: 0, v: 0, a: 0 });
    const teamRate = rateOf(teamAtt);

    const gainCells = SKILL_LABELS.map((label, i) => {
      const d = +(sk[i] - base[i]).toFixed(1);
      const cls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
      const sign = d > 0 ? '+' : '';
      return `<div class="sv-gain-cell${i === weak ? ' is-weak' : ''}">
        <span>${label}</span>
        <b>${f1(sk[i])}</b>
        <em class="${cls}">${cls === 'flat' ? '—' : sign + d.toFixed(1)}</em>
      </div>`;
    }).join('');

    const timeline = (data.sessions || []).map((s) => {
      const st = (s.st || {})[me.id] || '';
      return `<div class="sv-tl-row">
        <span class="sv-sdate mono">${esc(s.d)}</span>
        <span class="sv-stime">${esc(s.t || '')}</span>
        <span class="sv-tl-badge ${ST_CLS[st] || 'none'}">${st ? ST_LABEL[st] : '未登记'}</span>
      </div>`;
    }).join('');

    const note = String(me.note || '').trim();
    const isAi = Number(me.nc) === 1;

    const el = shell(data.team || '信工院排球队', `
      <section class="sv-hero">
        ${heroTop(me.no ? '#' + me.no : (me.pos || 'XGY'))}
        <h1 class="sv-h1">
          <span class="sv-line">${esc(me.n)}</span>
          <span class="sv-line">出勤<em>${r == null ? '—' : r + '%'}</em></span>
        </h1>
        <div class="sv-hero-mid">
          <div class="sv-hero-copy">
            <span class="mono">${esc(me.pos || '')} · ${marked} 次已登记</span>
            <p>到场 ${att.p || 0} · 迟到 ${att.l || 0} · 请假 ${att.v || 0} · 缺席 ${att.a || 0}</p>
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
        <div class="sv-stat"><b>${(att.p || 0) + (att.l || 0)}</b><span>到场次数</span></div>
        <div class="sv-stat"><b>${att.l || 0}</b><span>迟到</span></div>
        <div class="sv-stat"><b>${teamRate == null ? '—' : teamRate + '%'}</b><span>全队出勤</span></div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>PROGRESS / 01</span><i>↑</i></div>
        <h2>涨了 ${gainTotal > 0 ? '+' : ''}${gainTotal.toFixed(1)} 分。</h2>
        <p class="sv-sub">这学期六项加起来的变化。每格下面是和刚入队时的差。</p>
        <div class="sv-gain-grid">${gainCells}</div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>SHAPE / 02</span><i>◇</i></div>
        <h2>你的形状。</h2>
        <div class="sv-radar-wrap">${radarSVG(sk, 300, weak)}</div>
        <p class="sv-weak">凹进去的那一角是 <b>${SKILL_LABELS[weak]}</b>（${f1(sk[weak])}）· 0–10 分</p>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>COACH NOTE / 03</span><i>✦</i></div>
        <h2>${isAi ? '队长想对你说。' : '下一步练什么。'}</h2>
        <div class="sv-tipcard">
          <p>${esc(note || '这段时间的记录还不够，先把出勤记满几次，点评就会有内容了。')}</p>
          <span class="mono">${isAi ? 'WRITTEN BY CAPTAIN · AI ASSISTED' : 'WRITTEN BY CAPTAIN'}</span>
        </div>
      </section>

      <section class="sv-sec">
        <div class="sv-sec-head mono"><span>RECORD / 04</span><i>·</i></div>
        <h2>最近训练。</h2>
        <div class="sv-tl">${timeline || '<p class="sv-empty">还没有训练记录</p>'}</div>
      </section>

      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">GENERATED BY CAPTAIN · NO SIGN-UP NEEDED</p>
        <button type="button" class="sv-switch" id="svSwitch">不是我 / 换个人</button>
      </footer>`);
    document.title = `${me.n} · 我的训练档案`;
    const sw = document.getElementById('svSwitch');
    if (sw) sw.onclick = () => renderGate(data);
    return el;
  }

  function render(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    if (!players.length) { renderError(); return; }
    renderGate(data);
  }

  function renderError() {
    const el = shell('信工院排球队', `
      <section class="sv-hero sv-hero-err">
        ${heroTop().replace('LIVE', 'LOST')}
        <h1 class="sv-h1"><span class="sv-line">链接不完整</span><span class="sv-line">或已<em>过期。</em></span></h1>
        <div class="sv-hero-mid"><div class="sv-hero-copy">
          <span class="mono">COPY → FULL → LINK</span>
          <p>请确认链接完整（微信里点右上角「在浏览器打开」试试），或者让队长重新生成一次。</p>
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
