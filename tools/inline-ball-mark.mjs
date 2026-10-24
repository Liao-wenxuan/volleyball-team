// 把排球实拍图抠出、裁紧、缩到 96px，以 base64 内联替换 index.html 里的 SVG 品牌 logo
// （内联 data URI：Pages 版与单文件版都能显示）
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'C:/Users/廖文轩/.workbuddy/clipboard-images/clipboard-2026-10-24T06-32-56-873Z-cf48622b.png';
const HTML = 'index.html';

// 圆检测（与 gen-icons-from-photo.mjs 同逻辑）
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * C;
  if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 215) { if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x; }
}
let maxW = 0;
for (let y = 0; y < H; y++) maxW = Math.max(maxW, rowMax[y] - rowMin[y]);
let cx = 0, cy = 0, n = 0;
for (let y = 0; y < H; y++) {
  const w = rowMax[y] - rowMin[y];
  if (w > maxW * 0.985 && w > 50) { cx += (rowMin[y] + rowMax[y]) / 2; cy += y; n++; }
}
cx /= n; cy /= n;
const r = maxW / 2;

// 圆形 mask（内缩 1.5px + 1px 羽化），裁紧到球外接方
const S = 96, pad = 1;
const crop = Math.round(r) + pad;
const rgba = Buffer.alloc(crop * 2 * crop * 2 * 4);
const W2 = crop * 2;
for (let y = 0; y < W2; y++) for (let x = 0; x < W2; x++) {
  const sx = Math.round(cx - crop) + x, sy = Math.round(cy - crop) + y;
  const p = y * W2 + x, sp = sy * W + sx;
  const d = Math.hypot(sx - cx, sy - cy), R = r - 1.5;
  const a = d <= R - 1 ? 255 : d >= R + 1 ? 0 : Math.round((1 - (d - (R - 1)) / 2) * 255);
  rgba[p * 4] = data[sp * C]; rgba[p * 4 + 1] = data[sp * C + 1];
  rgba[p * 4 + 2] = data[sp * C + 2]; rgba[p * 4 + 3] = a;
}
const png = await sharp(rgba, { raw: { width: W2, height: W2, channels: 4 } })
  .resize(S, S).png().toBuffer();
writeFileSync('assets/ball-mark.png', png);
const b64 = png.toString('base64');
console.log(`ball-mark.png ${(png.length / 1024).toFixed(1)}KB  base64 ${(b64.length / 1024).toFixed(1)}KB`);

// 替换 index.html 两处 SVG logo
const img = (cls) => `<img class="brand-img" src="data:image/png;base64,${b64}" alt="" aria-hidden="true">`;
let html = readFileSync(HTML, 'utf8');
const sidebarSvg = /<span class="brand-mark">\s*<svg viewBox="0 0 48 48"[\s\S]*?<\/svg>\s*<\/span>/;
const footerSvg = /<span class="brand-mark small">\s*<svg viewBox="0 0 48 48"[\s\S]*?<\/svg>\s*<\/span>/;
if (!sidebarSvg.test(html) || !footerSvg.test(html)) { console.error('SVG 未匹配到，中止'); process.exit(1); }
html = html.replace(sidebarSvg, `<span class="brand-mark">${img()}</span>`)
           .replace(footerSvg, `<span class="brand-mark small">${img()}</span>`);
writeFileSync(HTML, html);
console.log('✓ index.html 两处 logo 已替换');
