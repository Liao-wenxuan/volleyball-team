/* ═══════════════════════════════════════════════════════════════
 * playercard.js — 队员档案「单文件 HTML」导出器
 *
 * 为什么有这东西（r35）：
 *   原来队员要看自己的数据，要么扫码（长链接，微信里点开慢），
 *   要么登录 /m（得先发账号、首登强制改密、忘了密码还要重置）。
 *   15 个人 15 组密码，为看一眼出勤率，投入产出完全倒挂。
 *
 *   现在：教练端点一下，导出一个 .html 文件，微信发过去，
 *   队员双击/用浏览器打开，输自己的姓名+号码就能看。
 *   文件里没有网络请求、没有账号、没有服务端，断网也能看。
 *
 * 数据是快照：改了考勤/技能，重新导一次再发（页面底部有快照时间）。
 * 请假仍然能走：单文件里点「请假」→ 生成回执码 → 微信发给教练 →
 *   教练在考勤页点「回执」粘贴登记。回执码算法与 share.js 完全一致
 *   （fpOf / crc8 / b32 / dayIndex 都是逐字复刻，改一边必须改另一边）。
 *
 * 导出方式：
 *   XGYPlayerCard.build(payload)  → 完整 HTML 字符串
 *   XGYPlayerCard.download(payload) → 触发浏览器下载
 * payload 由 app.js 的 sharePayload() 生产，结构：
 *   { v, team, at, players:[{id,n,pos,no,att,sk,base,note,nc}],
 *     sessions:[{d,t,p,l,v,a,st}], next:[{d,t}] }
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SKILL_LABELS = ['发球', '一传', '二传', '扣球', '拦网', '防守'];
  const SKILL_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'defense'];

  /* ══════════ 单文件里的样式：独立一套，不引用主站 CSS ══════════ */
  const CSS = `
:root{
  --bg:#07080d; --bg2:#0c0f18;
  --card:rgba(255,255,255,.045); --card2:rgba(255,255,255,.07);
  --line:rgba(255,255,255,.10); --line2:rgba(255,255,255,.06);
  --tx:#eef1f8; --dim:#98a0b8; --dim2:#6d7590;
  --violet:#7b6cff; --cyan:#46e0ff; --green:#37e39b; --amber:#ffc46b; --red:#ff6d6d; --pink:#fb7299;
  color-scheme:dark;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{
  background:
    radial-gradient(1100px 620px at 12% -12%, rgba(123,108,255,.20), transparent 60%),
    radial-gradient(900px 560px at 96% 4%, rgba(70,224,255,.14), transparent 62%),
    var(--bg);
  color:var(--tx); min-height:100vh;
  font:15px/1.6 system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.02em}
.wrap{max-width:600px;margin:0 auto;padding:20px 16px calc(44px + env(safe-area-inset-bottom,0px))}
.top{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.ball{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:19px;
  background:linear-gradient(140deg,rgba(123,108,255,.32),rgba(70,224,255,.18));
  border:1px solid rgba(123,108,255,.42);box-shadow:0 8px 24px -14px rgba(123,108,255,.9)}
.top-txt{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.top-txt b{font-size:14px;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.top-txt em{font-size:10px;color:var(--dim2);letter-spacing:.18em;font-style:normal}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px;
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);margin-bottom:14px}
.card-t{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.card-t b{font-size:13px;letter-spacing:.06em;color:var(--dim)}
.card-t em{font-size:10px;font-style:normal;color:var(--dim2);letter-spacing:.14em}

/* ── 进门 ── */
.gate{padding-top:5vh;text-align:center}
/* 表单别跟着容器拉满：宽屏下 420px 居中，窄屏自然占满 */
.gate .field,.gate .btn{max-width:420px;margin-left:auto;margin-right:auto}
.gate .btn{display:block}
@media (min-width:700px) and (min-height:860px){
  .gate{padding-top:11vh}
}
.gate h1{font-size:26px;margin:0 0 8px;letter-spacing:-.01em;font-weight:800;font-style:normal;-webkit-font-smoothing:antialiased}
.gate p.s{color:var(--dim);margin:0 0 26px;font-size:13px}
.field{text-align:left;margin-bottom:12px}
.field label{display:block;font-size:12px;color:var(--dim);margin-bottom:6px;letter-spacing:.04em}
.field input{width:100%;height:52px;padding:0 16px;border-radius:14px;font-size:17px;
  background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--tx);outline:none;
  transition:border-color .18s,background .18s;font-family:inherit}
.field input:focus{border-color:rgba(123,108,255,.72);background:rgba(123,108,255,.09)}
.field input::placeholder{color:var(--dim2)}
.btn{width:100%;height:52px;border:0;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;
  font-family:inherit;color:#0a0b12;
  background:linear-gradient(135deg,#8f83ff,#46e0ff);box-shadow:0 12px 30px -14px rgba(123,108,255,.95);
  transition:transform .12s,filter .18s}
.btn:active{transform:scale(.985)}
.btn[disabled]{filter:grayscale(.55) brightness(.72);cursor:default;box-shadow:none}
.btn-ghost{background:transparent;border:1px solid var(--line);color:var(--tx);box-shadow:none;font-weight:500}
.err{color:var(--red);font-size:13px;margin:10px 0 0;min-height:18px}
.hint{color:var(--dim2);font-size:12px;margin-top:18px;line-height:1.7}

/* ── 个人页头 ── */
.hero{display:flex;gap:14px;align-items:center}
.no{width:62px;height:62px;flex:0 0 62px;border-radius:20px;display:grid;place-items:center;
  font-size:24px;font-weight:700;letter-spacing:-.02em;
  background:linear-gradient(145deg,rgba(123,108,255,.28),rgba(70,224,255,.12));
  border:1px solid rgba(123,108,255,.40);color:#fff;
  box-shadow:0 14px 34px -20px rgba(123,108,255,1)}
.hero-mid{min-width:0;flex:1}
.hero-mid h1{margin:0;font-size:23px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hero-mid .sub{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.pill{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);
  color:var(--dim);background:rgba(255,255,255,.04)}
.snap{font-size:10px;color:var(--dim2);letter-spacing:.1em;text-align:right;line-height:1.5}

/* ── 出勤 ── */
.rate-row{display:flex;gap:16px;align-items:center}
.ring{position:relative;width:104px;height:104px;flex:0 0 104px}
.ring svg{transform:rotate(-90deg)}
.ring .ring-t{position:absolute;inset:0;display:grid;place-items:center;text-align:center;line-height:1.1}
.ring .ring-t b{font-size:24px;letter-spacing:-.02em}
.ring .ring-t small{display:block;font-size:10px;color:var(--dim2);letter-spacing:.1em;margin-top:2px}
.grid4{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.g4{background:rgba(255,255,255,.035);border:1px solid var(--line2);border-radius:13px;padding:9px 11px}
.g4 b{display:block;font-size:17px;letter-spacing:-.01em}
.g4 span{font-size:11px;color:var(--dim2)}
.g4.ok b{color:var(--green)} .g4.late b{color:var(--amber)}
.g4.leave b{color:var(--cyan)} .g4.off b{color:var(--red)}

/* ── 技能 ── */
.skill-wrap{display:flex;gap:8px;align-items:center}
.radar{flex:0 0 208px;width:208px;height:208px}
.rg{fill:none;stroke:rgba(255,255,255,.10);stroke-width:1}
.ra{stroke:rgba(255,255,255,.08);stroke-width:1}
.rp{fill:rgba(123,108,255,.22);stroke:#8f83ff;stroke-width:1.6;stroke-linejoin:round}
.rd{fill:#46e0ff}
.rd.w{fill:var(--amber);r:4}
.rl{font-size:10px;fill:var(--dim);font-family:inherit}
.rl.w{fill:var(--amber)}
.bars{flex:1;display:grid;gap:7px;min-width:0}
.bar{display:grid;grid-template-columns:34px 1fr 44px;gap:8px;align-items:center}
.bar i{font-size:11px;color:var(--dim);font-style:normal;white-space:nowrap}
.bar .track{display:block;height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.bar .fill{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#7b6cff,#46e0ff)}
.bar .val{font-size:11px;color:var(--dim);text-align:right;font-family:ui-monospace,monospace}
.bar .val.up{color:var(--green)}
.bar.weak .fill{background:linear-gradient(90deg,#ffc46b,#ff8a5c)}

/* ── 点评 ── */
.note{position:relative;padding-left:16px;color:#dfe4f2;font-size:14px;line-height:1.85}
.note:before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:2px;border-radius:2px;
  background:linear-gradient(180deg,#7b6cff,#46e0ff)}
.note-src{font-size:10px;color:var(--dim2);letter-spacing:.14em;margin-top:10px}

/* ── 请假 ── */
.leave-opt,.reason{font-family:inherit;cursor:pointer;transition:border-color .16s,background .16s,color .16s}
.leave-list{display:grid;gap:8px;margin-bottom:14px}
.leave-opt{border:1px solid var(--line);background:rgba(255,255,255,.035);border-radius:14px;
  padding:12px 14px;text-align:left;color:var(--tx)}
.leave-opt b{display:block;font-size:14px}
.leave-opt em{font-size:11px;color:var(--dim2);font-style:normal}
.leave-opt.on{border-color:rgba(123,108,255,.85);background:rgba(123,108,255,.16)}
.reasons{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
.reason{border:1px solid var(--line);background:transparent;color:var(--dim);
  border-radius:999px;padding:7px 13px;font-size:12.5px}
.reason.on{border-color:rgba(70,224,255,.8);color:var(--cyan);background:rgba(70,224,255,.12)}
.rcpt{margin-top:14px;padding:14px;border-radius:15px;border:1px dashed rgba(70,224,255,.42);
  background:rgba(70,224,255,.06)}
.rcpt small{font-size:10px;color:var(--dim2);letter-spacing:.14em}
.rcpt-code{display:block;font-size:19px;letter-spacing:.16em;margin:8px 0 10px;color:#fff;
  font-family:ui-monospace,monospace}
.rcpt p{font-size:11.5px;color:var(--dim);margin:0 0 10px}
.rcpt-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rcpt-acts .btn{height:42px;font-size:13px}
.rcpt-st{font-size:11px;color:var(--cyan);margin-top:8px;min-height:16px}
.empty{color:var(--dim2);font-size:13px;padding:6px 0}

/* ── 记录 ── */
.tl{display:grid;gap:9px}
.tl-row{display:grid;grid-template-columns:76px 1fr auto;gap:10px;align-items:center;font-size:13px}
.tl-row .d{color:var(--dim2);font-size:11.5px;font-family:ui-monospace,monospace}
.tl-row .bar-c{height:5px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}
.tl-row .bar-c i{display:block;height:100%;border-radius:99px;background:rgba(55,227,155,.75)}
.tl-row .st{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
.st.ok{color:var(--green);border-color:rgba(55,227,155,.42);background:rgba(55,227,155,.10)}
.st.late{color:var(--amber);border-color:rgba(255,196,107,.42);background:rgba(255,196,107,.10)}
.st.leave{color:var(--cyan);border-color:rgba(70,224,255,.42);background:rgba(70,224,255,.10)}
.st.off{color:var(--red);border-color:rgba(255,109,109,.42);background:rgba(255,109,109,.10)}
.st.none{color:var(--dim2)}

/* ── 名册 ── */
.roster{display:grid;gap:8px}
.rp-row{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:14px;
  border:1px solid var(--line2);background:rgba(255,255,255,.03);cursor:pointer;
  font-family:inherit;color:var(--tx);text-align:left;width:100%}
.rp-row:active{background:rgba(255,255,255,.07)}
.rp-no{width:34px;height:34px;flex:0 0 34px;border-radius:11px;display:grid;place-items:center;
  font-size:13px;font-weight:700;background:rgba(123,108,255,.22);border:1px solid rgba(123,108,255,.4)}
.rp-name{flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-pos{font-size:11px;color:var(--dim2)}
.rp-row .rp-rate{font-size:12px;color:var(--dim);font-family:ui-monospace,monospace}

.foot{margin-top:26px;text-align:center;font-size:11px;color:var(--dim2);line-height:1.9}
.foot a{color:var(--dim);text-decoration:none;border-bottom:1px dotted var(--line);cursor:pointer}
.toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,16px);opacity:0;
  background:#161a26;border:1px solid var(--line);color:var(--tx);padding:11px 18px;border-radius:12px;
  font-size:13px;transition:.22s;pointer-events:none;z-index:99;box-shadow:0 16px 40px -18px #000}
.toast.on{opacity:1;transform:translate(-50%,0)}
/* ══════════ 移动端适配 ══════════ */
@media (max-width:430px){
  /* 雷达随屏宽缩放（viewBox 208，等比缩不糊） */
  .skill-wrap{flex-direction:column}
  .radar{width:min(244px,74vw);height:auto;flex:none;margin:0 auto;display:block}
  /* 竖排后 bars 会被 align-items:center 收缩，1fr 进度条被挤成 0 宽——必须显式撑满 */
  .bars{width:100%;flex:none}
  /* 头部：快照时间窄屏挪到下一行，不再跟姓名抢宽度 */
  .hero{flex-wrap:wrap}
  .snap{width:100%;text-align:left;margin-top:4px;letter-spacing:.06em}
  .no{width:54px;height:54px;flex:0 0 54px;font-size:21px;border-radius:17px}
  .hero-mid h1{font-size:21px}
  .tl-row{grid-template-columns:64px 1fr auto}
  .rcpt-code{font-size:17px;letter-spacing:.12em}
  /* 大标题在窄屏略收，避免两行 */
  .gate h1{font-size:23px}
}
@media (max-width:360px){
  .wrap{padding:14px 12px calc(36px + env(safe-area-inset-bottom,0px))}
  .card{padding:15px;border-radius:17px}
  .g4{padding:8px 9px}
  .field input{height:48px;font-size:16px}
  .btn{height:48px;font-size:15px}
}
@media print{body{background:#fff;color:#000}.card{border-color:#ddd;background:#fff}.btn,.foot{display:none}}
`;

  /* ══════════ 单文件里的运行时代码 ══════════
   * 整个函数会被 toString() 内联进导出文件，所以：
   *   1. 不能引用这个文件里的任何外部变量（全部在函数内自备）
   *   2. 不能出现字面量 </script>（用 '<\/script>' 代替）
   */
  function cardRuntime() {
    var D = { players: [], sessions: [], next: [], team: '排球队', at: Date.now() };
    try {
      var raw = document.getElementById('card-data').textContent;
      D = JSON.parse(raw);
    } catch (e) { /* 数据坏了也要能开页面，下面显示空态 */ }

    var SKILL_LABELS = ['发球', '一传', '二传', '扣球', '拦网', '防守'];
    var SKILL_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'defense'];
    var TIP_OF = {
      serve: '每天 50 个定点发球，先追稳定再追力量',
      receive: '对墙垫球 200 次，接球前先迈一步把身体对正',
      set: '网前定点传球 100 次，重点练手腕弹送',
      spike: '三步助跑起跳 30 次，先打准线再追球速',
      block: '拦网步加手型 15 分钟，练跟球不跟人',
      defense: '低姿移动接球 10 组、每组 20 个'
    };
    var ST_LABEL = { present: '出勤', late: '迟到', leave: '请假', absent: '缺席' };
    var REASONS = ['生病', '家里有事', '课程冲突', '考试', '实习/工作', '其他'];
    var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    var EPOCH_DAY = Date.UTC(2024, 0, 1) / 86400000;
    var SELF_KEY = 'xgy_pc_self';

    /* ── 小工具 ── */
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function f1(n) { return (Number(n) || 0).toFixed(1); }
    function normName(s) { return String(s || '').replace(/\s+/g, ''); }
    function rateOf(att) {
      var marked = (att.p || 0) + (att.l || 0) + (att.v || 0) + (att.a || 0);
      if (!marked) return null;
      return Math.round((((att.p || 0) + (att.l || 0)) / marked) * 100);
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function fmtDayCN(ds) {
      var d = new Date(String(ds || '') + 'T00:00:00');
      if (isNaN(d.getTime())) return String(ds || '');
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK_CN[d.getDay()];
    }
    function fmtSnap(at) {
      var d = new Date(at), p = pad2;
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function toast(t) {
      var el = document.getElementById('toast');
      el.textContent = t;
      el.classList.add('on');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.classList.remove('on'); }, 2200);
    }
    function copyText(t) {
      return new Promise(function (resolve) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () { resolve(true); }, function () { resolve(fallback()); });
          return;
        }
        resolve(fallback());
        function fallback() {
          try {
            var ta = document.createElement('textarea');
            ta.value = t;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:-999px;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, t.length);
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
          } catch (e) { return false; }
        }
      });
    }

    /* ── 点评：AI 写的优先，没有就用同一套规则现场生成 ── */
    function localNote(rate, sk, base) {
      var head = rate == null
        ? '考勤还没登记，先把到场记起来才有得聊'
        : rate >= 90 ? '出勤 ' + rate + '%，几乎没缺过，这份稳定队里都看得见'
          : rate >= 70 ? '出勤 ' + rate + '%，再少请一次假，状态就能连起来'
            : '出勤 ' + rate + '%，来得少身体记不住动作，先从每周到场两次开始';
      var bestI = 0, i;
      for (i = 1; i < 6; i++) if (sk[i] - base[i] > sk[bestI] - base[bestI]) bestI = i;
      var gain = +(sk[bestI] - base[bestI]).toFixed(1);
      var up = gain > 0.05
        ? SKILL_LABELS[bestI] + '从 ' + base[bestI].toFixed(1) + ' 涨到 ' + sk[bestI].toFixed(1) + '，这 ' + gain.toFixed(1) + ' 分是你自己练出来的'
        : '技能分还没动，第一次进步往往来得比想象中快';
      var weakI = 0;
      for (i = 1; i < 6; i++) if (sk[i] < sk[weakI]) weakI = i;
      var tip = '现在最该补的是' + SKILL_LABELS[weakI] + '（' + sk[weakI].toFixed(1) + '），' + TIP_OF[SKILL_KEYS[weakI]];
      var tail = rate != null && rate >= 90 ? '保持这个节奏，你会是场上让人放心的那个。' : '不用急，这周比上周多来一次就够了。';
      return head + '。' + up + '。' + tip + '。' + tail;
    }

    /* ── 六维雷达 ── */
    function radarSVG(values, size, weakIndex) {
      var cx = size / 2, cy = size / 2, R = size / 2 - 34;
      function pt(i, r) {
        var a = (Math.PI / 3) * i - Math.PI / 2;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      }
      function ring(f) {
        var pts = [];
        for (var i = 0; i < 6; i++) pts.push(pt(i, R * f).join(','));
        return pts.join(' ');
      }
      var poly = [], axes = [], labels = [], i;
      for (i = 0; i < 6; i++) {
        var v = Math.max(0, Math.min(10, Number(values[i]) || 0));
        poly.push(pt(i, R * (v / 10)).join(','));
      }
      for (i = 0; i < 6; i++) {
        var p = pt(i, R);
        axes.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" class="ra"/>');
        var l = pt(i, R + 17);
        labels.push('<text x="' + l[0] + '" y="' + l[1] + '" class="rl' + (i === weakIndex ? ' w' : '') + '" text-anchor="middle" dominant-baseline="middle">' + SKILL_LABELS[i] + '</text>');
      }
      var dots = poly.map(function (s, k) {
        var xy = s.split(',');
        return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + (k === weakIndex ? 4 : 2.6) + '" class="rd' + (k === weakIndex ? ' w' : '') + '"/>';
      }).join('');
      return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="radar" role="img" aria-label="六项技能雷达图">' +
        '<polygon points="' + ring(1) + '" class="rg"/><polygon points="' + ring(0.66) + '" class="rg"/><polygon points="' + ring(0.33) + '" class="rg"/>' +
        axes.join('') + '<polygon points="' + poly.join(' ') + '" class="rp"/>' + dots + labels.join('') + '</svg>';
    }

    /* ── 出勤环 ── */
    function ringSVG(rate) {
      var r = 44, c = 2 * Math.PI * r, pct = rate == null ? 0 : rate;
      var dash = (c * pct) / 100;
      return '<svg width="104" height="104" viewBox="0 0 104 104">' +
        '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="8"/>' +
        '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="url(#rg1)" stroke-width="8" stroke-linecap="round" ' +
        'stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
        '<defs><linearGradient id="rg1" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#8f83ff"/><stop offset="1" stop-color="#46e0ff"/></linearGradient></defs></svg>';
    }

    /* ── 回执码（与 share.js 逐字对齐） ── */
    function crc8(bytes) {
      var crc = 0;
      for (var i = 0; i < bytes.length; i++) {
        crc ^= bytes[i];
        for (var b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
      }
      return crc;
    }
    function fpOf(name, no) {
      var s = String(name == null ? '' : name).replace(/\s+/g, '') + '#' + (Number(no) || 0);
      var b = new TextEncoder().encode(s);
      var h = 0x811c9dc5;
      for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      return h & 0xffff;
    }
    function b32enc(bytes) {
      var out = '', buf = 0, bits = 0;
      for (var i = 0; i < bytes.length; i++) {
        buf = (buf << 8) | bytes[i]; bits += 8;
        while (bits >= 5) { out += B32[(buf >>> (bits - 5)) & 31]; bits -= 5; }
      }
      if (bits) out += B32[(buf << (5 - bits)) & 31];
      return out;
    }
    function dayIndex(ds) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ds || ''));
      if (!m) return 0;
      return Math.max(0, Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 - EPOCH_DAY));
    }
    function encodeReceipt(o) {
      var bits = [];
      function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
      put(1, 3);
      put(fpOf(o.name, o.no), 16);
      put(dayIndex(o.date), 15);
      var tt = String(o.start || '00:00').split(':');
      put(Math.max(0, Math.min(63, Math.round(Number(tt[0]) || 0))), 5);
      put(Math.max(0, Math.min(63, Math.round(Number(tt[1]) || 0))), 6);
      put(Math.max(0, Math.min(7, Number(o.reason) || 0)), 3);
      while (bits.length % 8) bits.push(0);
      var body = new Uint8Array(bits.length / 8);
      for (var i = 0; i < bits.length; i += 8) {
        var v = 0;
        for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
        body[i / 8] = v;
      }
      var full = new Uint8Array(body.length + 1);
      full.set(body, 0);
      full[body.length] = crc8(body);
      return b32enc(full).replace(/(.{4})(?=.)/g, '$1-');
    }

    /* ── 找自己 ── */
    function matchPlayer(name, no) {
      var players = D.players || [];
      var needNo = players.some(function (p) { return Number(p.no) > 0; });
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (normName(p.n) !== name) continue;
        if (!needNo) return p;
        if (!Number(p.no)) { if (!no) return p; continue; }
        if (String(Number(p.no)) === no) return p;
      }
      return null;
    }

    /* ── 视图 ── */
    var app = document.getElementById('app');

    function topBar() {
      return '<div class="top">' +
        '<div class="ball" aria-hidden="true">🏐</div>' +
        '<div class="top-txt"><b>' + esc(D.team || '排球队') + '</b><em>MY TRAINING FILE</em></div></div>';
    }

    function viewGate(errText) {
      var saved = '';
      try { saved = (JSON.parse(localStorage.getItem(SELF_KEY) || 'null') || {}).n || ''; } catch (e) { }
      app.innerHTML = topBar() +
        '<div class="gate">' +
        '<h1>看看你自己的训练档案</h1>' +
        '<p class="s">输姓名和球衣号码，数据就在这个文件里，不会联网。</p>' +
        '<div class="field"><label for="gName">姓名</label>' +
        '<input id="gName" placeholder="比如 张三" autocomplete="off" autocapitalize="off" value="' + esc(saved) + '"></div>' +
        '<div class="field"><label for="gNo">球衣号码</label>' +
        '<input id="gNo" placeholder="比如 7" inputmode="numeric" autocomplete="off"></div>' +
        '<button class="btn" id="gGo" type="button">看我的档案</button>' +
        '<p class="err" id="gErr">' + esc(errText || '') + '</p>' +
        '<p class="hint">队伍名册里有你的名字才能查到。<br>看不到自己的数据，找队长确认一下号码。</p>' +
        '</div>';
      var go = function () {
        var n = normName(document.getElementById('gName').value);
        var no = String(document.getElementById('gNo').value || '').replace(/\D/g, '');
        var p = matchPlayer(n, no);
        if (!p) {
          document.getElementById('gErr').textContent = '没找到这个人。姓名要和名册里一致，号码别填错。';
          return;
        }
        try { localStorage.setItem(SELF_KEY, JSON.stringify({ n: p.n, no: p.no })); } catch (e) { }
        viewMe(p);
      };
      document.getElementById('gGo').onclick = go;
      document.getElementById('gNo').onkeydown = function (e) { if (e.key === 'Enter') go(); };
      document.getElementById('gName').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    }

    function viewMe(p) {
      var rate = rateOf(p.att || {});
      var sk = (p.sk || []).map(Number);
      var base = (p.base || []).map(Number);
      while (sk.length < 6) sk.push(5);
      while (base.length < 6) base.push(5);
      var weakI = 0;
      for (var i = 1; i < 6; i++) if (sk[i] < sk[weakI]) weakI = i;
      var note = p.note && String(p.note).trim() ? p.note : localNote(rate, sk, base);
      var aiMark = p.note && String(p.note).trim() ? 'AI 点评' : '系统归纳';
      var att = p.att || {};

      var bars = SKILL_LABELS.map(function (lab, k) {
        var d = sk[k] - base[k];
        var sign = d > 0.049 ? '+' + d.toFixed(1) : d < -0.049 ? d.toFixed(1) : '';
        return '<div class="bar' + (k === weakI ? ' weak' : '') + '">' +
          '<i>' + lab + '</i>' +
          '<span class="track"><span class="fill" style="width:' + (sk[k] / 10 * 100).toFixed(1) + '%"></span></span>' +
          '<span class="val' + (d > 0.049 ? ' up' : '') + '">' + f1(sk[k]) + (sign ? ' ' + sign : '') + '</span></div>';
      }).join('');

      /* 近 8 次记录 */
      var rows = (D.sessions || []).map(function (s) {
        var st = (s.st || {})[p.id];
        return { d: s.d, st: st };
      }).slice(-8);
      var tl = rows.length ? '<div class="tl">' + rows.map(function (r) {
        var st = r.st || 'none';
        var w = st === 'present' ? 100 : st === 'late' ? 78 : st === 'leave' ? 46 : 10;
        return '<div class="tl-row"><span class="d">' + esc(String(r.d || '').slice(5)) + '</span>' +
          '<span class="bar-c"><i style="width:' + w + '%"></i></span>' +
          '<span class="st ' + st + '">' + (ST_LABEL[st] || '没登记') + '</span></div>';
      }).join('') + '</div>' : '<p class="empty">还没有登记过考勤。</p>';

      var next = (D.next || []).filter(function (x) { return x && x.d; }).slice(0, 4);
      var leaveHTML = next.length
        ? '<div class="leave-list">' + next.map(function (x, k) {
          return '<button type="button" class="leave-opt" data-i="' + k + '"><b>' + esc(fmtDayCN(x.d)) + '</b><em>' + esc(x.t || '') + ' 待训练</em></button>';
        }).join('') + '</div>' +
          '<div class="reasons">' + REASONS.map(function (r, k) {
            return '<button type="button" class="reason" data-r="' + k + '">' + esc(r) + '</button>';
          }).join('') + '</div>' +
          '<button class="btn" id="mkRcpt" type="button" disabled>生成请假回执</button>' +
          '<div class="rcpt" id="rcptBox" hidden><small>LEAVE RECEIPT</small>' +
          '<b class="rcpt-code" id="rcptCode">—</b>' +
          '<p>把这行发给队长，他在考勤页点「回执」粘进去就登记好了。</p>' +
          '<div class="rcpt-acts"><button class="btn" id="cpRcpt" type="button">复制回执</button>' +
          '<button class="btn btn-ghost" id="cpRcptLink" type="button">复制回执链接</button></div>' +
          '<p class="rcpt-st" id="rcptSt"></p></div>'
        : '<p class="empty">这个文件生成的时候，暂时没有还没开始的训练。</p>';

      app.innerHTML = topBar() +
        '<div class="card"><div class="hero">' +
        '<div class="no">' + (Number(p.no) ? esc(p.no) : '—') + '</div>' +
        '<div class="hero-mid"><h1>' + esc(p.n) + '</h1><div class="sub">' +
        (p.pos ? '<span class="pill">' + esc(p.pos) + '</span>' : '') +
        '<span class="pill">' + (rate == null ? '暂无考勤' : '出勤率 ' + rate + '%') + '</span>' +
        '</div></div>' +
        '<div class="snap mono">SNAPSHOT<br>' + esc(fmtSnap(D.at)) + '</div>' +
        '</div></div>' +

        '<div class="card"><div class="card-t"><b>出勤</b><em>ATTENDANCE</em></div>' +
        '<div class="rate-row"><div class="ring">' + ringSVG(rate) +
        '<div class="ring-t"><div><b>' + (rate == null ? '—' : rate + '%') + '</b><small>出勤率</small></div></div></div>' +
        '<div class="grid4">' +
        '<div class="g4 ok"><b>' + (att.p || 0) + '</b><span>出勤</span></div>' +
        '<div class="g4 late"><b>' + (att.l || 0) + '</b><span>迟到</span></div>' +
        '<div class="g4 leave"><b>' + (att.v || 0) + '</b><span>请假</span></div>' +
        '<div class="g4 off"><b>' + (att.a || 0) + '</b><span>缺席</span></div>' +
        '</div></div></div>' +

        '<div class="card"><div class="card-t"><b>六项技能</b><em>SKILLS · 满分 10</em></div>' +
        '<div class="skill-wrap">' + radarSVG(sk, 208, weakI) + '<div class="bars">' + bars + '</div></div></div>' +

        '<div class="card"><div class="card-t"><b>教练点评</b><em>' + esc(aiMark) + '</em></div>' +
        '<div class="note">' + esc(note) + '</div></div>' +

        '<div class="card"><div class="card-t"><b>请假</b><em>LEAVE</em></div>' + leaveHTML + '</div>' +

        '<div class="card"><div class="card-t"><b>近 8 次</b><em>RECENT</em></div>' + tl + '</div>' +

        '<div class="foot">数据快照于 ' + esc(fmtSnap(D.at)) + '，之后的变化要等队长重新导出发给你。<br>' +
        '<a id="toGate">换个人看</a> · <a id="toRoster">队内名册</a></div>';

      document.getElementById('toGate').onclick = function () { viewGate(); };
      document.getElementById('toRoster').onclick = function () { viewRoster(); };
      wireLeave(p, next);
    }

    function wireLeave(p, next) {
      var mk = document.getElementById('mkRcpt');
      if (!mk || !next.length) return;
      var opts = [].slice.call(document.querySelectorAll('.leave-opt'));
      var chips = [].slice.call(document.querySelectorAll('.reason'));
      var box = document.getElementById('rcptBox');
      var codeEl = document.getElementById('rcptCode');
      var st = document.getElementById('rcptSt');
      var pick = -1, reason = -1;
      function sync() { mk.disabled = !(pick >= 0 && reason >= 0); }
      opts.forEach(function (b) {
        b.onclick = function () {
          pick = Number(b.dataset.i);
          opts.forEach(function (x) { x.classList.toggle('on', x === b); });
          sync();
        };
      });
      chips.forEach(function (b) {
        b.onclick = function () {
          reason = Number(b.dataset.r);
          chips.forEach(function (x) { x.classList.toggle('on', x === b); });
          sync();
        };
      });
      mk.onclick = function () {
        var s = next[pick];
        var code;
        try {
          code = encodeReceipt({ name: p.n, no: p.no, date: s.d, start: s.t, reason: reason });
        } catch (e) {
          st.textContent = '生成失败：' + (e && e.message ? e.message : '未知错误');
          return;
        }
        var msg = '【请假回执】' + p.n + (p.no ? ' #' + p.no : '') + '\n' + fmtDayCN(s.d) + ' ' + (s.t || '') +
          '\n原因：' + (REASONS[reason] || '其他') + '\n回执码：' + code +
          '\n（队长：考勤页 →「回执」→ 粘贴这一行）';
        codeEl.textContent = code;
        box.hidden = false;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.getElementById('cpRcpt').onclick = function () {
          copyText(msg).then(function (ok) { st.textContent = ok ? '已复制，粘到微信发给队长' : '复制被拦了，长按上面的码手动复制'; });
        };
        document.getElementById('cpRcptLink').onclick = function () {
          var url = location.href.split('#')[0] + '#rcpt=' + code;
          copyText(url).then(function (ok) { st.textContent = ok ? '回执链接已复制' : '复制被拦了，改用上面的码'; });
        };
      };
    }

    function viewRoster() {
      var list = (D.players || []).slice().sort(function (a, b) { return (Number(a.no) || 99) - (Number(b.no) || 99); });
      app.innerHTML = topBar() +
        '<div class="card"><div class="card-t"><b>队内名册</b><em>ROSTER · ' + list.length + ' 人</em></div>' +
        '<div class="roster">' + (list.length ? list.map(function (p, i) {
          var r = rateOf(p.att || {});
          return '<button type="button" class="rp-row" data-i="' + i + '">' +
            '<span class="rp-no">' + (Number(p.no) ? esc(p.no) : '—') + '</span>' +
            '<span class="rp-name">' + esc(p.n) + '</span>' +
            '<span class="rp-pos">' + esc(p.pos || '') + '</span>' +
            '<span class="rp-rate">' + (r == null ? '—' : r + '%') + '</span></button>';
        }).join('') : '<p class="empty">名册是空的。</p>') + '</div></div>' +
        '<div class="foot"><a id="backGate">← 回到登录</a></div>';
      [].slice.call(document.querySelectorAll('.rp-row')).forEach(function (b) {
        b.onclick = function () { viewMe(list[Number(b.dataset.i)]); };
      });
      document.getElementById('backGate').onclick = function () { viewGate(); };
    }

    /* ── 启动 ── */
    var first = String(location.hash || '');
    if (first.indexOf('#p=') === 0) {
      var want = decodeURIComponent(first.slice(3));
      var hit = null;
      for (var i = 0; i < (D.players || []).length; i++) if (D.players[i].id === want) hit = D.players[i];
      if (hit) { viewMe(hit); return; }
    }
    viewGate();
  }

  /* ══════════ 组装成完整 HTML ══════════ */
  function build(payload) {
    const team = String(payload.team || '排球队');
    const at = payload.at || Date.now();
    const d = new Date(at);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    // JSON 里的 < 必须转义，否则队员名字里带 </script> 就能提前闭合脚本标签
    const data = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
    const runtime = cardRuntime.toString();

    return `<!doctype html>
<html lang="zh-CN" data-mode="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07080d">
<meta name="generator" content="XGY Volleyball · playercard r35">
<title>${escHTML(team)} · 训练档案</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap" id="app"></div>
<div class="toast" id="toast"></div>
<script id="card-data" type="application/json">${data}</script>
<script>(${runtime})();</script>
</body>
</html>`;
  }

  function escHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 文件名：信工院排球队-训练档案-2026-11-04.html */
  function fileName(payload) {
    const d = new Date(payload.at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${String(payload.team || '排球队')}-训练档案-${day}.html`;
  }

  function download(payload) {
    const html = build(payload);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(payload);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return { name: fileName(payload), size: html.length, count: (payload.players || []).length };
  }

  window.XGYPlayerCard = { build, download, fileName, KB: (s) => (s / 1024).toFixed(1) };
})();
