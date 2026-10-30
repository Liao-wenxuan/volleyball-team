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
  const SELF_KEY = 'xgy_share_self'; // 验证通过后记住「姓名+号码」，下次打开免输（只存本机）

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

  /* ══════════ 紧凑按位打包 ══════════
     为什么不用 JSON：JSON 里每个数字都要好几个字符，光 10 个人的技能分
     就吃掉 600 字符；按位打包后同样的信息只要 18 字节/人。
     数据越小二维码版本越低、模块越少，手机上才扫得动。 */
  var POS_LIST = ['主攻', '副攻', '二传', '接应', '自由人'];
  var ST_CODE = { present: 1, late: 2, leave: 3, absent: 4 };
  var ST_NAME = ['', 'present', 'late', 'leave', 'absent'];
  var EPOCH_DAY = Date.UTC(2024, 0, 1) / 86400000;

  function BitW() { this.bits = []; }
  BitW.prototype.put = function (val, n) {
    for (var i = n - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };
  BitW.prototype.text = function (str, lenBits) {
    var enc = new TextEncoder().encode(str == null ? '' : String(str));
    var max = (1 << lenBits) - 1;
    if (enc.length > max) enc = enc.slice(0, max);
    this.put(enc.length, lenBits);
    for (var i = 0; i < enc.length; i++) this.put(enc[i], 8);
  };
  BitW.prototype.done = function () {
    while (this.bits.length % 8) this.bits.push(0);
    var out = new Uint8Array(this.bits.length / 8);
    for (var i = 0; i < this.bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | this.bits[i + k];
      out[i / 8] = v;
    }
    return out;
  };

  function BitR(bytes) { this.b = bytes; this.p = 0; }
  BitR.prototype.get = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      var idx = this.p >> 3;
      if (idx >= this.b.length) return v;
      v = (v << 1) | ((this.b[idx] >> (7 - (this.p & 7))) & 1);
      this.p++;
    }
    return v;
  };
  BitR.prototype.text = function (lenBits) {
    var n = this.get(lenBits);
    var arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) arr[i] = this.get(8);
    return new TextDecoder().decode(arr);
  };

  function dayIndex(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m) return 0;
    return Math.max(0, Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 - EPOCH_DAY));
  }
  function dayString(n) {
    var d = new Date((n + EPOCH_DAY) * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** 技能分 0–10（0.5 步长）→ 0–20，压进 5 bit */
  function q5(v) { return Math.max(0, Math.min(31, Math.round((Number(v) || 0) * 2))); }
  function q6(v) { return Math.max(0, Math.min(63, Math.round(Number(v) || 0))); }

  function pack(o) {
    var players = (o.players || []).slice(0, 31);
    var sessions = (o.sessions || []).slice(0, 15);
    var w = new BitW();
    w.put(3, 4);                                   // 格式版本（3 = 加入「接下来几次训练」和请假回执）
    w.text(o.team || '', 6);                       // 队名（≤63 字节）
    w.put(Math.round((Number(o.at) || Date.now()) / 1000 - EPOCH_DAY * 86400) >>> 0, 32);
    w.put(players.length, 5);
    players.forEach(function (p) {
      w.text(p.n, 6);
      w.put(q6(p.no), 7);
      w.put(Math.max(0, POS_LIST.indexOf(p.pos)), 3);
      var a = p.att || {};
      w.put(q6(a.p), 6); w.put(q6(a.l), 6); w.put(q6(a.v), 6); w.put(q6(a.a), 6);
      for (var i = 0; i < 6; i++) w.put(q5((p.sk || [])[i]), 5);
      for (var j = 0; j < 6; j++) w.put(q5((p.base || [])[j]), 5);
    });
    w.put(sessions.length, 4);
    sessions.forEach(function (s) {
      w.put(dayIndex(s.d), 15);
      var tt = String(s.t || '').split(':');
      w.put(q6(tt[0]), 5);
      w.put(q6(tt[1]), 6);
      var st = s.st || {};
      for (var i = 0; i < players.length; i++) w.put(ST_CODE[st[players[i].id]] || 0, 3);
    });
    // 接下来还没开始的几次训练：队员请假要从中挑一次，不然他不知道自己该请哪天
    var next = (o.next || []).slice(0, 4);
    w.put(next.length, 3);
    next.forEach(function (x) {
      w.put(dayIndex(x.d), 15);
      var nt = String(x.t || '').split(':');
      w.put(q6(nt[0]), 5);
      w.put(q6(nt[1]), 6);
    });
    // 只带 AI 写的那段；模板点评由队员端按同样规则现场算
    var notes = [];
    players.forEach(function (p, i) { if (p.note) notes.push({ i: i, t: String(p.note) }); });
    w.put(Math.min(notes.length, 15), 4);
    notes.slice(0, 15).forEach(function (x) {
      w.put(x.i, 5);
      w.text(x.t, 10);
    });
    return w.done();
  }

  function unpack(bytes) {
    var r = new BitR(bytes);
    var ver = r.get(4);
    if (ver !== 2 && ver !== 3) throw new Error('分享数据版本不认识');
    var team = r.text(6);
    var at = (r.get(32) + EPOCH_DAY * 86400) * 1000;
    var n = r.get(5);
    var players = [];
    for (var i = 0; i < n; i++) {
      var p = { id: 'p' + i, n: r.text(6), no: r.get(7), pos: POS_LIST[r.get(3)] || '' };
      p.att = { p: r.get(6), l: r.get(6), v: r.get(6), a: r.get(6) };
      p.sk = []; p.base = [];
      for (var k = 0; k < 6; k++) p.sk.push(r.get(5) / 2);
      for (var k2 = 0; k2 < 6; k2++) p.base.push(r.get(5) / 2);
      players.push(p);
    }
    var sn = r.get(4);
    var sessions = [];
    for (var s = 0; s < sn; s++) {
      var d = dayString(r.get(15));
      var hh = r.get(5), mi = r.get(6);
      var st = {};
      for (var q = 0; q < players.length; q++) {
        var code = r.get(3);
        if (code) st[players[q].id] = ST_NAME[code];
      }
      sessions.push({ d: d, t: pad2(hh) + ':' + pad2(mi), st: st });
    }
    var next = [];
    if (ver >= 3) {
      var nx = r.get(3);
      for (var y = 0; y < nx; y++) {
        var nd = dayString(r.get(15));
        var nh = r.get(5), nm = r.get(6);
        next.push({ d: nd, t: pad2(nh) + ':' + pad2(nm) });
      }
    }
    var nn = r.get(4);
    for (var z = 0; z < nn; z++) {
      var idx = r.get(5);
      var txt = r.text(10);
      if (players[idx]) { players[idx].note = txt; players[idx].nc = 1; }
    }
    return { v: ver, team: team, at: at, players: players, sessions: sessions, next: next };
  }

  async function encode(obj) {
    if (typeof CompressionStream !== 'undefined') {
      const buf = await new Response(
        new Blob([pack(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      ).arrayBuffer();
      return '2' + b64url(new Uint8Array(buf));
    }
    // 兜底：不支持压缩的老浏览器退回 JSON（体积大但不至于打不开）
    return '0' + b64url(new TextEncoder().encode(JSON.stringify(obj)));
  }

  async function decode(str) {
    const tag = str[0];
    const bytes = unb64url(str.slice(1));
    if (tag === '2') {
      if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器打不开新格式');
      const buf = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      ).arrayBuffer();
      return unpack(new Uint8Array(buf));
    }
    // 老链接（v1 的 JSON）继续能开
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

  /* ══════════ 请假回执码 ══════════
     没有服务器，请假这件事只能靠「人肉回传」：
     队员在分享页点请假 → 本机算出一串 12 位回执码 → 发到群里 →
     队长在考勤页粘贴，解出「谁 / 哪次 / 为什么」，一键登记成请假。

     码里不写明文姓名，只放 16 位「姓名+号码」指纹：队长端按同一算法
     把队里每个人算一遍就能对上人，码本身泄露不了名单。

     位分配（48 bit + 8 bit CRC）：
       3  格式版本（=1）
       16 姓名指纹
       15 日期（距 2024-01-01 的天数）
       5  开始小时
       6  开始分钟
       3  原因编号
     → 6 字节正文 + 1 字节 CRC8 → Crockford Base32 → 12 个字符
     字母表去掉 I / L / O / U：念出来不会混、抄写不会错。 */
  var REASONS = ['生病', '家里有事', '课程冲突', '考试', '实习/工作', '其他'];
  var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function crc8(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    return crc;
  }

  /** 队员指纹：姓名（去空白）+ 号码 的 FNV-1a 低 16 位，两端必须一模一样 */
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

  function b32dec(str) {
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var v = B32.indexOf(str[i]);
      if (v < 0) return null;
      buf = ((buf << 5) | v) & 0xffffff; bits += 5;
      if (bits >= 8) { out.push((buf >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  /** 把用户粘进来的东西（整段消息 / 带横线的码）归一成 12 位码 */
  function normalizeCode(input) {
    var t = String(input || '').toUpperCase();
    var url = t.match(/#RCPT=([0-9A-Z-]+)/);
    if (url) t = url[1];
    var grouped = t.match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    if (grouped) t = grouped[0];
    else {
      // 没横线：只在「独立词」里找 12 位的，避免把整段话的字母拼成假码
      var tok = t.split(/[^0-9A-Z]+/).filter(function (x) { return x.length === 12; });
      t = tok.length ? tok[0] : '';
    }
    var d = String(t).replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return d.length === 12 ? d : '';
  }

  function encodeReceipt(o) {
    var w = new BitW();
    w.put(1, 3);                                   // 回执格式版本
    w.put(fpOf(o.name, o.no), 16);
    w.put(dayIndex(o.date), 15);
    var tt = String(o.start || '00:00').split(':');
    w.put(q6(tt[0]), 5);
    w.put(q6(tt[1]), 6);
    w.put(Math.max(0, Math.min(7, Number(o.reason) || 0)), 3);
    var body = w.done();                            // 正好 6 字节
    var full = new Uint8Array(body.length + 1);
    full.set(body, 0);
    full[body.length] = crc8(body);
    var code = b32enc(full);
    return code.replace(/(.{4})(?=.)/g, '$1-');
  }

  function decodeReceipt(input) {
    var code = normalizeCode(input);
    if (!code) throw new Error('没找到 12 位回执码');
    var bytes = b32dec(code);
    if (!bytes || bytes.length < 7) throw new Error('回执码不完整');
    var body = bytes.subarray(0, 6);
    if (crc8(body) !== bytes[6]) throw new Error('回执码校验不过，可能粘漏了字符');
    var r = new BitR(body);
    var ver = r.get(3);
    if (ver !== 1) throw new Error('回执码版本不认识');
    var fp = r.get(16);
    var day = r.get(15);
    var hh = r.get(5), mm = r.get(6), reason = r.get(3);
    return {
      v: 1, fp: fp, date: dayString(day), start: pad2(hh) + ':' + pad2(mm),
      reason: reason, reasonText: REASONS[reason] || '其他', code: code
    };
  }

  /* ══════════ 常量（与 app.js 保持一致，刻意独立，分享页不依赖主应用） ══════════ */
  const SKILL_LABELS = ['发球', '一传', '二传', '扣球', '拦网', '防守'];

  /* 短板对应的练法 —— 与队长端 app.js 里那份保持一致。
     模板点评不进分享链接（那是纯规则算出来的，占一半体积），
     队员端用同样的规则现场算一遍，结果一模一样。 */
  const TIP_OF = {
    serve: '每天 50 个定点发球，先追稳定再追力量',
    receive: '对墙垫球 200 次，接球前先迈一步把身体对正',
    set: '网前定点传球 100 次，重点练手腕弹送',
    spike: '三步助跑起跳 30 次，先打准线再追球速',
    block: '拦网步加手型 15 分钟，练跟球不跟人',
    defense: '低姿移动接球 10 组、每组 20 个'
  };
  const SKILL_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'defense'];

  function localNote(rate, sk, base) {
    const head = rate == null
      ? '考勤还没登记，先把到场记起来才有得聊'
      : rate >= 90 ? `出勤 ${rate}%，几乎没缺过，这份稳定队里都看得见`
        : rate >= 70 ? `出勤 ${rate}%，再少请一次假，状态就能连起来`
          : `出勤 ${rate}%，来得少身体记不住动作，先从每周到场两次开始`;
    let bestI = 0;
    for (let i = 1; i < 6; i++) if (sk[i] - base[i] > sk[bestI] - base[bestI]) bestI = i;
    const gain = +(sk[bestI] - base[bestI]).toFixed(1);
    const up = gain > 0.05
      ? `${SKILL_LABELS[bestI]}从 ${base[bestI].toFixed(1)} 涨到 ${sk[bestI].toFixed(1)}，这 ${gain.toFixed(1)} 分是你自己练出来的`
      : '技能分还没动，第一次进步往往来得比想象中快';
    let weakI = 0;
    for (let i = 1; i < 6; i++) if (sk[i] < sk[weakI]) weakI = i;
    const tip = `现在最该补的是${SKILL_LABELS[weakI]}（${sk[weakI].toFixed(1)}），${TIP_OF[SKILL_KEYS[weakI]]}`;
    const tail = rate != null && rate >= 90 ? '保持这个节奏，你会是场上让人放心的那个。' : '不用急，这周比上周多来一次就够了。';
    return `${head}。${up}。${tip}。${tail}`;
  }
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

  /** 日期统一显示成 MM-DD（新格式带年份，老链接不带） */
  function fmtDay(d) {
    const t = String(d || '');
    return t.length >= 10 ? t.slice(5) : t;
  }

  function fmtSnapshot(at) {
    const d = new Date(at);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 10月31日 周五 */
  function fmtDayCN(dateStr) {
    const d = new Date(String(dateStr || '') + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return String(dateStr || '');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_CN[d.getDay()]}`;
  }

  function leaveForm(next) {
    const list = (next || []).filter((x) => x && x.d);
    if (!list.length) {
      return `<div class="sv-leave-empty">
        <p>这条链接里没有还没开始的训练了。</p>
        <p class="mono">让队长重新生成一次链接再发你</p>
      </div>`;
    }
    return `<div class="sv-leave-list">${list.map((x, i) => `<button type="button" class="sv-leave-opt" data-i="${i}">
        <b>${esc(fmtDayCN(x.d))}</b><em>${esc(x.t || '')} 待训练</em>
      </button>`).join('')}</div>
      <div class="sv-reasons" role="group" aria-label="请假原因">${REASONS.map((r, i) => `<button type="button" class="sv-reason" data-r="${i}">${esc(r)}</button>`).join('')}</div>
      <button type="button" class="sv-btn sv-make" disabled>生成回执<i>→</i></button>
      <div class="sv-rcpt" hidden>
        <span class="mono">LEAVE RECEIPT</span>
        <b class="sv-rcpt-code">—</b>
        <p class="sv-rcpt-tip">发给队长：他打开考勤页点「回执」，粘进去就登记好了。</p>
        <div class="sv-rcpt-acts">
          <button type="button" class="sv-btn sv-rcpt-copy">复制回执</button>
          <button type="button" class="sv-btn sv-btn-ghost sv-rcpt-link">复制回执链接</button>
        </div>
        <p class="sv-rcpt-st mono" hidden></p>
      </div>`;
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* 微信里常被拦 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-999px;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, t.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }

  function wireLeave(data, me, root) {
    const next = (data.next || []).filter((x) => x && x.d).slice(0, 4);
    const make = root.querySelector('.sv-make');
    if (!next.length || !make) return;
    const opts = Array.prototype.slice.call(root.querySelectorAll('.sv-leave-opt'));
    const chips = Array.prototype.slice.call(root.querySelectorAll('.sv-reason'));
    const box = root.querySelector('.sv-rcpt');
    const codeEl = root.querySelector('.sv-rcpt-code');
    const st = root.querySelector('.sv-rcpt-st');
    let pick = -1;
    let reason = -1;
    const sync = () => { make.disabled = !(pick >= 0 && reason >= 0); };
    opts.forEach((btn) => {
      btn.onclick = () => {
        pick = Number(btn.dataset.i);
        opts.forEach((b) => b.classList.toggle('on', b === btn));
        sync();
      };
    });
    chips.forEach((btn) => {
      btn.onclick = () => {
        reason = Number(btn.dataset.r);
        chips.forEach((b) => b.classList.toggle('on', b === btn));
        sync();
      };
    });
    const say = (t) => { if (st) { st.hidden = false; st.textContent = t; } };
    make.onclick = () => {
      const s = next[pick];
      let code = '';
      try {
        code = encodeReceipt({ name: me.n, no: me.no, date: s.d, start: s.t, reason: reason });
      } catch (err) {
        say('生成失败：' + (err && err.message ? err.message : '未知错误'));
        return;
      }
      const msg = `【请假回执】${me.n}${me.no ? ' #' + me.no : ''}\n${fmtDayCN(s.d)} ${s.t || ''}\n原因：${REASONS[reason] || '其他'}\n回执码：${code}\n（队长：考勤页 →「回执」→ 粘贴这一行）`;
      if (codeEl) codeEl.textContent = code;
      if (box) box.hidden = false;
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const copyBtn = box && box.querySelector('.sv-rcpt-copy');
      const linkBtn = box && box.querySelector('.sv-rcpt-link');
      if (copyBtn) copyBtn.onclick = async () => {
        const done = await copyText(msg);
        say(done ? '已复制，发到群里就行' : '复制被拦了，长按上面的码手动复制');
      };
      if (linkBtn) linkBtn.onclick = async () => {
        const url = location.href.split('#')[0] + '#rcpt=' + code;
        const done = await copyText(url);
        say(done ? '回执链接已复制，队长点开就能确认' : '复制被拦了，改用上面的码');
      };
    };
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

  /** 进门验证的唯一判据，进门和「记住本人」共用，避免两处规则漂移 */
  function matchPlayer(players, name, no) {
    const needNo = players.some((p) => Number(p.no) > 0);
    return players.find((p) => {
      if (normName(p.n) !== name) return false;
      if (!needNo) return true;
      if (!Number(p.no)) return !no; // 没录号码的队员，号码留空也放行
      return String(Number(p.no)) === no;
    }) || null;
  }
  function normName(s) { return String(s || '').replace(/\s+/g, ''); }

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
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = normName(nameEl.value);
      const no = normName(noEl.value);
      const me = matchPlayer(players, name, no);
      if (!me) {
        err.hidden = false;
        form.classList.remove('shake');
        void form.offsetWidth; // 重排一次，让动画能重复触发
        form.classList.add('shake');
        (name ? noEl : nameEl).focus(); // 哪个没填好焦点给哪个，不提示是哪一项错（不暴露名单）
        return;
      }
      err.hidden = true;
      try {
        localStorage.setItem(NAME_KEY, me.n);
        localStorage.setItem(SELF_KEY, JSON.stringify({ n: name, no: no }));
      } catch (e2) { /* ignore */ }
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
        <span class="sv-sdate mono">${esc(fmtDay(s.d))}</span>
        <span class="sv-stime">${esc(s.t || '')}</span>
        <span class="sv-tl-badge ${ST_CLS[st] || 'none'}">${st ? ST_LABEL[st] : '未登记'}</span>
      </div>`;
    }).join('');

    // 链接里只带 AI 写的那段；模板点评在队员端按同样规则现场算，不占链接体积
    const aiNote = String(me.note || '').trim();
    const note = aiNote || localNote(r, sk, base);
    const isAi = Number(me.nc) === 1 && !!aiNote;

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

      <section class="sv-sec sv-leave" id="svLeave">
        <div class="sv-sec-head mono"><span>LEAVE / 05</span><i>↩</i></div>
        <h2>来不了，说一声。</h2>
        <p class="sv-sub">选一次还没开始的训练、点个原因，生成回执发给队长。他登记完，这次就记成请假，不算缺席。</p>
        ${leaveForm(data.next)}
      </section>

      <footer class="sv-foot">
        <p>数据快照 · ${esc(fmtSnapshot(data.at || Date.now()))}</p>
        <p class="mono">GENERATED BY CAPTAIN · NO SIGN-UP NEEDED</p>
        <button type="button" class="sv-switch" id="svSwitch">不是我 / 换个人</button>
      </footer>`);
    document.title = `${me.n} · 我的训练档案`;
    const sw = document.getElementById('svSwitch');
    if (sw) sw.onclick = () => {
      try { localStorage.removeItem(SELF_KEY); } catch (e) { /* ignore */ }
      renderGate(data);
    };
    const leaveRoot = document.getElementById('svLeave');
    if (leaveRoot) wireLeave(data, me, leaveRoot);
    return el;
  }

  /** 二次打开：本机记过「姓名+号码」且还能对上人，就直接进档案，不再问一遍 */
  function findSelf(data) {
    try {
      const raw = JSON.parse(localStorage.getItem(SELF_KEY) || 'null');
      if (!raw || typeof raw.n !== 'string') return null;
      return matchPlayer(data.players || [], raw.n, String(raw.no == null ? '' : raw.no));
    } catch (e) { return null; }
  }

  function render(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    if (!players.length) { renderError(); return; }
    const me = findSelf(data);
    if (me) { renderSelf(data, me); return; }
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
  window.XGYShare = { buildURL, encode, pack, unpack, encodeReceipt, decodeReceipt, fpOf, REASONS };
})();
