import fs from 'node:fs';
import path from 'node:path';

const dir = process.cwd();
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const cloud = fs.readFileSync(path.join(dir, 'cloud.js'), 'utf8');
const share = fs.readFileSync(path.join(dir, 'share.js'), 'utf8');
const playercard = fs.readFileSync(path.join(dir, 'playercard.js'), 'utf8');
const card = fs.readFileSync(path.join(dir, 'card.js'), 'utf8');
const qr = fs.readFileSync(path.join(dir, 'qr.js'), 'utf8');
const xlsx = fs.readFileSync(path.join(dir, 'xlsx.js'), 'utf8');

/* ── 版本号失效（配合 sw.js 的静态资源缓存优先策略）──
 * sw.js 的 VERSION 是唯一版本源。HTML 走网络优先保证发版即被看到，
 * HTML 里引用的 js/css/图标 加 ?v=N：发版后 URL 变 → SW 缓存必然 miss → 拉新版。
 * build.mjs 每次运行都会把 index.html 的引用和 sw.js 的 SHELL 刷成当前版本。 */
const swSrc = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const ver = (swSrc.match(/const VERSION = '([^']+)'/) || [])[1] || '0';
const ASSET_RE = /(src|href)="(style\.css|cloud\.js|qr\.js|xlsx\.js|card\.js|share\.js|playercard\.js|app\.js|manifest\.webmanifest|assets\/icon-180\.png|assets\/loader-pose\d\.png)(?:\?v=[\w.]+)?"/g;
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

// 单文件版用「不带版本号」的 HTML 做内联（单文件没有外链，版本号无意义）
// 注意 [\w.]+：VERSION 形如 v47，不能只用 \d+（踩过：\d+ 匹配不到导致内联全失效）
const htmlPlain = html.replace(/(src|href)="([^"?]+)\?v=[\w.]+"/g, '$1="$2"');

const png = (f) => fs.readFileSync(path.join(dir, f)).toString('base64');

// qr / xlsx / card / share / playercard 平时是按需加载（app.js 的 ensureMod），
// 单文件版走 file:// 没法再拉外链，所以必须全部内联回 app.js 之前。
const lazyMods = [qr, xlsx, card, share, playercard]
  .map((src) => `<script>\n${src}\n</script>`)
  .join('\n');

const out = htmlPlain
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="cloud.js"></script>', () => `<script>\n${cloud}\n</script>`)
  .replace('<script src="app.js"></script>', () => `${lazyMods}\n<script>\n${js}\n</script>`)
  // 加载动画的三帧猫图内联成 base64（file:// 下外链 404，loader 卡片就空了）
  .replace(/src="assets\/loader-pose1\.png"/g, () => `src="data:image/png;base64,${png('assets/loader-pose1.png')}"`)
  .replace(/src="assets\/loader-pose2\.png"/g, () => `src="data:image/png;base64,${png('assets/loader-pose2.png')}"`)
  .replace(/src="assets\/loader-pose3\.png"/g, () => `src="data:image/png;base64,${png('assets/loader-pose3.png')}"`)
  // 单文件走 file://，PWA 相关外链资源没有意义，摘掉避免 404
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');

const target = path.join(dir, '信工院排球队管理系统.html');
fs.writeFileSync(target, out, 'utf8');
console.log('built', target, (out.length / 1024).toFixed(1) + ' KB');
