import fs from 'node:fs';
import path from 'node:path';

const dir = process.cwd();
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const cloud = fs.readFileSync(path.join(dir, 'cloud.js'), 'utf8');

const out = html
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="cloud.js"></script>', () => `<script>\n${cloud}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${js}\n</script>`)
  // 单文件走 file://，PWA 相关外链资源没有意义，摘掉避免 404
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');

const target = path.join(dir, '信工院排球队管理系统.html');
fs.writeFileSync(target, out, 'utf8');
console.log('built', target, (out.length / 1024).toFixed(1) + ' KB');
