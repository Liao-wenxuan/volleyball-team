// 临时探针：截「从表格导入队员」和「导入备份」两个入口弹窗，确认按钮没被铺满的 input 带歪
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5577;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-entry');
try { rmSync(PROF, { recursive: true, force: true }); } catch {}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/sw.js') { res.writeHead(404); res.end('no sw'); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9322', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9322/json/list')).json(); if (list.length) break; } catch { await new Promise(r => setTimeout(r, 300)); } }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', name), Buffer.from(r.result.data, 'base64'));
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 834, height: 1000, deviceScaleFactor: 2, mobile: false }); // iPad 竖屏宽度
const seed = JSON.parse(readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8'));
const BASE = `http://127.0.0.1:${PORT}/index.html`;
await send('Page.navigate', { url: BASE }); await sleep(1400);
await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(JSON.stringify(seed))}); 'ok'`);
await send('Page.navigate', { url: BASE }); await sleep(1600);
await evalJS(`document.querySelector('.nav-item[data-page="roster"]').click(); 'x'`); await sleep(500);
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`); await sleep(500);
console.log('sheet 入口 box:', await evalJS(`(() => {
  const l = document.querySelector('label.imp-file'); const i = document.querySelector('#sheetFile');
  const lr = l.getBoundingClientRect(); const ir = i.getBoundingClientRect();
  return JSON.stringify({ label: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.width), Math.round(lr.height)],
    input: [Math.round(ir.left), Math.round(ir.top), Math.round(ir.width), Math.round(ir.height)],
    hit: (document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) || {}).id });
})()`));
await shot('r17-entry-sheet.png');
await evalJS(`document.querySelector('#modalClose').click(); 'x'`); await sleep(300);
await evalJS(`document.querySelector('#avatarBtn').click(); 'x'`); await sleep(300);
await evalJS(`document.querySelector('#menuImport').click(); 'x'`); await sleep(500);
await shot('r17-entry-backup.png');
console.log('backup 入口 box:', await evalJS(`(() => {
  const l = document.querySelector('label.imp-file'); const i = document.querySelector('#importFile');
  const lr = l.getBoundingClientRect();
  return JSON.stringify({ w: Math.round(lr.width), h: Math.round(lr.height),
    hit: (document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) || {}).id });
})()`));
ws.close(); edge.kill(); server.close();
setTimeout(() => process.exit(0), 300);
