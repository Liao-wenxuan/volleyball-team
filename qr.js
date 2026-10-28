/* ══════════════════════════════════════════════════════════════
   QR 码编码器 · 自实现（byte mode / 纠错等级 L）
   ──────────────────────────────────────────────────────────────
   为什么自己写：项目守「零依赖 + 单文件双击可用」，不引第三方库，
   也不把队伍数据传给任何在线二维码服务（那是隐私问题）。

   实现范围：版本 1–40 自动选择，字节模式（UTF-8），纠错 L 级。
   对着参考实现逐模块比对过（tools/verify-qr.mjs），不是纸上推演。
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* 版本 1–40 的总码字数（数据 + 纠错） */
  var CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706];
  /* L 级每版的纠错块数 */
  var EC_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];
  /* L 级每版的纠错码字总数 */
  var EC_CODEWORDS = [7, 10, 15, 20, 26, 36, 40, 48, 60, 72, 80, 96, 104, 120, 132, 144, 168, 180, 196, 224, 224, 252, 270, 300, 312, 336, 360, 390, 420, 450, 480, 510, 540, 570, 570, 600, 630, 660, 720, 750];

  /* ── GF(256) ── */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  var genCache = {};
  /** 生成多项式 g(x)=∏(x-α^i)，系数高次在前，首项恒为 1 */
  function genPoly(n) {
    if (genCache[n]) return genCache[n];
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1);
      next[0] = g[0];
      for (var k = 1; k < g.length; k++) next[k] = g[k] ^ gmul(g[k - 1], EXP[i]);
      next[g.length] = gmul(g[g.length - 1], EXP[i]);
      g = next;
    }
    genCache[n] = g;
    return g;
  }

  /** Reed-Solomon：给 data 追加 nsym 个纠错码字 */
  function rsEncode(data, nsym) {
    var gen = genPoly(nsym);
    var res = data.concat(new Array(nsym).fill(0));
    for (var i = 0; i < data.length; i++) {
      var factor = res[i];
      if (!factor) continue;
      for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  /* ── 位缓冲 ── */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.push = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  function bitLen(n) { var d = 0; while (n) { d++; n >>>= 1; } return d; }

  /** 容量：某版本在 L 级、字节模式下最多能塞多少字节 */
  function capacity(version) {
    var dataCodewords = CODEWORDS[version] - EC_CODEWORDS[version - 1];
    var ccBits = version < 10 ? 8 : 16;
    return Math.floor((dataCodewords * 8 - 4 - ccBits) / 8);
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 40; v++) if (capacity(v) >= byteLen) return v;
    throw new Error('内容太长，装不进二维码（上限 ' + capacity(40) + ' 字节）');
  }

  /* ── 数据编码 + 纠错 + 交织 ── */
  function buildCodewords(bytes, version) {
    var dataCodewords = CODEWORDS[version] - EC_CODEWORDS[version - 1];
    var capBits = dataCodewords * 8;
    var buf = new BitBuf();
    buf.push(4, 4); // 字节模式
    buf.push(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) buf.push(bytes[i], 8);
    // 收尾符
    var term = Math.min(4, capBits - buf.bits.length);
    buf.push(0, term);
    while (buf.bits.length % 8) buf.bits.push(0);
    // 填充字节 0xEC / 0x11
    var pads = [0xec, 0x11], pi = 0;
    while (buf.bits.length < capBits) buf.push(pads[pi++ % 2], 8);

    var data = [];
    for (var b = 0; b < buf.bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | buf.bits[b + k];
      data.push(v);
    }

    // 分块：短的在前、长的在后
    var nBlocks = EC_BLOCKS[version - 1];
    var ecPerBlock = EC_CODEWORDS[version - 1] / nBlocks;
    var shortLen = Math.floor(data.length / nBlocks);
    var longCount = data.length % nBlocks;
    var blocks = [];
    var pos = 0;
    for (var n = 0; n < nBlocks; n++) {
      var len = shortLen + (n >= nBlocks - longCount ? 1 : 0);
      var chunk = data.slice(pos, pos + len);
      pos += len;
      blocks.push({ data: chunk, ec: rsEncode(chunk, ecPerBlock) });
    }

    // 交织
    var out = [];
    var maxData = shortLen + (longCount ? 1 : 0);
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].data.length) out.push(blocks[bi].data[c]);
      }
    }
    for (var e = 0; e < ecPerBlock; e++) {
      for (var bj = 0; bj < blocks.length; bj++) out.push(blocks[bj].ec[e]);
    }
    return out;
  }

  /* ── 矩阵 ── */
  function newGrid(size, fill) {
    var g = new Array(size);
    for (var r = 0; r < size; r++) { g[r] = new Uint8Array(size); if (fill) g[r].fill(fill); }
    return g;
  }

  function alignPositions(version) {
    if (version === 1) return [];
    var size = version * 4 + 17;
    var count = Math.floor(version / 7) + 2;
    var step = (size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2);
    var pos = [size - 7];
    for (var i = 1; i < count - 1; i++) pos[i] = pos[i - 1] - step;
    pos.push(6);
    return pos.reverse();
  }

  function placeFinder(m, res, size, r0, c0) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on ? 1 : 0;
        res[rr][cc] = 1;
      }
    }
  }

  function placeAlign(m, res, r0, c0) {
    for (var r = -2; r <= 2; r++) {
      for (var c = -2; c <= 2; c++) {
        var on = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
        m[r0 + r][c0 + c] = on;
        res[r0 + r][c0 + c] = 1;
      }
    }
  }

  function formatBits(mask) {
    var data = (1 << 3) | mask; // 纠错等级 L = 01
    var d = data << 10;
    while (bitLen(d) >= 11) d ^= 0x537 << (bitLen(d) - 11);
    return ((data << 10) | d) ^ 0x5412;
  }

  function versionBits(version) {
    var d = version << 12;
    while (bitLen(d) >= 13) d ^= 0x1f25 << (bitLen(d) - 13);
    return (version << 12) | d;
  }

  function writeFormat(m, size, mask) {
    var bits = formatBits(mask);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >>> i) & 1;
      // 第 8 列的竖排（避开第 6 行）
      if (i < 6) m[i][8] = bit;
      else if (i < 8) m[i + 1][8] = bit;
      else m[size - 15 + i][8] = bit;
      // 第 8 行的横排（避开第 6 列）
      if (i < 8) m[8][size - 1 - i] = bit;
      else if (i < 9) m[8][7] = bit;
      else m[8][14 - i] = bit;
    }
    m[size - 8][8] = 1; // 固定的深色模块
  }

  function writeVersion(m, res, size, version) {
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >>> i) & 1;
      var row = Math.floor(i / 3);
      var col = i % 3 + size - 11;
      m[row][col] = bit; res[row][col] = 1; // 右上
      m[col][row] = bit; res[col][row] = 1; // 左下
    }
  }

  function maskFn(kind, r, c) {
    switch (kind) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  /** 罚分：连续同色 / 2×2 同色 / 类 finder 模式 / 深浅比例 */
  function penalty(m, size) {
    var score = 0, r, c, i;
    // 1) 行与列连续 >=5
    for (r = 0; r < size; r++) {
      for (var dir = 0; dir < 2; dir++) {
        var run = 1, prev = dir ? m[0][r] : m[r][0];
        for (c = 1; c < size; c++) {
          var v = dir ? m[c][r] : m[r][c];
          if (v === prev) {
            run++;
          } else {
            if (run >= 5) score += 3 + (run - 5);
            prev = v; run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }
    // 2) 2×2 同色
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var s = m[r][c];
        if (s === m[r][c + 1] && s === m[r + 1][c] && s === m[r + 1][c + 1]) score += 3;
      }
    }
    // 3) 1:1:3:1:1 的类 finder 图形（前后带 4 个浅色）
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, at) {
      var ok1 = true, ok2 = true;
      for (i = 0; i < 11; i++) {
        var val = get(at + i);
        if (val !== p1[i]) ok1 = false;
        if (val !== p2[i]) ok2 = false;
        if (!ok1 && !ok2) return 0;
      }
      return (ok1 ? 40 : 0) + (ok2 ? 40 : 0);
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c <= size - 11; c++) {
        score += match(function (k) { return m[r][k]; }, c);
        score += match(function (k) { return m[k][r]; }, c);
      }
    }
    // 4) 深色模块比例偏离 50%
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /** 编码：返回 { version, size, modules }，modules[r][c] 为 0/1 */
  function encode(text, forceMask) {
    var bytes = new TextEncoder().encode(String(text));
    var version = pickVersion(bytes.length);
    var size = version * 4 + 17;
    var codewords = buildCodewords(bytes, version);

    var base = newGrid(size, 0);
    var res = newGrid(size, 0);

    placeFinder(base, res, size, 0, 0);
    placeFinder(base, res, size, 0, size - 7);
    placeFinder(base, res, size, size - 7, 0);

    var ap = alignPositions(version);
    for (var i = 0; i < ap.length; i++) {
      for (var j = 0; j < ap.length; j++) {
        var last = ap.length - 1;
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        placeAlign(base, res, ap[i], ap[j]);
      }
    }

    for (var t = 8; t < size - 8; t++) {
      var on = (t % 2 === 0) ? 1 : 0;
      base[6][t] = on; res[6][t] = 1;
      base[t][6] = on; res[t][6] = 1;
    }

    // 预留格式信息区
    for (var f = 0; f < 9; f++) {
      if (f !== 6) { res[8][f] = 1; res[f][8] = 1; }
    }
    for (var g = 0; g < 8; g++) { res[8][size - 1 - g] = 1; res[size - 1 - g][8] = 1; }
    res[size - 8][8] = 1;

    if (version >= 7) writeVersion(base, res, size, version);

    // 数据按两列一组、上下蛇形填充；第 6 列是 timing，跳过
    var bitIndex = 0;
    var totalBits = codewords.length * 8;
    var upward = true; // 第一组从最底行往上
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var step = 0; step < size; step++) {
        var rr = upward ? size - 1 - step : step;
        for (var kk = 0; kk < 2; kk++) {
          var c2 = col - kk;
          if (res[rr][c2]) continue;
          var bit = bitIndex < totalBits
            ? (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1
            : 0;
          base[rr][c2] = bit;
          bitIndex++;
        }
      }
      upward = !upward;
    }

    // 8 种掩码选罚分最低
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mk = 0; mk < 8; mk++) {
      if (forceMask != null && mk !== forceMask) continue;
      var cand = newGrid(size, 0);
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          cand[r][c] = (res[r][c] || !maskFn(mk, r, c)) ? base[r][c] : (base[r][c] ^ 1);
        }
      }
      writeFormat(cand, size, mk);
      var sc = penalty(cand, size);
      if (sc < bestScore) { bestScore = sc; best = cand; bestMask = mk; }
    }

    return { version: version, size: size, modules: best, mask: bestMask, score: bestScore };
  }

  /* ── 画到 canvas ── */
  function toCanvas(canvas, text, opts) {
    var o = opts || {};
    var quiet = o.quiet == null ? 2 : o.quiet; // 静默区（模块数）
    var qr = encode(text);
    var modules = qr.size + quiet * 2;
    var px = o.size || 640;
    var scale = Math.max(1, Math.floor(px / modules));
    var side = modules * scale;
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = o.bg || '#ffffff';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = o.fg || '#0d0e12';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
    return { version: qr.version, size: qr.size, pixels: side, scale: scale };
  }

  var api = { encode: encode, toCanvas: toCanvas, capacity: capacity };
  if (typeof window !== 'undefined') window.XGYQR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
