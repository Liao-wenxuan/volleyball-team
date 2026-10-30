// 端到端验证：安卓平板导入备份的两条通路
//  ① 原生 <label for> 触发文件选择器（不再靠 JS click 屏幕外的 input）
//  ② 导入链接 #backup=（完全不碰文件选择器，链接点开就直接进导入流程）
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5546;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let PROF = path.join(ROOT, 'preview', 'edgeprof-link');
try { rmSync(PROF, { recursive: true, force: true }); } catch { PROF = path.join(ROOT, 'preview', 'edgeprof-link-' + Date.now()); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  // 测试里不装 SW：否则上次缓存的 app.js 会冒充新代码
  if (u === '/sw.js') { res.writeHead(404); res.end('no sw in tests'); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9236', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9236/json/list')).json(); if (list.length) break; } catch { /* retry */ }
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
const go = async (url) => { await send('Page.navigate', { url }); await sleep(1500); };

let failed = 0;
const check = (label, cond, extra) => {
  if (!cond) failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${label}${extra !== undefined ? ' — ' + extra : ''}`);
};

const seed = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');
const seedDB = JSON.parse(seed);
const BASE = `http://127.0.0.1:${PORT}/index.html`;

await send('Page.enable');
await send('Runtime.enable');
await go(BASE);
await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(JSON.stringify(seedDB))}); 'ok'`);
await go(BASE);

/* ══════════ 一、安卓触发通路：label for 而不是 JS click ══════════ */
console.log('\n【1】文件选择入口（安卓 PWA 的坑）');
await evalJS(`document.querySelector('#userChip').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="import"]').click(); 'x'`);
await sleep(500);
const pick = await evalJS(`(() => {
  const lab = document.querySelector('label[for="importFile"]');
  const inp = document.querySelector('#importFile');
  const cs = inp ? getComputedStyle(inp) : null;
  const r = lab ? lab.getBoundingClientRect() : null;
  return {
    isLabel: !!lab,
    tag: lab ? lab.tagName : '',
    text: lab ? lab.textContent.trim() : '',
    width: r ? Math.round(r.width) : 0,
    inputLeft: cs ? cs.left : '',
    inputPos: cs ? cs.position : '',
    hiddenInput: !!document.querySelector('input[type=file][hidden]'),
    hasJsClickBtn: !!document.querySelector('#impPickFile')
  };
})()`);
check('入口是 <label for="importFile">（原生触发，安卓内核不拦）', pick.isLabel && pick.tag === 'LABEL', pick.text);
check('label 有实际尺寸（不是 0 宽的空壳）', pick.width > 100, pick.width + 'px');
check('文件 input 留在视口内（不用 left:-9999px）', pick.inputPos === 'fixed' && parseFloat(pick.inputLeft) >= 0, `${pick.inputPos} left=${pick.inputLeft}`);
check('没有 display:none 的隐藏 input', !pick.hiddenInput);
check('旧的 JS click 按钮已移除', !pick.hasJsClickBtn);

{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', 's7-import-chooser.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('· 截图 s7-import-chooser.png');
}
{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', 's7-import-chooser.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('· 截图 s7-import-chooser.png');
}
const choices = await evalJS(`[...document.querySelectorAll('.imp-choice > *')].map(e => e.textContent.trim())`);
check('导入方式有 3 条（选文件 / 链接 / 粘贴）', choices.length === 3, choices.join(' / '));

/* ══════════ 二、电脑端生成导入链接 ══════════ */
console.log('\n【2】生成导入链接');
await evalJS(`document.querySelector('#userChip').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="link-export"]').click(); 'x'`);
await sleep(1400);
const out = await evalJS(`(() => {
  const t = document.querySelector('#lnkOut');
  return { len: t ? t.value.length : 0, head: t ? t.value.slice(0, 58) : '', hasTag: t ? /#backup=z/.test(t.value) : false, note: (document.querySelector('.imp-note') || {}).textContent || '' };
})()`);
check('弹窗给出导入链接', out.len > 100, `${out.len} 字符`);
check('链接用 deflate 压缩（#backup=z 前缀）', out.hasTag, out.head);
check('链接长度在可用范围（<8000）', out.len < 8000, out.len + ' 字符');
check('长度提示按实际数字给出', /\d+ 字符/.test(out.note), out.note.trim().slice(0, 24));

{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', 's8-link-export.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('· 截图 s8-link-export.png');
}
{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', 's8-link-export.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('· 截图 s8-link-export.png');
}
const link = await evalJS(`document.querySelector('#lnkOut').value`);

/* ══════════ 三、平板上打开链接：空库直接导入 ══════════ */
console.log('\n【3】另一台设备打开链接（模拟平板）');
await evalJS(`localStorage.removeItem('xgy_volleyball_v2'); 'ok'`);
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);
await go(link);
const auto = await evalJS(`(() => {
  const shown = document.querySelector('#modalScrim').classList.contains('show');
  const body = document.querySelector('#modalBody').textContent;
  return { shown, title: document.querySelector('#modalTitle').textContent, body: body.replace(/\\s+/g, ' ').slice(0, 400) };
})()`);
check('打开链接自动弹导入窗', auto.shown, auto.title);
check('来源显示为「导入链接」', /导入链接/.test(auto.body), auto.body.slice(0, 50));
check('预览：空库 → 新增 10 人', /新增 10/.test(auto.body), auto.body.match(/匹配[^|]*\|[^|]*\|[^，]*/)?.[0] || auto.body);

await evalJS(`document.querySelector('#impGo').click(); 'x'`);
await sleep(2200);
const after = await evalJS(`(() => {
  const d = JSON.parse(localStorage.getItem('xgy_volleyball_v2') || '{}');
  const chen = (d.players || []).find(p => p.name === '陈一鸣');
  return {
    players: (d.players || []).length,
    sessions: Object.values(d.weeks || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0),
    logs: (d.skillLogs || []).length,
    serve: chen ? chen.skills.serve : null,
    hash: location.hash
  };
})()`);
check('导入后队员 10 人', after.players === 10, after.players);
const expSessions = Object.values(seedDB.weeks || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
check('训练场次完整', after.sessions === expSessions, `${after.sessions}/${expSessions} 场`);
check('技能记录完整', after.logs === (seedDB.skillLogs || []).length, after.logs);
check('技能分数没被串（陈一鸣发球）', after.serve === seedDB.players.find((p) => p.name === '陈一鸣').skills.serve, after.serve);
check('导入后 hash 已清空（不会反复弹）', after.hash === '', JSON.stringify(after.hash));

/* ══════════ 四、手动粘链接导入 ══════════ */
console.log('\n【4】手动粘贴链接导入（合并模式）');
await evalJS(`document.querySelector('#userChip').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="import"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('#impPickLink').click(); 'x'`);
await sleep(400);
const dlg = await evalJS(`(() => ({ title: document.querySelector('#modalTitle').textContent, hasTa: !!document.querySelector('#lnkIn'), hasClip: !!document.querySelector('#lnkClip') }))()`);
check('「用链接导入」弹窗正常', dlg.hasTa && dlg.hasClip, dlg.title);

await evalJS(`document.querySelector('#lnkIn').value = ${JSON.stringify(link)}; 'x'`);
await evalJS(`document.querySelector('#lnkGo').click(); 'x'`);
await sleep(1200);
const merged = await evalJS(`(() => {
  const b = document.querySelector('#modalBody').textContent.replace(/\\s+/g, ' ');
  return { shown: document.querySelector('#modalScrim').classList.contains('show'), body: b.slice(0, 400) };
})()`);
check('粘链接后进入导入预览', merged.shown && /匹配/.test(merged.body), merged.body.slice(0, 60));
check('同库导入 → 全部匹配、无新增', /匹配 10/.test(merged.body) && /新增 0/.test(merged.body), merged.body.match(/匹配[^|]*\|[^|]*\|[^，]*/)?.[0] || '');

/* ══════════ 五、坏链接不崩 ══════════ */
console.log('\n【5】容错');
await evalJS(`document.querySelector('#userChip').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="import"]').click(); 'x'`);
await sleep(300);
await evalJS(`document.querySelector('#impPickLink').click(); 'x'`);
await sleep(300);
await evalJS(`document.querySelector('#lnkIn').value = 'https://example.com/#backup=zAAAABBBBCCCC'; 'x'`);
await evalJS(`document.querySelector('#lnkGo').click(); 'x'`);
await sleep(900);
const bad = await evalJS(`(() => ({
  alive: !!document.querySelector('#lnkGo') || document.querySelector('#modalScrim').classList.contains('show'),
  toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent.trim()).join(' | ')
}))()`);
check('坏链接只提示不崩溃', bad.alive && /读不出来|没找到/.test(bad.toast), bad.toast.slice(0, 40));

console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}`);
ws.close();
edge.kill();
server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
