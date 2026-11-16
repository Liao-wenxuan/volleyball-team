import fs from 'node:fs';
import path from 'node:path';

const dir = process.cwd();

/* ── 第 0 步：把 src/ 下的分片拼成单个 app.js ──────────────────
 *
 * 为什么是「源码分片 + 构建拼接」而不是直接改成 ESM：
 *   1. tests/load-app.mjs 用 node:vm 加载**单个** app.js 来跑纯函数测试，
 *      产物形态变了那套测试就要重写；
 *   2. 单文件版（双击即用的离线 HTML）需要内联一段完整 JS。
 * 保持 app.js 仍是「一个 IIFE 的单文件」，上面两件事都不用动。
 *
 * 分片顺序写在 src/.order.json（由 tools/split-app.mjs 生成）。
 * 每个分片文件的首尾各有一层「分片标记注释」，拼接时剥掉 —— 免得产物里
 * 出现 14 个文件头的噪音。 */
const SRC_DIR = path.join(dir, 'src');
const orderFile = path.join(SRC_DIR, '.order.json');

let js;
if (fs.existsSync(orderFile)) {
  const { order, prologue, epilogue } = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
  const parts = [];
  for (const f of order) {
    const p = path.join(SRC_DIR, f);
    if (!fs.existsSync(p)) throw new Error('缺少分片文件：src/' + f);
    // 剥掉分片自己的文件头注释（从开头 /* ==== 到第一个 */ 结束），
    // 剩下的正文**原样保留** —— 切分时正文就是原文的精确行区间，
    // 一个字符都没动，所以拼回去能逐字节还原。
    let body = fs.readFileSync(p, 'utf8');
    const head = body.indexOf('*/');
    if (body.startsWith('/*') && head > 0) body = body.slice(head + 2).replace(/^\n/, '');
    parts.push(body);
  }
  // 各段原样相接：每段首行是区块注释、末行是原文里的内容（或空行），
  // 段与段之间**不补任何东西** —— 原文的间距已经完整地保存在各段里。
  js = [...prologue, ...parts.join('\n').split('\n'), ...epilogue].join('\n');
  console.log('assembled app.js from', order.length, 'slices ->', js.split('\n').length, 'lines');
} else {
  js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  console.log('no src/.order.json — using existing app.js as-is');
}

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const cloud = fs.readFileSync(path.join(dir, 'cloud.js'), 'utf8');
const share = fs.readFileSync(path.join(dir, 'share.js'), 'utf8');
const playercard = fs.readFileSync(path.join(dir, 'playercard.js'), 'utf8');
const card = fs.readFileSync(path.join(dir, 'card.js'), 'utf8');
const courtcard = fs.readFileSync(path.join(dir, 'courtcard.js'), 'utf8');
const qr = fs.readFileSync(path.join(dir, 'qr.js'), 'utf8');
const xlsx = fs.readFileSync(path.join(dir, 'xlsx.js'), 'utf8');

/* ── 版本号失效（配合 sw.js 的静态资源缓存优先策略）──
 * sw.js 的 VERSION 是唯一版本源。HTML 走网络优先保证发版即被看到，
 * HTML 里引用的 js/css/图标 加 ?v=N：发版后 URL 变 → SW 缓存必然 miss → 拉新版。
 * build.mjs 每次运行都会把 index.html 的引用和 sw.js 的 SHELL 刷成当前版本。 */
const swSrc = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const ver = (swSrc.match(/const VERSION = '([^']+)'/) || [])[1] || '0';
const ASSET_RE = /(src|href)="(style\.css|cloud\.js|qr\.js|xlsx\.js|card\.js|courtcard\.js|share\.js|playercard\.js|app\.js|manifest\.webmanifest|assets\/icon-180\.png|assets\/loader-pose\d\.png|assets\/loader-pose\d\.webp)(?:\?v=[\w.]+)?"/g;
fs.writeFileSync(
  path.join(dir, 'index.html'),
  html.replace(ASSET_RE, `$1="$2?v=${ver}"`),
  'utf8'
);
fs.writeFileSync(
  path.join(dir, 'sw.js'),
  // 路径段用 [^'?]+ 且允许可选的既有 ?v=：否则每次构建在尾部追加一层版本号
  // （踩过：icon-192.png?v=v47?v=v47?v=v47?v=v48 无限叠加）
  swSrc.replace(
    /'(\/?(?:\.\/)?(?:style\.css|app\.js|cloud\.js|qr\.js|card\.js|share\.js|manifest\.webmanifest|assets\/[^'?]+))(?:\?v=[\w.]+)*'/g,
    (m, p) => `'${p}?v=${ver}'`
  ),
  'utf8'
);
console.log('versioned assets ->', `?v=${ver}`);

/* 拼好的 app.js 必须落盘：tests/load-app.mjs 用 vm 读的是**磁盘上**这个文件，
 * 单文件 HTML 也内联它。写回磁盘让「源码分片」与「产物」保持同一份事实。 */
fs.writeFileSync(path.join(dir, 'app.js'), js, 'utf8');

/* ── 守卫：分片拼出来的 app.js 必须与「上一版 app.js」逐字节一致 ──
 *
 * 为什么要这道守卫：分片拼接涉及空行、缩进、注释的精确还原，
 * 任何一处处理不当都会让产物与源码悄悄漂移（我调试时踩过：空行多一个、
 * 缩进被 trim 掉、段落边界判断写错 —— 每次都要靠人眼 diff 才能发现）。
 *
 * 这里做的是**字节级**比较：拼接产物 vs git HEAD 里的 app.js。
 * 第一次拆分时两者本来就该完全一样；之后只要改了分片内容，
 * 产物就会变，此时 HEAD 里的 app.js 还没更新 —— 这时**不应该**直接失败，
 * 而是要提示「app.js 已由分片重新生成，请检查后提交」。
 *
 * 所以：一致 → 静默通过；不一致 → 打印差异行数，提示这是预期内的
 * （因为你改了分片），但不阻断构建。真正的回归由 npm run test:all 兜底。
 */
try {
  const { execFileSync } = await import('node:child_process');
  const head = execFileSync('git', ['show', 'HEAD:app.js'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  if (head === js) {
    console.log('guard: app.js 与 HEAD 版本逐字节一致 ✅');
  } else {
    const a = head.split('\n'), b = js.split('\n');
    let diff = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diff++;
    }
    console.log('guard: app.js 与 HEAD 版本有 ' + diff + ' 行差异' +
      '（改过分片时属正常；若是误改，请检查 src/ 下的分片）');
  }
} catch {
  console.log('guard: 跳过（不在 git 仓库里，无法取 HEAD 版本比对）');
}
// 单文件版用「不带版本号」的 HTML 做内联（单文件没有外链，版本号无意义）
// 注意 [\w.]+：VERSION 形如 v47，不能只用 \d+（踩过：\d+ 匹配不到导致内联全失效）
const htmlPlain = html.replace(/(src|href)="([^"?]+)\?v=[\w.]+"/g, '$1="$2"');

const b64 = (f) => fs.readFileSync(path.join(dir, f)).toString('base64');

// qr / xlsx / card / share / playercard / courtcard 平时是按需加载（app.js 的 ensureMod），
// 单文件版走 file:// 没法再拉外链，所以必须全部内联回 app.js 之前。
const lazyMods = [qr, xlsx, card, courtcard, share, playercard]
  .map((src) => `<script>\n${src}\n</script>`)
  .join('\n');

const out = htmlPlain
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="cloud.js"></script>', () => `<script>\n${cloud}\n</script>`)
  .replace('<script src="app.js"></script>', () => `${lazyMods}\n<script>\n${js}\n</script>`)
  // 加载动画三帧内联成 base64（file:// 下外链 404，loader 卡片就空了）。
  // 按「文件名」全局替换而不是只换 src=：onerror 里的 PNG 回退路径同样要内联，
  // 否则老设备在单文件版里回退时会指向不存在的文件。
  .replace(/assets\/loader-pose(\d)\.webp/g, (_m, n) => `data:image/webp;base64,${b64(`assets/loader-pose${n}.webp`)}`)
  .replace(/assets\/loader-pose(\d)\.png/g, (_m, n) => `data:image/png;base64,${b64(`assets/loader-pose${n}.png`)}`)
  // 单文件走 file://，PWA 相关外链资源没有意义，摘掉避免 404
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
  // 单文件把脚本内联了，再留 preload 会对着 file:// 下不存在的 cloud.js/app.js 白发两次请求
  .replace(/<link rel="preload"[^>]*>\n?/g, '');

const target = path.join(dir, '信工院排球队管理系统.html');
fs.writeFileSync(target, out, 'utf8');
console.log('built', target, (out.length / 1024).toFixed(1) + ' KB');
