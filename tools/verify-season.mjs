// 端到端验证：阵容完整度面板 + 赛季卡（canvas 出图）
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5542;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-season');
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

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9229', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9229/json/list')).json(); if (list.length) break; } catch { /* retry */ }
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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  console.log('· 截图', name);
}

let failed = 0;
const check = (label, cond, extra) => {
  if (!cond) failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
};

/* ── Node 侧按同样的规则算期望值（本周） ── */
const seed = JSON.parse(readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8'));
const pad2 = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monday0 = new Date();
monday0.setHours(12, 0, 0, 0);
monday0.setDate(monday0.getDate() - ((monday0.getDay() + 6) % 7));
const wkKey = dk(monday0);
const POSITIONS = ['主攻', '副攻', '二传', '接应', '自由人'];

// 种子只有到上周的周，往「本周」注入两场训练：
// 到场 = 主攻/二传/自由人，缺席 = 副攻/接应 → 期望缺 [副攻, 接应]
if (!Array.isArray(seed.weeks[wkKey]) || !seed.weeks[wkKey].length) {
  const mk = (offset, start, end, venue) => {
    const d = new Date(monday0);
    d.setDate(d.getDate() + offset);
    const att = {};
    seed.players.forEach((p) => {
      att[p.id] = ['主攻', '二传', '自由人'].includes(p.position) ? 'present' : 'absent';
    });
    return { id: `t${offset}`, date: dk(d), start, end, venue, status: 'ok', attendance: att, createdAt: Date.now(), updatedAt: Date.now() };
  };
  seed.weeks[wkKey] = [mk(1, '16:30', '18:30', '气排球馆'), mk(4, '16:30', '18:30', '气排球馆')];
}
const wkSessions = (seed.weeks[wkKey] || []).filter((s) => s.status !== 'cancelled');
const camePos = new Set();
wkSessions.forEach((s) => seed.players.forEach((p) => {
  const st = (s.attendance || {})[p.id];
  if (st === 'present' || st === 'late') camePos.add(p.position);
}));
const expOn = POSITIONS.filter((x) => camePos.has(x));
const expMissing = POSITIONS.filter((x) => !camePos.has(x));
console.log(`· 期望（本周 ${wkKey}）：到场位置 [${expOn.join('/')}] 缺 [${expMissing.join('/')}]`);

try {
  await send('Page.enable');
  await send('Runtime.enable');

  const seedRaw = JSON.stringify(seed);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1000);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seedRaw)}); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1600);

  /* ── 考勤页：阵容完整度面板 ── */
  await evalJS(`document.querySelector('.nav-item[data-page="attendance"]').click(); 'x'`);
  await sleep(600);

  const chips = await evalJS(`[...document.querySelectorAll('#lineupGrid .lu-chip')].map((c) => ({ cls: c.className, txt: c.textContent.trim() }))`);
  check('面板有 5 个位置标签', chips.length === 5, chips.map((c) => c.txt.replace(/\s+/g, '')).join(' '));
  const clean = (t) => t.replace(/[✓✕]/g, '').trim();
  const uiOn = chips.filter((c) => c.cls.includes('on') && !c.cls.includes('off')).map((c) => clean(c.txt));
  const uiMissing = chips.filter((c) => c.cls.includes('off')).map((c) => clean(c.txt));
  check('到场位置与期望一致', JSON.stringify(uiOn.sort()) === JSON.stringify(expOn.slice().sort()), `[${uiOn.join('/')}]`);
  check('缺席位置与期望一致', JSON.stringify(uiMissing.sort()) === JSON.stringify(expMissing.slice().sort()), `[${uiMissing.join('/')}]`);

  const noteText = await evalJS(`(document.querySelector('#lineupNote')||{}).textContent||''`);
  if (expMissing.length) {
    check('缺位输出了可执行结论', expMissing.every((x) => noteText.includes(`缺${x}`)) && noteText.includes('练不了'), noteText.replace(/\s+/g, ' ').slice(0, 60));
  } else {
    check('位置全齐给出正反馈', noteText.includes('位置都到过'), noteText.trim().slice(0, 40));
  }

  /* ── 赛季卡 ── */
  const hasBtn = await evalJS(`!!document.querySelector('#attSeasonBtn')`);
  check('考勤页有「赛季卡」按钮', hasBtn === true);
  await evalJS(`document.querySelector('#attSeasonBtn').click(); 'x'`);
  await sleep(1200);
  const modalOpen = await evalJS(`!!document.querySelector('#modalScrim.show .modal img.card-preview')`);
  check('赛季卡弹窗打开并有预览图', modalOpen === true);
  const img = await evalJS(`(() => {
    const el = document.querySelector('.modal img.card-preview');
    if (!el) return null;
    return { prefix: el.src.slice(0, 22), len: el.src.length, w: el.naturalWidth, h: el.naturalHeight };
  })()`);
  check('预览是合法 PNG', img && img.prefix === 'data:image/png;base64,', img && `${img.w}x${img.h}`);
  check('出图尺寸 750×1334', img && img.w === 750 && img.h === 1334);
  check('出图不是空白（体积够大）', img && img.len > 60000, `${Math.round(img.len / 1024)}KB base64`);
  await shot('s5-season-card.png');

  /* ── 空队状态：清数据后面板不炸 ── */
  await evalJS(`document.querySelector('#modalScrim .modal-close')?.click(); 'x'`);
  await sleep(300);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', JSON.stringify({version:2,settings:{},players:[],weeks:{},skillLogs:[],formation:null,formations:[],aiChat:[],shareNotes:{}})); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1400);
  await evalJS(`document.querySelector('.nav-item[data-page="attendance"]').click(); 'x'`);
  await sleep(500);
  const emptyOk = await evalJS(`(() => ({
    bodyHidden: document.querySelector('#attBody') === null ? null : document.querySelector('#attBody').hidden,
    noPlayers: !!document.querySelector('#attNoPlayers') && document.querySelector('#attNoPlayers').hidden === false
  }))()`);
  check('空数据走「先添加队员」引导且不炸', emptyOk.bodyHidden === true && emptyOk.noPlayers === true, JSON.stringify(emptyOk));

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
