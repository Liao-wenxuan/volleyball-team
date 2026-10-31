// 一次性探针：真实 Edge 里跑 xlsx.js，读真实样本文件
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5551;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xlsx': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=9241', '--user-data-dir=' + path.join(ROOT, 'preview', 'edgeprof-xlsx'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9241/json/list')).json(); if (list.length) break; } catch { await new Promise(r => setTimeout(r, 300)); } }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/xlsxtest.html` });
await sleep(600);

// 把样本文件灌进页面（base64 传输，ArrayBuffer 直传会超时——踩过这个坑）
const sampleB64 = readFileSync(path.join(ROOT, 'tools', 'samples', '队员信息数据收集.xlsx')).toString('base64');
const result = await evalJS(`(async () => {
  try {
    const bin = atob(${JSON.stringify(sampleB64)});
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const wb = await window.XGYXlsx.read(u8.buffer);
    const sh = wb.sheets[0];
    return {
      ok: true,
      sheetCount: wb.sheets.length,
      sheetName: sh.name,
      rows: sh.rows.length,
      header: sh.rows[0],
      first: sh.rows[1],
      last: sh.rows[sh.rows.length - 1],
      row2: sh.rows[2],
      colCount: Math.max(...sh.rows.map(r => r.length))
    };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
})()`);
console.log(JSON.stringify(result, null, 2));

ws.close(); edge.kill(); server.close();
setTimeout(() => process.exit(0), 200);
