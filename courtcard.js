/* ═══════════════════════════════════════════════════════════════
 * courtcard.js — 阵型导出图（把当前 6 个角色位画成一张可转发的 PNG）
 *
 * 为什么又一个手写 canvas 模块，而不是复用 card.js 里的 court()：
 *   card.js 那块画的是「训练卡上按前排/后排摆人」的示意图，坐标系是卡片自己的；
 *   这里必须和屏幕上战术板**逐米对齐**（半场 9×9m、x 横向、y 从网起算、
 *   3m 线在 1/3 处），否则发到群里讲站位的图跟教练平板上摆的不是一回事。
 *   两者版式不同，硬凑进一个文件反而难维护。
 *
 * 和 card.js 一样：零依赖、UI（弹窗/保存按钮）留在 app.js，本文件不碰界面。
 * 平时按需加载；单文件版由 build.mjs 内联回 app.js 之前（file:// 拉不了外链）。
 *
 * render(payload) → 750×1220 canvas，返回 { dataURL, blob, canvas }
 * payload = {
 *   team, name, date,
 *   roles: [{ id, label, color, x, y }]   // x/y 单位米，已在 app.js 里 clamp 过
 * }
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const W = 750, H = 1220, PAD = 56;
  const COURT_SIZE = 9;               // 半场 9 × 9 米，跟 app.js 的 FX_SIZE 一致
  const FONT = '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif';
  const MONO = '"Cascadia Code",ui-monospace,Consolas,monospace';
  const f = (w, size, mono) => `${w} ${size}px ${mono ? MONO : FONT}`;

  const clampMeters = (v) => Math.min(COURT_SIZE, Math.max(0, Number(v) || 0));

  /** 米 → 画布像素。box = { x, y, w, h } 是球场矩形。
   *  抽成纯函数是为了能在 Node 里单测边界（负值/越界/非数字），
   *  也保证导出图和屏幕战术板用同一个换算口径（都是 v / 9 × 边长）。 */
  function courtPoint(x, y, box) {
    const mx = clampMeters(x), my = clampMeters(y);
    return {
      x: box.x + (mx / COURT_SIZE) * box.w,
      y: box.y + (my / COURT_SIZE) * box.h
    };
  }

  /** 棋子圆里放不下一整句「自由人」，用两位短标；轮转换牌后的副攻1/2 也要能区分 */
  function shortLabel(label) {
    const s = String(label || '').trim();
    const map = {
      '主攻1': '主1', '主攻2': '主2', '副攻': '副攻',
      '副攻1': '副1', '副攻2': '副2',
      '接应': '接应', '二传': '二传', '自由人': '自由'
    };
    return map[s] || s.slice(0, 2) || '?';
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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

  /** 木色球场：配色跟 style.css 的 .fx-court 一致，导出图和屏幕上是「同一个场地」 */
  function drawCourt(ctx, box) {
    const { x, y, w, h } = box;
    ctx.save();
    rr(ctx, x, y, w, h, 14);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#c98a4b');
    g.addColorStop(1, '#9a5f2e');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // 9×9 网格（跟 CSS 的 repeating-linear-gradient 100%/9 对齐）
    ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COURT_SIZE; i++) {
      const gx = x + (i / COURT_SIZE) * w;
      const gy = y + (i / COURT_SIZE) * h;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    }

    // 3m 进攻线：9m 场地里正好在 1/3 处
    const lineY = y + h / 3;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x + w, lineY); ctx.stroke();
    ctx.font = f(600, 15);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('3m 线', x + 14, lineY - 12);

    // 网：顶端 12px 的网格带 + 下沿白线
    const netH = 12;
    ctx.fillStyle = 'rgba(10,15,26,.55)';
    ctx.fillRect(x, y, w, netH);
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    for (let gx = x; gx <= x + w; gx += 7) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + netH); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + netH); ctx.lineTo(x + w, y + netH); ctx.stroke();

    ctx.restore();

    // 「网」标在球场外上方，别画在场内：前排角色常贴着网（y≈0.85m），
    // 场内标签会被棋子圆盖住，看起来像糊了一块字。
    ctx.textAlign = 'left';
    ctx.font = f(700, 15);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText('↑ 网', x + 4, y - 12);

    // 白色外框（clip 之外画，避免被圆角吃掉）
    rr(ctx, x, y, w, h, 14);
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawToken(ctx, role, box) {
    const pt = courtPoint(role.x, role.y, box);
    const r = 26;
    const color = role.color || '#7b6cff';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    const g = ctx.createLinearGradient(pt.x - r, pt.y - r, pt.x + r, pt.y + r);
    g.addColorStop(0, color);
    g.addColorStop(1, '#ffffff');
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0b0d16';
    ctx.font = f(800, 17);
    const full = String(role.label || '');
    const short = shortLabel(full);
    ctx.fillText(short, pt.x, pt.y + 1);

    // 圆下只补「被缩写掉」的那部分：主攻1 → 圆内「主1」、圆下「主攻1」；
    // 副攻/接应/二传的短标就是全名，再写一遍纯属复读。
    // 精确坐标统一放图例，场上不堆文字，避免两人挨着时糊成一团。
    if (short !== full) {
      ctx.textBaseline = 'alphabetic';
      ctx.font = f(700, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(full, pt.x, pt.y + r + 22);
    }
  }

  function drawLegend(ctx, roles, top) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 14, true);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('POSITIONS / 站位', PAD, top);

    const colW = (W - PAD * 2) / 2;
    roles.forEach((role, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = PAD + col * colW;
      const y = top + 42 + row * 66;
      ctx.beginPath(); ctx.arc(x + 10, y - 5, 8, 0, Math.PI * 2);
      ctx.fillStyle = role.color || '#7b6cff';
      ctx.fill();
      ctx.font = f(700, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(role.label || ''), x + 30, y);
      ctx.font = f(500, 13, true);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      const xm = clampMeters(role.x).toFixed(2);
      const ym = clampMeters(role.y).toFixed(2);
      ctx.fillText(`x ${xm}m · 距网 ${ym}m`, x + 30, y + 22);
    });
  }

  async function render(payload) {
    const p = payload || {};
    const roles = Array.isArray(p.roles) ? p.roles : [];
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    bg(ctx);

    /* 头部 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(500, 15, true);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('XGY VOLLEYBALL · FORMATION CARD', PAD, 86);
    if (p.date) {
      ctx.textAlign = 'right';
      ctx.fillText(String(p.date), W - PAD, 86);
      ctx.textAlign = 'left';
    }

    ctx.font = f(800, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.team || '排球队管理系统', PAD, 136);

    ctx.font = f(500, 21);
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.fillText(`${p.name || '默认站位'} · 半场 9×9m · 坐标从网起算`, PAD, 176);

    /* 球场 + 6 个角色位 */
    const box = { x: PAD, y: 216, w: W - PAD * 2, h: W - PAD * 2 };
    drawCourt(ctx, box);
    roles.forEach((role) => drawToken(ctx, role, box));

    /* 图例（含精确坐标，讲站位时对着念） */
    drawLegend(ctx, roles, 906);

    ctx.textAlign = 'center';
    ctx.font = f(500, 15);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('长按图片保存，直接发群里讲站位 · 图片在你自己设备上生成，不经过服务器', W / 2, 1150);

    ctx.font = f(500, 14, true);
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillText('GENERATED BY CAPTAIN · 排球队管理系统', W / 2, H - 46);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return { dataURL: cv.toDataURL('image/png'), blob, canvas: cv };
  }

  const api = { render, courtPoint, shortLabel, clampMeters, W, H };
  if (typeof window !== 'undefined') window.XGYCourt = api;
  // Node 专用导出钩子：浏览器里 module 恒为 undefined，整段是死代码。
  // 让 tests/ 能用 vm 加载本文件直接测纯函数，不用为测试改任何绘制逻辑。
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
