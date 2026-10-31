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
const entry = await evalJS(`(() => {
  const inp = document.querySelector('#sheetFile');
  const lab = inp ? inp.closest('label.imp-file') : null;
  const lr = lab ? lab.getBoundingClientRect() : null;
  // 点按钮正中心，命中的必须是 input 本体——这才是「铺满」
  const hit = lr ? document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) : null;
  return {
    lab: !!lab,
    input: !!inp,
    cover: !!hit && hit.id === 'sheetFile',
    accept: inp ? inp.getAttribute('accept') : 'missing',
    paste: !!document.querySelector('#siPaste')
  };
})()`);
check('入口：透明 input 铺满按钮 + 粘贴兜底', entry.lab && entry.input && entry.cover && entry.paste);
check('xlsx 输入框不带 accept（安卓选择器不按 MIME 过滤）', entry.accept === null);

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
check('警告里点名了 4 号撞号（表里没性别列，先算同队）',
  pv.warns.some(w => w.includes('4 号') && w.includes('乔奕博') && w.includes('张佳')),
  pv.warns.find(w => w.includes('4 号')) || '');
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

/* ── 4. 号码查重按性别分队：男队女队可以同号 ── */
console.log('\n【4】号码按性别查重');
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('#siPaste').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('#siText').value = ${JSON.stringify('姓名\t号码\t位置\t性别\t年级\t身高\n男甲\t50\t主攻\t男\t大一\t180\n女甲\t50\t主攻\t女\t大一\t175\n男乙\t50\t副攻\t男\t大一\t185')}; 'x'`);
await evalJS(`document.querySelector('#siGo').click(); 'x'`);
await sleep(900);
const dupPv = await evalJS(`({
  w: [...document.querySelectorAll('#siWarns p')].map(p => p.textContent.trim()),
  g: [...document.querySelectorAll('.si-g')].map(b => b.textContent.trim())
})`);
check('同性别撞号报警（男甲 / 男乙 都是 50 号）',
  dupPv.w.some(x => x.includes('50 号') && x.includes('男队') && x.includes('男甲') && x.includes('男乙')),
  dupPv.w.find(x => x.includes('50')) || '');
check('男女同号不报警（女甲 50 号没被点名）',
  !dupPv.w.some(x => x.includes('女甲')), dupPv.w.filter(x => x.includes('女甲')).join('|'));
// 把「男乙」点成女：冲突应当跟着性别换组，而不是死盯着号码
await evalJS(`(() => { const b = document.querySelectorAll('.si-g')[2]; b.click(); b.click(); })(); 'x'`);
await sleep(300);
const dupPv2 = await evalJS(`[...document.querySelectorAll('#siWarns p')].map(p => p.textContent.trim())`);
check('改性别后警告按新分组重算（50 号变成女队冲突）',
  dupPv2.some(x => x.includes('50 号') && x.includes('女队') && x.includes('女甲')),
  dupPv2.find(x => x.includes('50')) || '');
await evalJS(`document.querySelector('#modalClose').click(); 'x'`);
await sleep(300);

/* ── 5. 坏文件容错 ── */
console.log('\n【5】容错');
const badPath = path.join(ROOT, 'preview', 'not-a-sheet.png');
writeFileSync(badPath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(400);
await pickFile('#sheetFile', badPath);
await sleep(900);
const bad = await evalJS(`(() => ({ alive: !!document.querySelector('#sheetFile'), toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent.trim()).join('|') }))()`);
check('选了非表格文件只提示不崩', bad.alive && /表格|解析|备份/i.test(bad.toast), bad.toast.slice(0, 50));

/* ── 6. 新增队员表单：号码只在同性别内查重 ── */
console.log('\n【6】新增队员的号码校验');
await evalJS(`document.querySelector('.nav-item[data-page="roster"]').click(); 'x'`);
await sleep(400);
const fillPlayer = (num, gender) => evalJS(`(() => {
  const f = document.querySelector('#playerForm');
  if (!f) return 'no-form';
  f.querySelector('[name=name]').value = '查重测试';
  f.querySelector('[name=number]').value = '${num}';
  f.querySelector('[name=gender]').value = '${gender}';
  f.querySelector('[name=height]').value = '180';
  f.requestSubmit();
  return 'ok';
})()`);
await evalJS(`document.querySelector('#addPlayerBtn').click(); 'x'`);
await sleep(400);
await fillPlayer(25, '男'); // 库里宋智宇是 25 号男
await sleep(600);
const t1 = await evalJS(`[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent.trim()).join(' | ')`);
const n1 = (await dbNow()).players.length;
check('同性别撞号被拦住（25 号男已有宋智宇）', /25 号/.test(t1) && n1 === 29, `${t1.slice(0, 48)} / ${n1} 人`);
await fillPlayer(25, '女'); // 换个性别：男女可以同号
await sleep(1000);
const d6 = await dbNow();
const girl = (d6.players || []).find(p => p.name === '查重测试');
check('换个性别就能穿同一个号（新增成功）',
  (d6.players || []).length === 30 && girl && girl.number === 25 && girl.gender === '女',
  `人数 ${(d6.players || []).length} / ${girl ? girl.number + '#' + girl.gender : '没建上'}`);

/* ── 7. 粘贴接龙文本（老入口）：号码同样按性别查重 ── */
console.log('\n【7】粘贴接龙文本');
const typeBulk = (text) => evalJS(`(() => {
  const t = document.querySelector('#importText');
  t.value = ${JSON.stringify(text)};
  t.dispatchEvent(new Event('input'));
  return 'ok';
})()`);
await evalJS(`document.querySelector('#bulkImportBtn').click(); 'x'`);
await sleep(400);
await typeBulk('姓名\t号码\t位置\t年级\t身高\t性别\n男丙\t60\t主攻\t大一\t180\t男\n女丙\t60\t主攻\t大一\t175\t女');
await sleep(400);
const bk1 = await evalJS(`({
  ok: [...document.querySelectorAll('.ip-row')].filter(r => !r.className.includes('off')).length,
  errs: [...document.querySelectorAll('.ip-tag.err')].map(e => e.textContent.trim()),
  hint: (document.querySelector('#importHint') || {}).textContent || ''
})`);
check('男女同号两行都放行（60 号一男一女）', bk1.ok === 2 && bk1.errs.length === 0, `${bk1.ok} 行可导入 / ${bk1.errs.join(',') || '无报错'}`);
await typeBulk('姓名\t号码\t位置\t年级\t身高\t性别\n男戊\t61\t主攻\t大一\t180\t男\n男己\t61\t副攻\t大一\t182\t男');
await sleep(400);
const bk2 = await evalJS(`({
  ok: [...document.querySelectorAll('.ip-row')].filter(r => !r.className.includes('off')).length,
  errs: [...document.querySelectorAll('.ip-tag.err')].map(e => e.textContent.trim())
})`);
check('同性别同号仍然报错（61 号两个男）', bk2.ok === 1 && bk2.errs.some(e => e.includes('61') && e.includes('男队')), `${bk2.ok} 行可导入 / ${bk2.errs.join(',')}`);
await evalJS(`document.querySelector('#modalClose').click(); 'x'`);
await sleep(300);

/* ── 8. 微信/QQ 内置浏览器：选不了文件就先把粘贴推上来 ── */
console.log('\n【8】内置浏览器兜底');
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50.2701(0x2800323D) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64' });
await sleep(300);
await evalJS(`document.querySelector('.nav-item[data-page="roster"]').click(); 'x'`);
await sleep(400);
await evalJS(`document.querySelector('[data-action="sheet-import"]').click(); 'x'`);
await sleep(500);
const wx = await evalJS(`({
  alert: (document.querySelector('.imp-alert') || {}).textContent || '',
  pastePrimary: /btn-primary/.test((document.querySelector('#siPaste') || {}).className || ''),
  fileGhost: /btn-ghost/.test((document.querySelector('label.imp-file') || {}).className || ''),
  copyLink: !!document.querySelector('#siCopyLink'),
  pasteStillWorks: !!document.querySelector('#siPaste')
})`);
check('微信里先说明「选不了文件，不是页面坏了」', /微信里选不了文件/.test(wx.alert), wx.alert.replace(/\s+/g, ' ').slice(0, 46));
check('微信里把「粘贴表格内容」升成主按钮', wx.pastePrimary && wx.fileGhost);
check('微信里给「复制链接去浏览器」的出口', wx.copyLink);
check('粘贴通路本身没被影响', wx.pasteStillWorks);
await evalJS(`document.querySelector('#siPaste').click(); 'x'`);
await sleep(400);
check('点粘贴能进到粘贴框', await evalJS(`!!document.querySelector('#siText')`) === true);
await send('Emulation.setUserAgentOverride', { userAgent: '' });
await sleep(200);

console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}`);
ws.close(); edge.kill(); server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
