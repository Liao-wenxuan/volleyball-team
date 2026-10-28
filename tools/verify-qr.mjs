// 用参考实现（node_modules/qrcode）逐模块比对自实现的 qr.js
// 两边都强制 byte 模式 + 同一掩码，差异才只可能来自编码/放置本身
// 用法：node tools/verify-qr.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require_ = createRequire(import.meta.url);
const QRCode = require_('qrcode');

const sandbox = { window: {}, TextEncoder, module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('qr.js', 'utf8'), sandbox);
const XGYQR = sandbox.window.XGYQR || sandbox.module.exports;
if (!XGYQR) { console.error('qr.js 没导出'); process.exit(1); }

let fail = 0;
function check(label, cond, extra = '') {
  if (!cond) fail += 1;
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
}

const samples = [
  '信工院排球队',
  'https://example.com/a',
  'https://liao-wenxuan.github.io/volleyball-team/#share=' + 'A'.repeat(60),
  'https://liao-wenxuan.github.io/volleyball-team/#share=' + 'B'.repeat(300),
  'x'.repeat(700),
  'y'.repeat(900),
  'z'.repeat(1400)
];

console.log('── 强制同掩码逐模块比对 ──');
for (const text of samples) {
  // 参考：强制 byte 模式，先跑一次拿版本与掩码
  const ref0 = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L' });
  const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L', maskPattern: ref0.maskPattern });
  const mine = XGYQR.encode(text, ref0.maskPattern);

  const flags = [];
  if (mine.version !== ref.version) flags.push(`版本 我${mine.version} vs 参考${ref.version}`);
  if (mine.size !== ref.modules.size) flags.push(`边长 ${mine.size} vs ${ref.modules.size}`);

  let diff = 0;
  const firstDiff = [];
  if (mine.size === ref.modules.size) {
    for (let r = 0; r < mine.size; r++) {
      for (let c = 0; c < mine.size; c++) {
        if ((mine.modules[r][c] ? 1 : 0) !== ref.modules.data[r * ref.modules.size + c]) {
          diff += 1;
          if (firstDiff.length < 5) firstDiff.push(`(${r},${c})`);
        }
      }
    }
  }
  if (diff) flags.push(`模块差异 ${diff} 个 @ ${firstDiff.join(' ')}`);

  check(
    `${text.length} 字符 → v${mine.version} ${mine.size}×${mine.size} mask${ref0.maskPattern}`,
    flags.length === 0,
    flags.length ? flags.join('，') : '全一致'
  );
}

console.log('\n── 不指定掩码时，我的掩码选择 vs 参考（两者都合法，仅记录）──');
for (const text of samples) {
  const mine = XGYQR.encode(text);
  const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'L' });
  console.log(`  ${String(text.length).padStart(4)} 字符: 我 mask${mine.mask} / 参考 mask${ref.maskPattern} ${mine.mask === ref.maskPattern ? '同' : '不同'}`);
}

console.log('\n── 容量表 ──');
check('v1 = 17 字节', XGYQR.capacity(1) === 17, String(XGYQR.capacity(1)));
check('v10 = 271 字节', XGYQR.capacity(10) === 271, String(XGYQR.capacity(10)));
check('v40 = 2953 字节', XGYQR.capacity(40) === 2953, String(XGYQR.capacity(40)));

console.log(fail ? `\n有 ${fail} 项不一致` : '\n全部一致');
process.exit(fail ? 1 : 0);
