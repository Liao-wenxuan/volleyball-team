// 端到端验证：收集表 xlsx 一键导入（真实样本文件）+ 性别补录 + 合并语义
// 场景：A = 种子 10 人；收集表 18 人（与种子不重名）→ 全新增；
//       二次导入同一份 → 全部「更新」不重复；TSV 粘贴路径带性别列。
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5553;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let PROF = path.join(ROOT, 'preview', 'edgeprof-sheet');
try { rmSync(PROF, { recursive: true, force: true }); } catch { PROF = path.join(ROOT, 'preview', 'edgeprof-sheet-' + Date.now()); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.xlsx': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/sw.js') { res.writeHead(404); res.end('no sw in tests'); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9243', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:9243/json/list')).json(); if (list.length) break; } catch { await new Promise(r => setTimeout(r, 300)); } }
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('CDP 没起来'); process.exit(1); }
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
const go = async (url) => { await send('Page.navigate', { url }); await sleep(1400); };
let failed = 0;
const check = (label, cond, extra) => {
  if (!cond) failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${label}${extra !== undefined ? ' — ' + extra : ''}`);
};
const pickFile = async (selector, filePath) => {
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId: q.result.nodeId });
};
const dbNow = () => evalJS(`JSON.parse(localStorage.getItem('xgy_volleyball_v2'))`);

const seed = JSON.parse(readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8'));
const SAMPLE = path.join(ROOT, 'tools', 'samples', '队员信息数据收集.xlsx');
const BASE = `http://127.0.0.1:${PORT}/index.html`;

await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
await go(BASE);
await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(JSON.stringify(seed))}); 'ok'`);
await go(BASE);

/* ── 1. 第一次导入：18 人全新增 ── */
console.log('\n【1】收集表 xlsx 首次导入');
await evalJS(`document.querySelector('.nav-item[data-page="roster"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(500);
const entry = await evalJS(`(() => ({
  lab: !!document.querySelector('label[for="sheetFile"]'),
  input: !!document.querySelector('#sheetFile'),
  paste: !!document.querySelector('#siPaste')
}))()`);
check('入口弹窗：label for 原生触发 + 粘贴兜底', entry.lab && entry.input && entry.paste);

await pickFile('#sheetFile', SAMPLE);
await sleep(1200);
const pv = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('.si-tr')].slice(1);
  const acts = [...document.querySelectorAll('.si-act')].map(e => e.textContent.trim());
  return {
    open: !!document.querySelector('#siCommit'),
    count: rows.length,
    newCount: acts.filter(a => a === '新增').length,
    warns: [...document.querySelectorAll('.si-warns p')].map(p => p.textContent.trim()),
    first: rows[0] ? rows[0].textContent.replace(/\\s+/g, ' ').trim() : ''
  };
})()`);
check('预览弹出，读出 18 人', pv.open && pv.count === 18, `${pv.count} 行`);
check('18 人全部标记「新增」', pv.newCount === 18, `${pv.newCount} 新增`);
check('脏数据警告出现（重号 / 没号码）', pv.warns.length >= 2, pv.warns.length + ' 条');
check('警告里点名了 4 号撞号', pv.warns.some(w => w.includes('4 号') && w.includes('两个人')), pv.warns.find(w => w.includes('4 号')) || '');
{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'preview', 's9-sheet-import.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('· 截图 s9-sheet-import.png');
}

// 性别：预览里给前 3 人点出性别（模拟用户当场补）
await evalJS(`document.querySelectorAll('.si-g')[0].click(); document.querySelectorAll('.si-g')[0].click(); 'x'`); // 未填→女→男
await evalJS(`document.querySelectorAll('.si-g')[1].click(); 'x'`); // →女
const gAfter = await evalJS(`[...document.querySelectorAll('.si-g')].slice(0, 3).map(b => b.textContent.trim())`);
check('预览里能点选性别（循环切换）', gAfter[0].includes('男') && gAfter[1].includes('女'), gAfter.join(' / '));

await evalJS(`document.querySelector('#siCommit').click(); 'x'`);
await sleep(2200);
let d = await dbNow();
const zhou = (d.players || []).find(p => p.name === '周雨欣');
const xiao = (d.players || []).find(p => p.name === '肖诗琪');
check('导入后 28 人（种子 10 + 表 18）', (d.players || []).length === 28, (d.players || []).length);
check('身高带单位的清洗掉了（周雨欣 168cm → 168）', zhou && zhou.height === 168, zhou && zhou.height);
check('号码「无」按 0 记（肖诗琪）', xiao && xiao.number === 0, xiao && xiao.number);
check('预览里点的性别落库（第 1 人男、第 2 人女）', d.players.find(p => p.name === '宋智宇').gender === '男' && d.players.find(p => p.name === '赵梓吟').gender === '女');
check('种子队员原样保留（陈一鸣还在）', (d.players || []).some(p => p.name === '陈一鸣'));
check('种子技能记录没被动', (d.skillLogs || []).length === (seed.skillLogs || []).length, (d.skillLogs || []).length);

/* ── 2. 第二次导入同一份：全部「更新」，不重复 ── */
console.log('\n【2】二次导入（合并语义）');
await sleep(600);
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('#siPaste').click(); 'x'`);
await sleep(400);
// 粘贴路径顺带验证性别列识别
await evalJS(`document.querySelector('#siText').value = ${JSON.stringify('姓名（必填）\t球服号码（必填）\t位置（必填）\t性别\t年级（必填）\t身高（必填）\n宋智宇\t25\t自由人\t男\t大三\t177\n周雨欣\t66\t接应\t女\t大一\t169\n新面孔\t88\t副攻\t男\t大一\t180')}; 'x'`);
await evalJS(`document.querySelector('#siGo').click(); 'x'`);
await sleep(900);
const pv2 = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('.si-tr')].slice(1);
  const acts = [...document.querySelectorAll('.si-act')].map(e => e.textContent.trim());
  return { count: rows.length, up: acts.filter(a => a.startsWith('更新')).length, add: acts.filter(a => a === '新增').length,
    g: [...document.querySelectorAll('.si-g')].map(b => b.textContent.trim()) };
})()`);
check('粘贴 TSV 解析出 3 人', pv2.count === 3, `${pv2.count} 行`);
check('表里的人标记「更新」（2 个）', pv2.up === 2, `${pv2.up} 更新`);
check('新名字标记「新增」（1 个）', pv2.add === 1, `${pv2.add} 新增`);
check('性别列自动识别（宋智宇男/周雨欣女）', /♂/.test(pv2.g[0]) && /♀/.test(pv2.g[1]), pv2.g.slice(0, 2).join(' / '));
await evalJS(`document.querySelector('#siCommit').click(); 'x'`);
await sleep(2200);
d = await dbNow();
check('二次导入后 29 人（18 + 1 新 + 种子 10）', (d.players || []).length === 29, (d.players || []).length);
check('周雨欣身高被表格更新（168 → 169）', d.players.find(p => p.name === '周雨欣').height === 169);
check('性别列落库（周雨欣 → 女）', d.players.find(p => p.name === '周雨欣').gender === '女');
check('没有产生重复队员（宋智宇仍只有 1 个）', (d.players || []).filter(p => p.name === '宋智宇').length === 1);

/* ── 3. 队员卡性别标记 ── */
console.log('\n【3】卡片显示');
const card = await evalJS(`(() => {
  document.querySelector('.nav-item[data-page="roster"]').click(); 'x';
  return { g: document.querySelectorAll('.pc-g').length };
})()`);
await sleep(500);
const cardOk = await evalJS(`({ g: document.querySelectorAll('.pc-g').length, f: document.querySelectorAll('.pc-g.gf').length, m: document.querySelectorAll('.pc-g.gm').length })`);
check('队员卡显示性别标记（男蓝女粉）', cardOk.g > 0 && cardOk.f > 0 && cardOk.m > 0, `♂${cardOk.m} ♀${cardOk.f}`);

/* ── 4. 坏文件容错 ── */
console.log('\n【4】容错');
const badPath = path.join(ROOT, 'preview', 'not-a-sheet.png');
writeFileSync(badPath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(400);
await pickFile('#sheetFile', badPath);
await sleep(900);
const bad = await evalJS(`(() => ({ alive: !!document.querySelector('#sheetFile'), toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent.trim()).join('|') }))()`);
check('选了非表格文件只提示不崩', bad.alive && /表格|解析|备份/i.test(bad.toast), bad.toast.slice(0, 50));

console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}`);
ws.close(); edge.kill(); server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
