// 端到端验证「分享队伍动态」：真实 Chromium + CDP
// 1) 起静态服务器 → 2) 注入演示数据 → 3) 点分享按钮拿链接
// 4) 打开链接校验只读视图 → 5) 移动端截图
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5533;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-share');
const SHOTS = path.join(ROOT, 'preview');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=9222`, `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

// 等 CDP 起来
let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9222/json/list')).json(); if (list.length) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 300));
}
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('CDP 没起来'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.result.data, 'base64');
  const out = path.join(SHOTS, name);
  writeFileSync(out, buf);
  console.log('· 截图', out, (buf.length / 1024).toFixed(0) + 'KB');
  return out;
}

const ok = (label, cond, extra = '') => console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const seed = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1500);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seed)}); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1800);

  const players = await evalJS(`document.querySelectorAll('#rosterPage .rt-row, [data-page=roster] .rt-row').length`);
  console.log('· 主应用已加载，队员行数:', players);

  // 触发分享弹窗
  await evalJS(`document.querySelector('#menuShare').click(); 'clicked'`);
  await sleep(900);
  const url = await evalJS(`(document.querySelector('#shareLink')||{}).value || ''`);
  ok('分享弹窗生成链接', url.includes('#share='), `${url.length} chars`);
  const meta = await evalJS(`(document.querySelector('#shareMeta')||{}).textContent || ''`);
  console.log('·', meta);
  await shot('s0-share-modal.png');
  await evalJS(`document.querySelector('#shareClose').click(); 'x'`);

  // 打开分享链接
  await send('Page.navigate', { url });
  await sleep(1600);

  const title = await evalJS(`document.title`);
  const hasView = await evalJS(`!!document.querySelector('#shareView')`);
  const mainHidden = await evalJS(`Array.from(document.body.children).filter(e=>e.id!=='shareView').every(e=>e.offsetHeight===0)`);
  ok('分享页渲染出 #shareView', hasView, `title="${title}"`);
  ok('主界面已隐藏', mainHidden);

  const stats = await evalJS(`Array.from(document.querySelectorAll('.sv-stat')).map(e=>e.querySelector('b').textContent+' '+e.querySelector('span').textContent).join(' | ')`);
  console.log('· 数据条:', stats);
  const rows = await evalJS(`Array.from(document.querySelectorAll('.sv-player')).slice(0,3).map(e=>e.querySelector('.sv-prow b').textContent+' '+e.querySelector('.sv-prate b').textContent+' '+e.querySelector('.sv-pcounts').innerText.replace(/\\n/g,' ')).join(' || ')`);
  console.log('· 队员行:', rows);
  const radar = await evalJS(`!!document.querySelector('.sv-radar-poly')`);
  ok('技能雷达渲染', radar);
  const sess = await evalJS(`Array.from(document.querySelectorAll('.sv-session')).slice(0,3).map(e=>e.innerText.replace(/\\n/g,' ')).join(' || ')`);
  console.log('· 最近训练:', sess);
  const foot = await evalJS(`(document.querySelector('.sv-foot p')||{}).textContent||''`);
  console.log('· 页脚:', foot);

  const h = await evalJS(`(document.querySelector('#shareView')||{scrollHeight:900}).scrollHeight`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: Math.min(h, 4000), deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await shot('s1-share-full.png');

  // 坏链接兜底（先 blank 再进，避免同文档导航只改 hash）
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#share=zzzz-not-valid` });
  await sleep(1200);
  const errTxt = await evalJS(`(document.querySelector('.sv-h1')||{}).innerText||''`);
  ok('坏链接有兜底页', errTxt.includes('链接不完整'), errTxt.replace(/\n/g, ''));
  await shot('s2-share-error.png');

  // 桌面宽度看一眼
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url });
  await sleep(1500);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await shot('s3-share-desktop.png');
} catch (e) {
  console.error('FAILED', e);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { /* ignore */ }
  edge.kill();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
