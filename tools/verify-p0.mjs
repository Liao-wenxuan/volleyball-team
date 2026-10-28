// 端到端验证 P0：训练签到页 + 训练卡 + 分享页认领本人
// 真实 Chromium（Edge headless）+ CDP，含手势模拟与产物导出
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5537;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-p0');
const SHOTS = path.join(ROOT, 'preview');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9223', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9223/json/list')).json(); if (list.length) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 300));
}
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('CDP 没起来'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (label, cond, extra = '') => console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  console.log('· 截图', name);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const seed = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seed)}); localStorage.removeItem('xgy_share_self'); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1800);

  /* ── 签到页 ── */
  await evalJS(`document.querySelector('[data-page=checkin]').click(); 'x'`);
  await sleep(900);
  const cards = await evalJS(`document.querySelectorAll('.ci-card').length`);
  ok('签到页渲染队员卡片', cards === 10, `${cards} 张`);
  const head = await evalJS(`(document.querySelector('.ci-head b')||{}).textContent||''`);
  console.log('· 当前训练:', head);

  // 点一下 = 出勤
  await evalJS(`document.querySelector('.ci-card').click(); 'x'`);
  await sleep(300);
  let st = await evalJS(`document.querySelector('.ci-card').className`);
  ok('点击 = 出勤', st.includes('present'), st);

  // 再点 = 取消
  await evalJS(`document.querySelector('.ci-card').click(); 'x'`);
  await sleep(300);
  st = await evalJS(`document.querySelector('.ci-card').className`);
  ok('再点 = 取消', st.includes('unmarked'), st);

  // 左滑 = 迟到
  await evalJS(`(()=>{const el=document.querySelector('.ci-card');const r=el.getBoundingClientRect();
    const o={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch',button:0};
    el.dispatchEvent(new PointerEvent('pointerdown',o));
    el.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:o.clientX-70}));
    el.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:o.clientX-70}));return 'swiped';})()`);
  await sleep(300);
  st = await evalJS(`document.querySelector('.ci-card').className`);
  ok('左滑 = 迟到', st.includes('late'), st);

  // 长按 = 菜单 → 请假
  await evalJS(`(()=>{const el=document.querySelector('.ci-card');const r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch',button:0}));return 'down';})()`);
  await sleep(700);
  const menu = await evalJS(`!!document.querySelector('.ci-menu')`);
  ok('长按弹出状态菜单', menu);
  if (menu) {
    await evalJS(`document.querySelector('.ci-menu [data-st=leave]').click(); 'x'`);
    await sleep(300);
    st = await evalJS(`document.querySelector('.ci-card').className`);
    ok('菜单选「请假」生效', st.includes('leave'), st);
  }
  const nums = await evalJS(`(document.querySelector('.ci-nums')||{}).innerText||''`);
  console.log('· 统计:', nums.replace(/\n/g, ' '));
  await shot('p0-checkin-mobile.png');

  // 全部出勤
  await evalJS(`document.querySelector('#ciAllPresent').click(); 'x'`);
  await sleep(500);
  await evalJS(`document.querySelector('.confirm-ok, #confirmOk, .btn-danger')?.click(); 'x'`);
  await sleep(600);
  const allPresent = await evalJS(`Array.from(document.querySelectorAll('.ci-card')).every(e=>e.className.includes('present'))`);
  ok('全部出勤按钮', allPresent);

  /* ── 训练卡 ── */
  await evalJS(`document.querySelector('#ciCardBtn').click(); 'x'`);
  await sleep(1200);
  const img = await evalJS(`(()=>{const i=document.querySelector('.card-preview');return i?i.src.slice(0,40):'';})()`);
  ok('训练卡生成预览', img.startsWith('data:image/png'), img.slice(0, 30) + '…');
  const dataURL = await evalJS(`(()=>{const i=document.querySelector('.card-preview');return i?i.src:'';})()`);
  if (dataURL.startsWith('data:image/png')) {
    writeFileSync(path.join(SHOTS, 'training-card.png'), Buffer.from(dataURL.split(',')[1], 'base64'));
    console.log('· 训练卡已导出 preview/training-card.png');
  }
  await shot('p0-card-modal.png');
  await evalJS(`document.querySelector('#cardClose').click(); 'x'`);
  await sleep(400);

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJS(`document.querySelector('[data-page=checkin]').click(); 'x'`);
  await sleep(700);
  await shot('p0-checkin-desktop.png');

  /* ── 分享页认领 ── */
  await evalJS(`document.querySelector('#menuShare').click(); 'x'`);
  await sleep(900);
  const url = await evalJS(`(document.querySelector('#shareLink')||{}).value||''`);
  ok('分享链接生成', url.includes('#share='), `${url.length} chars`);
  await evalJS(`document.querySelector('#shareClose').click(); 'x'`);
  await send('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(1500);
  const pick = await evalJS(`document.querySelectorAll('.sv-pick-btn').length`);
  ok('先出认领名单（不摊开全队）', pick === 10, `${pick} 人`);
  await shot('p0-share-picker.png');
  await evalJS(`document.querySelector('.sv-pick-btn').click(); 'x'`);
  await sleep(700);
  const title = await evalJS(`document.title`);
  const hero = await evalJS(`(document.querySelector('.sv-h1')||{}).innerText||''`);
  ok('认领后只显示本人', title.includes('我的训练档案'), `${title} / ${hero.replace(/\n/g, ' ')}`);
  const tl = await evalJS(`document.querySelectorAll('.sv-tl-row').length`);
  ok('本人出勤时间线', tl > 0, `${tl} 行`);
  const h = await evalJS(`(document.querySelector('#shareView')||{scrollHeight:900}).scrollHeight`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: Math.min(h, 3000), deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await shot('p0-share-self.png');
} catch (e) {
  console.error('FAILED', e);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { /* ignore */ }
  edge.kill();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
