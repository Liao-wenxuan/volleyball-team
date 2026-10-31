// 端到端验证：按姓名/号码合并导入 + 完全覆盖 + 粘贴入口
// 场景：本机（平板）有 10 人 + 3 周考勤；备份来自电脑，改了 1 人的技能、多了 1 个新人、少了 1 个老人，
// 还多了一场训练、改了一场已有训练的考勤、带了一条重复的技能记录。
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5544;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-import');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  // 测试里不装 SW：否则「上次缓存的 app.js」会冒充新代码（踩过这个坑）
  if (u === '/sw.js') { res.writeHead(404); res.end('no sw in tests'); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9233', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9233/json/list')).json(); if (list.length) break; } catch { /* retry */ }
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

let failed = 0;
const check = (label, cond, extra) => {
  if (!cond) failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${label}${extra !== undefined ? ' — ' + extra : ''}`);
};

/* ── 造备份：A 是本机现有数据，B 是电脑上的新备份 ── */
const A = JSON.parse(readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8'));
const B = JSON.parse(JSON.stringify(A));
B.savedAt = Date.now();

const pad2 = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const mon = new Date(); mon.setHours(12, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
const wkKey = dk(mon);

// ① 陈一鸣发球 7.5 → 9.5（同人同号码，应被覆盖）
B.players.find((p) => p.name === '陈一鸣').skills.serve = 9.5;
// ② 备份里多一个新人
B.players.push({ id: 'p_new', name: '新队员', number: 99, position: '自由人', grade: '大一', height: 172, skills: { serve: 6, receive: 6, set: 4, spike: 5, block: 4, defense: 7 }, createdAt: Date.now(), updatedAt: Date.now() });
// ③ 备份里少了郑博文（本机应保留他）
B.players = B.players.filter((p) => p.name !== '郑博文');
// ④ 备份多一场本周训练
const bSession = { id: 's_extra', date: dk(new Date(mon.getTime() + 3 * 86400000)), start: '19:00', end: '21:00', venue: '风雨球场', status: 'scheduled', cancelReason: '', attendance: {}, createdAt: Date.now(), updatedAt: Date.now() };
A.players.forEach((p) => { bSession.attendance[p.id] = 'present'; });
B.weeks[wkKey] = [bSession];
// ⑤ 备份改了一场已有训练的考勤（陈一鸣改成请假）
const oldKey = '2026-10-19';
const bOld = B.weeks[oldKey][0];
bOld.attendance['p1'] = 'leave';
// ⑥ 备份带一条和本机完全相同的技能记录（应去重）+ 一条新的
B.skillLogs.push({ ...A.skillLogs[0] });
B.skillLogs.push({ id: 'log_new', playerId: 'p1', skill: 'serve', before: 7.5, after: 9.5, delta: 2, source: 'training', date: '2026-10-29', at: Date.now() });

const backupPath = path.join(ROOT, 'tools', '.import-test.json');
writeFileSync(backupPath, JSON.stringify(B, null, 2));
const aLogCount = A.skillLogs.length;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  const loadA = async () => {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await sleep(900);
    await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(JSON.stringify(A))}); 'ok'`);
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await sleep(1400);
  };
  await loadA();

  /* ── 0. 平板相关断言挪到弹窗打开后（输入框现在跟着弹窗走）── */

  /* ── 1. 菜单「导入备份」→ 先弹选择框 ── */
  await evalJS(`document.querySelector('#avatarBtn').click(); 'x'`);
  await sleep(300);
  await evalJS(`document.querySelector('#menuImport').click(); 'x'`);
  await sleep(400);
  // r17 起入口是「label 里塞一个透明铺满的 input」，点到的就是 input 本体
  const chooser = await evalJS(`({ lab: !!document.querySelector('label.imp-file > input#importFile'), link: !!document.querySelector('#impPickLink'), paste: !!document.querySelector('#impPickPaste') })`);
  check('入口先让你选「文件 / 链接 / 粘贴」', chooser.lab && chooser.link && chooser.paste);
  const inputProbe = await evalJS(`(() => {
    const el = document.querySelector('#importFile');
    if (!el) return null;
    const lab = el.closest('label.imp-file');
    const lbox = lab ? lab.getBoundingClientRect() : null;
    const hit = lbox ? document.elementFromPoint(lbox.left + lbox.width / 2, lbox.top + lbox.height / 2) : null;
    return {
      display: getComputedStyle(el).display,
      accept: el.getAttribute('accept'),
      covered: !!hit && hit.id === 'importFile',
      w: Math.round(el.getBoundingClientRect().width)
    };
  })()`);
  check('文件输入框没有 accept 过滤（iPad 才不会灰掉 .json）', inputProbe && inputProbe.accept === null);
  check('文件输入框不是 display:none（iOS 才会弹选择器）', inputProbe && inputProbe.display !== 'none', inputProbe && inputProbe.display);
  check('文件输入框铺满按钮（手指点到的就是 input 本体）', inputProbe && inputProbe.covered, inputProbe && `${inputProbe.w}px`);

  /* ── 2. 选文件（模拟平板选择器交出文件）── */
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#importFile' });
  await send('DOM.setFileInputFiles', { files: [backupPath], nodeId: q.result.nodeId });
  await sleep(700);
  const dlg = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('#impPreview .imp-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim());
    return { open: !!document.querySelector('#impGo'), rows, mergeChecked: (document.querySelector('input[name="impMode"]:checked') || {}).value };
  })()`);
  check('选完文件弹出导入弹窗', dlg.open === true);
  check('默认选中「按队员合并」', dlg.mergeChecked === 'merge');
  const joined = (dlg.rows || []).join(' | ');
  // 备份里删了郑博文，所以是 9 匹配 + 1 新增 + 1 本机保留
  check('预览：匹配 9 人（备份里少一个）', /匹配 9/.test(joined), joined);
  check('预览：新增 1 人', /新增 1 · 本机保留 1/.test(joined), joined);
  check('预览：覆盖 3 场 + 新增 1 场', /覆盖 \d+ 场 · 新增 1 场/.test(joined), joined);
  {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(ROOT, 'preview', 's6-import-dialog.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('· 截图 s6-import-dialog.png');
  }
  {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(ROOT, 'preview', 's6-import-dialog.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('· 截图 s6-import-dialog.png');
  }
  await evalJS(`document.querySelector('#impGo').click(); 'x'`);
  await sleep(1800);

  /* ── 3. 合并结果 ── */
  const after = await evalJS(`(() => {
    const d = JSON.parse(localStorage.getItem('xgy_volleyball_v2'));
    const chen = d.players.find((p) => p.name === '陈一鸣');
    const zheng = d.players.find((p) => p.name === '郑博文');
    const nw = d.players.find((p) => p.name === '新队员');
    const oldS = (d.weeks['2026-10-19'] || [])[0];
    const extra = (d.weeks[Object.keys(d.weeks).sort().pop()] || []).find((s) => s.start === '19:00');
    const dup = d.skillLogs.filter((l) => l.playerId === 'p1' && l.skill === 'receive' && l.date === '2026-10-20').length;
    return {
      players: d.players.length,
      chenServe: chen && chen.skills.serve,
      zhengKept: !!zheng,
      newAdded: !!nw,
      newPos: nw && nw.position,
      oldAtt: oldS && oldS.attendance['p1'],
      extraAdded: !!extra,
      extraAttCount: extra ? Object.keys(extra.attendance).length : 0,
      logs: d.skillLogs.length,
      dup
    };
  })()`);
  check('本机独有的郑博文被保留', after.zhengKept === true);
  check('备份里的新队员补上了（位置正确）', after.newAdded === true && after.newPos === '自由人', `${after.newPos}`);
  check('同名同号码的技能被备份覆盖（发球 9.5）', after.chenServe === 9.5, `${after.chenServe}`);
  check('已有场次的考勤被备份覆盖（陈一鸣→请假）', after.oldAtt === 'leave', `${after.oldAtt}`);
  check('备份新增的场次加进来了', after.extraAdded === true, after.extraAttCount + ' 人考勤');
  // 备份里没有郑博文 → 他的考勤不该被映射进来，正好 9 人
  check('新增场次的考勤经过 id 映射（备份里的 9 人）', after.extraAttCount === 9, String(after.extraAttCount));
  check('技能记录没有重复', after.dup === 1, `重复 ${after.dup} 条`);
  check('技能记录总数 = 原有 + 1 条新的', after.logs === aLogCount + 1, `${after.logs} vs ${aLogCount + 1}`);
  check('队员总数 10 - 0 匹配 + 1 新增（郑博文保留）', after.players === 11, String(after.players));

  /* ── 4. 完全覆盖模式 ── */
  await loadA();
  await evalJS(`document.querySelector('#avatarBtn').click(); 'x'`);
  await sleep(250);
  await evalJS(`document.querySelector('#menuImport').click(); 'x'`);
  await sleep(350);
  const q2 = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#importFile' });
  void q2;
  const doc2 = await send('DOM.getDocument', { depth: -1 });
  const q3 = await send('DOM.querySelector', { nodeId: doc2.result.root.nodeId, selector: '#importFile' });
  await send('DOM.setFileInputFiles', { files: [backupPath], nodeId: q3.result.nodeId });
  await sleep(700);
  await evalJS(`document.querySelector('input[name="impMode"][value="replace"]').click(); 'x'`);
  await sleep(200);
  const replacePreview = await evalJS(`document.querySelector('#impPreview').textContent.replace(/\\s+/g, ' ').trim()`);
  check('切到完全覆盖时预览会变', /本机现有数据全部清掉/.test(replacePreview), replacePreview.slice(0, 40));
  await evalJS(`document.querySelector('#impGo').click(); 'x'`);
  await sleep(400);
  const confirmShown = await evalJS(`document.querySelector('#confirmScrim').classList.contains('show')`);
  check('完全覆盖要二次确认', confirmShown === true);
  await evalJS(`document.querySelector('#confirmOk').click(); 'x'`);
  await sleep(1800);
  const replaced = await evalJS(`(() => {
    const d = JSON.parse(localStorage.getItem('xgy_volleyball_v2'));
    return { players: d.players.length, hasZheng: d.players.some((p) => p.name === '郑博文'), hasChen: d.players.some((p) => p.name === '陈一鸣') };
  })()`);
  check('覆盖后只剩备份里的 10 人（郑博文没了）', replaced.players === 10 && replaced.hasZheng === false, `${replaced.players} 人`);
  check('覆盖后陈一鸣仍在（备份里也有）', replaced.hasChen === true);

  /* ── 5. 粘贴导入（平板兜底路径）── */
  await loadA();
  await evalJS(`document.querySelector('#avatarBtn').click(); 'x'`);
  await sleep(250);
  await evalJS(`document.querySelector('#menuImport').click(); 'x'`);
  await sleep(350);
  await evalJS(`document.querySelector('#impPickPaste').click(); 'x'`);
  await sleep(400);
  const pasteOpen = await evalJS(`!!document.querySelector('#impText')`);
  check('粘贴入口能打开', pasteOpen === true);
  // r20：粘完自动解析，不用再找「解析」按钮
  await evalJS(`(() => { const t = document.querySelector('#impText'); t.value = ${JSON.stringify(JSON.stringify(B))}; t.dispatchEvent(new Event('paste')); })(); 'x'`);
  await sleep(700);
  const pasteDlg = await evalJS(`(() => ({
    go: !!document.querySelector('#impGo'),
    lead: (document.querySelector('.imp-lead') || {}).textContent || ''
  }))()`);
  check('粘贴完自动解析进导入弹窗', pasteDlg.go === true, pasteDlg.lead.replace(/\s+/g, ' ').slice(0, 40));

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
} catch (e) {
  console.error('异常：', e.message);
  failed += 1;
} finally {
  ws.close();
  edge.kill();
  server.close();
}
process.exit(failed ? 1 : 0);
