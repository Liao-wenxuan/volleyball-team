// 从用户提供的排球照片生成 PWA 图标（v2：几何圆检测）
// 球是银白色、背景是浅色棋盘格，颜色抠图必翻车 → 改用「球是圆」这一几何事实：
// 用暗色像素（缝线/阴影/暗面）逐行求宽度，估计球体圆心和半径，圆内保留圆外透明。
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SRC = 'C:/Users/廖文轩/.workbuddy/clipboard-images/clipboard-2026-10-24T06-32-56-873Z-cf48622b.png';

async function detectCircle() {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  // 暗像素 = 球的缝线 / 暗面 / 阴影（棋盘格是 239/255，不会命中）
  const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < 215) { if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x; }
    }
  }
  // 每行宽度，取最宽的若干行（球体赤道附近）拟合圆
  let maxW = 0;
  for (let y = 0; y < H; y++) { const w = rowMax[y] - rowMin[y]; if (w > maxW) maxW = w; }
  let cx = 0, cy = 0, n = 0;
  for (let y = 0; y < H; y++) {
    const w = rowMax[y] - rowMin[y];
    if (w > maxW * 0.985 && w > 50) { cx += (rowMin[y] + rowMax[y]) / 2; cy += y; n++; }
  }
  cx /= n; cy /= n;
  const r = maxW / 2;
  console.log(`circle: center=(${cx.toFixed(1)}, ${cy.toFixed(1)}) r=${r.toFixed(1)} (wideRows=${n}, maxW=${maxW})`);
  return { W, H, C, data, cx, cy, r };
}

async function cutout() {
  const { W, H, C, data, cx, cy, r } = await detectCircle();
  // 圆形 mask：内部 255，边缘 1.5px 羽化，整体内缩 2px 去掉贴边浅色镶边
  const mask = Buffer.alloc(W * H);
  const R = r - 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      mask[y * W + x] = d <= R - 1.5 ? 255 : d >= R + 1.5 ? 0 : Math.round((1 - (d - (R - 1.5)) / 3) * 255);
    }
  }
  // blur 羽化（坑：sharp 的 blur 会把 1ch 升成 3ch，必须压回单通道并自检长度）
  let soft = await sharp(mask, { raw: { width: W, height: H, channels: 1 } })
    .blur(1).toColourspace('b-w').raw().toBuffer();
  if (soft.length !== W * H) soft = null;
  const soft3 = soft ? null : await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(1).raw().toBuffer();
  const getSoft = (p) => (soft ? soft[p] : soft3[p * 3]);
  const rgba = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    rgba[p * 4] = data[p * C]; rgba[p * 4 + 1] = data[p * C + 1];
    rgba[p * 4 + 2] = data[p * C + 2]; rgba[p * 4 + 3] = getSoft(p);
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

function darkBg(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><radialGradient id="g" cx="0.32" cy="0.26" r="1.1">
      <stop offset="0" stop-color="#131b30"/><stop offset="0.55" stop-color="#0a1020"/><stop offset="1" stop-color="#05070f"/>
    </radialGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function makeIcon(size, ballRatio, out) {
  const ball = await cutout();
  const d = Math.round(size * ballRatio);
  const resized = await sharp(ball).resize(d, d).png().toBuffer();
  await sharp(await darkBg(size))
    .composite([{ input: resized, left: Math.round((size - d) / 2), top: Math.round((size - d) / 2) }])
    .png().toFile(out);
  console.log('✓', out);
}

await makeIcon(512, 0.84, 'assets/icon-512.png');
await makeIcon(192, 0.84, 'assets/icon-192.png');
await makeIcon(512, 0.68, 'assets/maskable-512.png');
await makeIcon(180, 0.84, 'assets/icon-180.png');

const prev = await sharp(await darkBg(512)).composite([{
  input: await sharp(await cutout()).resize(430, 430).png().toBuffer(), left: 41, top: 41
}]).png().toBuffer();
writeFileSync('assets/.preview.png', prev);
console.log('✓ assets/.preview.png');
