/* ═══════════════════════════════════════════════════════════════
 * card.js — 训练卡（一次训练一张可转发的图）
 *
 * 为什么手写 canvas 而不是 DOM 截图：
 *   1. 项目是「零依赖 + 单文件双击可用」，引 html2canvas 就破功
 *   2. 卡片是固定版式，手绘比截图库更可控（不会踩字体加载、离屏渲染的坑）
 *
 * 只做一件事：
 *   render(payload) → 画到 750×1334 的 canvas，返回 { dataURL, blob }
 *   UI（弹窗 / 保存按钮）留在 app.js，本文件不碰界面
 *
 * payload = {
 *   team, session:{date,start,end,venue,attendance},
 *   players:[{id,name,number,position}],
 *   logs:[{playerId,skill,before,after,delta}],
 *   next:{date,start} | null
 * }
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const W = 750, H = 1334, PAD = 60;
  const SKILL_LABEL = { serve: '发球', receive: '一传', set: '二传', spike: '扣球', block: '拦网', defense: '防守' };
  const ROLE_STYLE = {
    '主攻': ['#ff8a5c', '#ffc46b'],
    '副攻': ['#7b6cff', '#4aa8ff'],
    '二传': ['#46e0ff', '#37e39b'],
    '接应': ['#fb7299', '#ff9d6e'],
    '自由人': ['#37e39b', '#b8f06a']
  };
  const FRONT = ['二传', '副攻', '接应']; // 画在靠网那一排
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  const FONT = '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif';
  const MONO = '"Cascadia Code",ui-monospace,Consolas,monospace';

  const f = (w, size, mono) => `${w} ${size}px ${mono ? MONO : FONT}`;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 中文没有词边界，按字宽逐字断行
  function wrap(ctx, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of String(text)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function bg(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#121729');
    g.addColorStop(1, '#05070f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = ctx.createRadialGradient(W - 60, 40, 0, W - 60, 40, 420);
    r.addColorStop(0, 'rgba(123,108,255,.22)');
    r.addColorStop(1, 'rgba(123,108,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, 520);
  }

  function court(ctx, x, y, w, h) {
    rr(ctx, x, y, w, h, 22);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#1a2244');
    g.addColorStop(1, '#0e1424');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const netY = y + h * 0.075;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 40, netY);
    ctx.lineTo(x + w - 40, netY);
    ctx.stroke();

    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 26, netY + h * 0.30);
    ctx.lineTo(x + w - 26, netY + h * 0.30);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, netY);
    ctx.lineTo(x + w / 2, y + h - 20);
    ctx.stroke();
  }

  function playerDot(ctx, p, cx, cy, state) {
    const r = 27;
    const [c1, c2] = ROLE_STYLE[p.position] || ['#7b6cff', '#46e0ff'];
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = state === 'late' ? '#ffbb55' : 'rgba(255,255,255,.35)';
    ctx.stroke();

    ctx.fillStyle = '#0b0d16';
    ctx.font = f(800, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.number || (p.name || '?')[0]), cx, cy + 1);

    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = f(600, 17);
    ctx.fillText(p.name || '', cx, cy + r + 20);
  }

  function sectionTitle(ctx, monoY, mono, cn) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 15, true);
    ctx.fillStyle = 'rgba(217,255,74,.85)';
    ctx.fillText(mono, PAD, monoY);
    ctx.font = f(700, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cn, PAD, monoY + 34);
  }

  async function render(payload) {
    const p = payload || {};
    const s = p.session || {};
    const players = Array.isArray(p.players) ? p.players : [];
    const att = s.attendance || {};
    const logs = Array.isArray(p.logs) ? p.logs : [];

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    bg(ctx);

    const d = s.date ? new Date(`${s.date}T00:00:00`) : new Date();
    const attended = players.filter((x) => att[x.id] === 'present' || att[x.id] === 'late');
    const marked = players.filter((x) => att[x.id]);
    const rate = marked.length ? Math.round((attended.length / marked.length) * 100) : null;

    /* 头部 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 15, true);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('XGY VOLLEYBALL · TRAINING CARD', PAD, 86);

    ctx.font = f(800, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.team || '信工院排球队', PAD, 136);

    ctx.font = f(500, 21);
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    const head2 = `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]} · ${s.start || ''}${s.end ? '–' + s.end : ''}${s.venue ? ' · ' + s.venue : ''}`;
    ctx.fillText(head2, PAD, 176);

    /* 到场率 */
    const rateTxt = rate == null ? '—' : rate + '%';
    ctx.font = f(800, 76);
    ctx.fillStyle = '#d9ff4a';
    ctx.fillText(rateTxt, PAD, 268);
    ctx.font = f(600, 19);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`到场 ${attended.length} / 登记 ${marked.length} / 全队 ${players.length}`, W - PAD, 262);
    ctx.textAlign = 'left';

    /* 战术板：把到场的人按前排/后排摆上去 */
    const cx0 = PAD, cy0 = 300, cw = W - PAD * 2, ch = 480;
    court(ctx, cx0, cy0, cw, ch);
    const front = attended.filter((x) => FRONT.indexOf(x.position) >= 0);
    const back = attended.filter((x) => FRONT.indexOf(x.position) < 0);
    const place = (group, ry) => {
      group.forEach((pl, i) => {
        const x = cx0 + (cw * (i + 1)) / (group.length + 1);
        playerDot(ctx, pl, x, cy0 + ch * ry, att[pl.id]);
      });
    };
    place(front, 0.30);
    place(back, 0.78);

    if (!attended.length) {
      ctx.textAlign = 'center';
      ctx.font = f(600, 22);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText('这次还没有人登记', cx0 + cw / 2, cy0 + ch / 2);
      ctx.textAlign = 'left';
    }

    /* 没来的 */
    sectionTitle(ctx, 826, 'ABSENT / 01', '没来的');
    const out = players.filter((x) => att[x.id] === 'leave' || att[x.id] === 'absent');
    const noMark = players.filter((x) => !att[x.id]);
    ctx.font = f(500, 19);
    if (out.length) {
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      const txt = out.map((x) => `${x.name}（${att[x.id] === 'leave' ? '请假' : '缺席'}）`).join('、');
      wrap(ctx, txt, W - PAD * 2).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, PAD, 900 + i * 30));
    } else {
      ctx.fillStyle = 'rgba(217,255,74,.9)';
      ctx.fillText('全员到场，一个没缺', PAD, 900);
    }
    if (noMark.length) {
      ctx.fillStyle = 'rgba(255,255,255,.34)';
      ctx.font = f(500, 17);
      const t2 = `未登记：${noMark.map((x) => x.name).join('、')}`;
      wrap(ctx, t2, W - PAD * 2).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, PAD, 938 + i * 26));
    }

    /* 这次的进步 */
    sectionTitle(ctx, 986, 'GROWTH / 02', '这次的进步');
    const top = logs.slice().sort((a, b) => (b.delta || 0) - (a.delta || 0)).slice(0, 3);
    if (top.length) {
      top.forEach((l, i) => {
        const pl = players.find((x) => x.id === l.playerId);
        const yy = 1064 + i * 44;
        ctx.textAlign = 'left';
        ctx.font = f(700, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pl ? pl.name : '—', PAD, yy);
        ctx.font = f(500, 18);
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(`${SKILL_LABEL[l.skill] || l.skill} ${l.before} → ${l.after}`, PAD + 140, yy);
        ctx.font = f(800, 20);
        ctx.fillStyle = '#d9ff4a';
        ctx.textAlign = 'right';
        ctx.fillText(`+${l.delta}`, W - PAD, yy);
      });
    } else {
      ctx.textAlign = 'left';
      ctx.font = f(500, 19);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText('这次没有记录技能调整', PAD, 1064);
    }

    /* 下一次 */
    sectionTitle(ctx, 1198, 'NEXT / 03', '下一次');
    ctx.font = f(600, 20);
    ctx.fillStyle = p.next ? '#ffffff' : 'rgba(255,255,255,.4)';
    ctx.fillText(p.next
      ? `${Number(p.next.date.slice(5, 7))}月${Number(p.next.date.slice(8, 10))}日 周${WEEK_CN[new Date(`${p.next.date}T00:00:00`).getDay()]} ${p.next.start || ''}`
      : '还没排下一次训练', PAD, 1272);

    /* 页脚 */
    ctx.textAlign = 'center';
    ctx.font = f(500, 14, true);
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillText('GENERATED BY CAPTAIN · 信工院排球队', W / 2, H - 46);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return { dataURL: cv.toDataURL('image/png'), blob, canvas: cv };
  }

  window.XGYCard = { render, W, H };
})();

/* ═══════════════════════════════════════════════════════════════
 * renderSeason(payload) — 赛季卡（一学期一张的总结图）
 *
 * payload = {
 *   team, range,                       // '9.1 – 10.28'
 *   totals: { sessions, rate, players, logs },   // rate 可能是 null（没有登记）
 *   weeks: [{ label, rate, positions }],         // 每周：出勤率 + 到过的位置
 *   radar: { skills: [{ label, start, now }] }   // 全队六维：起点 vs 现在
 * }
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const W = 750, H = 1334, PAD = 60;
  const POS_ORDER = ['主攻', '副攻', '二传', '接应', '自由人'];
  const FONT = '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif';
  const MONO = '"Cascadia Code",ui-monospace,Consolas,monospace';
  const f = (w, size, mono) => `${w} ${size}px ${mono ? MONO : FONT}`;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function title(ctx, monoY, mono, cn) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 15, true);
    ctx.fillStyle = 'rgba(217,255,74,.85)';
    ctx.fillText(mono, PAD, monoY);
    ctx.font = f(700, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cn, PAD, monoY + 34);
  }

  function emptyHint(ctx, cy, text) {
    ctx.font = f(500, 19);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, cy);
    ctx.textAlign = 'left';
  }

  async function renderSeason(payload) {
    const p = payload || {};
    const weeks = Array.isArray(p.weeks) ? p.weeks : [];
    const totals = p.totals || {};
    const radar = (p.radar && p.radar.skills) || [];

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    /* 背景（与训练卡同款） */
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#121729'); g.addColorStop(1, '#05070f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W - 60, 40, 0, W - 60, 40, 420);
    rg.addColorStop(0, 'rgba(123,108,255,.22)'); rg.addColorStop(1, 'rgba(123,108,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, 520);

    /* 头部 */
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 15, true);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('XGY VOLLEYBALL · SEASON CARD', PAD, 86);
    ctx.font = f(800, 40); ctx.fillStyle = '#ffffff';
    ctx.fillText(p.team || '信工院排球队', PAD, 136);
    ctx.font = f(500, 21); ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.fillText(p.range || '', PAD, 176);

    /* 大数字：整体出勤率 */
    ctx.font = f(800, 76);
    ctx.fillStyle = '#d9ff4a';
    ctx.fillText(totals.rate == null ? '—' : totals.rate + '%', PAD, 268);
    ctx.font = f(600, 19); ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`${totals.sessions || 0} 次训练 · ${totals.players || 0} 名队员 · ${totals.logs || 0} 条技能记录`, W - PAD, 262);
    ctx.textAlign = 'left';

    /* ── 01 出勤折线 ── */
    title(ctx, 322, 'ATTENDANCE / 01', '每周出勤率');
    const cx0 = PAD, cw = W - PAD * 2, cy0 = 396, ch = 170;
    const shown = weeks.slice(-16);
    const withRate = shown.filter((x) => x.rate != null);
    if (!withRate.length) {
      emptyHint(ctx, cy0 + ch / 2, '还没有登记过考勤');
    } else {
      const x = (i) => shown.length === 1 ? cx0 + cw / 2 : cx0 + (cw * i) / (shown.length - 1);
      const y = (r) => cy0 + ch - (ch * r) / 100;
      // 网格线
      [0, 50, 100].forEach((r) => {
        ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx0, y(r)); ctx.lineTo(cx0 + cw, y(r)); ctx.stroke();
        ctx.font = f(500, 13, true); ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillText(String(r), cx0 - 24, y(r) + 4);
      });
      // 折线 + 点
      ctx.strokeStyle = '#d9ff4a'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      shown.forEach((wk, i) => {
        if (wk.rate == null) return;
        const px = x(i), py = y(wk.rate);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      });
      ctx.stroke();
      shown.forEach((wk, i) => {
        if (wk.rate == null) return;
        ctx.beginPath(); ctx.arc(x(i), y(wk.rate), 6, 0, Math.PI * 2);
        ctx.fillStyle = '#d9ff4a'; ctx.fill();
        ctx.fillStyle = '#0b0d16'; ctx.font = f(800, 11);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(wk.rate), x(i), y(wk.rate) + 1);
      });
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      // x 轴标签（最多 8 个，避免挤）
      const step = Math.max(1, Math.ceil(shown.length / 8));
      ctx.font = f(500, 14, true); ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.textAlign = 'center';
      shown.forEach((wk, i) => { if (i % step === 0 || i === shown.length - 1) ctx.fillText(wk.label, x(i), cy0 + ch + 26); });
      ctx.textAlign = 'left';
    }

    /* ── 02 位置热力 ── */
    title(ctx, 648, 'LINEUP / 02', '位置完整度热力');
    const hy0 = 716, rowH = 26, cellW = Math.min(34, (cw - 90) / Math.max(1, shown.length));
    if (!shown.length || !weeks.some((wk) => (wk.positions || []).length)) {
      emptyHint(ctx, hy0 + 30, '还没有可以统计的训练');
    } else {
      ctx.font = f(500, 16);
      POS_ORDER.forEach((pos, r) => {
        const yy = hy0 + r * rowH;
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(pos, cx0, yy + rowH / 2 - 4);
        shown.forEach((wk, i) => {
          const on = (wk.positions || []).includes(pos);
          ctx.fillStyle = on ? 'rgba(217,255,74,.9)' : 'rgba(255,255,255,.08)';
          rr(ctx, cx0 + 80 + i * (cellW + 4), yy - 2, cellW, rowH - 8, 4);
          ctx.fill();
        });
      });
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = f(500, 14); ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText('亮 = 该位置本周至少到过一次', cx0, hy0 + POS_ORDER.length * rowH + 16);
    }

    /* ── 03 全队六维雷达 ── */
    title(ctx, 932, 'TEAM RADAR / 03', '全队六维 · 起点 vs 现在');
    // 图例画在标题行右侧（雷达下方是页脚的地盘，别挤）
    ctx.font = f(500, 15);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(W - PAD - 158, 955, 14, 4);
    ctx.fillText('起点', W - PAD - 138, 962);
    ctx.fillStyle = '#d9ff4a';
    ctx.fillRect(W - PAD - 74, 955, 14, 4);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText('现在', W - PAD - 54, 962);
    ctx.textBaseline = 'alphabetic';
    const rcx = W / 2, rcy = 1118, rr0 = 104, n = radar.length;
    if (!n || !radar.some((s) => s.start !== s.now)) {
      emptyHint(ctx, rcy, '还没有技能调整记录');
    } else {
      const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const pt = (i, v) => [rcx + Math.cos(ang(i)) * rr0 * (v / 10), rcy + Math.sin(ang(i)) * rr0 * (v / 10)];
      // 骨架
      for (let ring = 1; ring <= 5; ring++) {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const [px, py] = pt(i % n, ring * 2);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1; ctx.stroke();
      }
      for (let i = 0; i < n; i++) {
        const [px, py] = pt(i, 10);
        ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(px, py);
        ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.stroke();
        const [lx, ly] = pt(i, 13.2);
        ctx.font = f(600, 17); ctx.fillStyle = 'rgba(255,255,255,.8)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(radar[i].label, lx, ly);
      }
      ctx.textBaseline = 'alphabetic';
      const poly = (key, stroke, fill) => {
        ctx.beginPath();
        radar.forEach((s, i) => {
          const [px, py] = pt(i, Math.max(0.2, s[key]));
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
      };
      poly('start', 'rgba(255,255,255,.4)', 'rgba(255,255,255,.08)');
      poly('now', '#d9ff4a', 'rgba(217,255,74,.18)');
    }

    /* 页脚 */
    ctx.textAlign = 'center';
    ctx.font = f(500, 14, true);
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillText('GENERATED BY CAPTAIN · 信工院排球队', W / 2, H - 46);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return { dataURL: cv.toDataURL('image/png'), blob, canvas: cv };
  }

  window.XGYSeason = { render: renderSeason };
})();
