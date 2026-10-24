/**
 * PWA 图标生成：纯 Node（zlib 内置），无任何依赖。
 * 暗底 + 橙黄渐变排球 + 经典缝线（垂直中缝 + 两条在两极交汇的对称弧线）。
 * 产物：assets/icon-192.png / icon-512.png（any）、maskable-512.png、icon-180.png（apple-touch）
 * 改了品牌色/构图后重跑 node tools/gen-icons.mjs 即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ── PNG 编码（RGBA，filter 0） ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── 品牌参数 ── */
const BG_TOP = [11, 15, 29], BG_BOT = [6, 9, 18];   // 暗底纵向渐变
const STOPS = [                                     // 球面径向渐变（光源左上）
  [0.0, [255, 244, 220]],
  [0.5, [255, 203, 116]],
  [1.0, [226, 138, 47]]
];
const SEAM = [91, 53, 18];      // 缝线色（深棕）
const SEAM_ALPHA = 0.5;

function seamHalfDistance(x, y, cx, cy, ballR) {
  // 返回该点到最近缝线中心的距离；不在球内返回 Infinity
  const dy = y - cy;
  const dyN = dy / ballR;
  if (Math.abs(dyN) > 1) return Infinity;
  const dx = x - cx;
  const distC = Math.hypot(dx, dy);
  if (distC > ballR) return Infinity;
  // 中缝：垂直线 x = cx
  let best = Math.abs(dx);
  // 两条侧弧：x = cx ± k·R·sin(θ), y = cy + R·cos(θ)，θ∈[0,π]，两极交汇
  const k = 0.62;
  const sinT = Math.sqrt(1 - dyN * dyN);
  const sideX = k * ballR * sinT;
  best = Math.min(best, Math.abs(Math.abs(dx) - sideX));
  return best;
}

function render(size, ballR, bgRadius) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const lx = cx - ballR * 0.36, ly = cy - ballR * 0.48;
  const maxD = Math.hypot(ballR * 1.36, ballR * 1.48);
  const seamW = Math.max(2.5, ballR * 0.045); // 缝线半宽

  const grad = (t) => {
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
        const k2 = (t - t0) / (t1 - t0);
        return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k2));
      }
    }
    return STOPS[STOPS.length - 1][1];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 背景圆角矩形（bgRadius 为 null = 全出血方块）
      if (bgRadius != null) {
        const cornerX = Math.min(Math.max(x, bgRadius), size - 1 - bgRadius);
        const cornerY = Math.min(Math.max(y, bgRadius), size - 1 - bgRadius);
        const inCornerZone = (x < bgRadius || x >= size - bgRadius) && (y < bgRadius || y >= size - bgRadius);
        if (inCornerZone && Math.hypot(x - cornerX, y - cornerY) > bgRadius) continue;
      }
      const bgT = y / size;
      let r = BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * bgT;
      let g = BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * bgT;
      let b = BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * bgT;

      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= ballR) {
        const t = Math.min(1, Math.hypot(x - lx, y - ly) / maxD);
        const c = grad(t);
        r = c[0]; g = c[1]; b = c[2];
        // 边缘一圈压暗，增加立体感
        const edge = dist / ballR;
        if (edge > 0.86) {
          const k = (edge - 0.86) / 0.14 * 0.22;
          r = Math.round(r * (1 - k)); g = Math.round(g * (1 - k)); b = Math.round(b * (1 - k));
        }
        // 缝线
        const sd = seamHalfDistance(x, y, cx, cy, ballR);
        if (sd <= seamW) {
          const a = SEAM_ALPHA * (1 - Math.min(1, sd / seamW) * 0.25);
          r = Math.round(r * (1 - a) + SEAM[0] * a);
          g = Math.round(g * (1 - a) + SEAM[1] * a);
          b = Math.round(b * (1 - a) + SEAM[2] * a);
        }
      }
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(process.cwd(), 'assets');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, 82, 78],        // any：圆角底 + 球
  ['icon-512.png', 512, 218, 208],
  ['maskable-512.png', 512, 118, null], // maskable：全出血底，球缩进安全区
  ['icon-180.png', 180, 64, null]       // apple-touch：全出血（iOS 自己裁圆角）
];
for (const [name, size, ballR, bgRadius] of jobs) {
  const png = render(size, ballR, bgRadius);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('wrote', name, (png.length / 1024).toFixed(1) + ' KB');
}
