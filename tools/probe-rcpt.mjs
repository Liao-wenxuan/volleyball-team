// 临时探针：手机宽度下打开回执弹窗，量布局。用完可删。
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const ROOT = process.cwd();
const PORT = 5541;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=9227', `--user-data-dir=${path.join(ROOT, 'preview', 'edgeprof-probe')}`, '--no-first-run', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9227/json/list')).json(); if (list.length) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);
const seedRaw = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');
await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seedRaw)}); 'ok'`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1800);
// 不用视口模拟：窗口本身就是 390 宽，模拟在 headless 下会漂移
for (let i = 0; i < 5; i++) {
  const vw = await evalJS(`window.innerWidth`);
  if (vw === 390) break;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1500);
}
console.log('vw =', await evalJS(`window.innerWidth`));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await evalJS(`document.querySelector('.nav-item[data-page="attendance"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('#attRcptBtn').click(); 'x'`);
await sleep(800);
const vw2 = await evalJS(`(() => {
  window.__resizes = 0;
  window.addEventListener('resize', () => { window.__resizes += 1; });
  return { iw: window.innerWidth, ow: window.outerWidth, sw: screen.width, dpr: window.devicePixelRatio, vv: window.visualViewport ? window.visualViewport.scale : null };
})()`);
console.log('打开弹窗前', JSON.stringify(vw2));
await evalJS(`document.querySelector('#attRcptBtn').click(); 'x'`);
await sleep(800);
const vw3 = await evalJS(`({ iw: window.innerWidth, ow: window.outerWidth, sw: screen.width, dpr: window.devicePixelRatio, rz: window.__resizes })`);
console.log('打开弹窗后', JSON.stringify(vw3));
const info = await evalJS(`(() => {
  const m = document.querySelector('#modalScrim .modal');
  if (!m) return { err: 'modal 没开' };
  const ta = document.querySelector('#rcptInput');
  const r = m.getBoundingClientRect();
  const t = ta.getBoundingClientRect();
  return { vw: window.innerWidth, cls: m.className,
    modal: { x: Math.round(r.x), w: Math.round(r.width) },
    ta: { x: Math.round(t.x), w: Math.round(t.width) },
    hintW: Math.round(document.querySelector('.rcpt-hint').getBoundingClientRect().width),
    scrollW: document.documentElement.scrollWidth };
})()`);
console.log(JSON.stringify(info));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(path.join(ROOT, 'preview', 'probe-rcpt.png'), Buffer.from(shot.result.data, 'base64'));
ws.close(); edge.kill(); server.close();
