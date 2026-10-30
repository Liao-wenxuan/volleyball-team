// 端到端验证：队员端请假回执 → 队长端解析 → 考勤真的写成「请假」
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 5540;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-rcpt');
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

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9226', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9226/json/list')).json(); if (list.length) break; } catch { /* retry */ }
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

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const seedRaw = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');
  const seed = JSON.parse(seedRaw);
  const p0 = seed.players[0];

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1000);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seedRaw)}); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1600);

  /* ── 分享载荷里必须带上「接下来几次训练」 ── */
  const payload = await evalJS(`(() => {
    const p = document.querySelector('#menuShare');
    p.click();
    return null;
  })()`);
  await sleep(800);
  const link = await evalJS(`document.querySelector('#shareLink').value`);
  check('生成分享链接', typeof link === 'string' && link.includes('#share='), `${link ? link.length : 0} 字符`);

  /* ── 队员端：进门 → 看到请假区块 ── */
  await evalJS(`document.querySelector('#shareClose').click(); 'x'`);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  // 上次运行可能在本机记住了「陈一鸣」，会直接进档案跳过进门——先清掉，测进门流程
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await evalJS(`['xgy_share_self','xgy_share_name'].forEach((k) => localStorage.removeItem(k)); 'ok'`);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: link });
  await sleep(1500);
  await evalJS(`document.querySelector('#svName').value=${JSON.stringify(p0.name)}; document.querySelector('#svNo').value=${JSON.stringify(String(p0.number))}; document.querySelector('#svForm').requestSubmit(); 'x'`);
  await sleep(800);

  const leaveSec = await evalJS(`!!document.querySelector('#svLeave')`);
  check('档案页有请假区块', leaveSec === true);
  const opts = await evalJS(`document.querySelectorAll('.sv-leave-opt').length`);
  check('列出了接下来几次训练', opts > 0, `${opts} 次`);
  const firstOptText = await evalJS(`(document.querySelector('.sv-leave-opt')||{}).textContent||''`);
  console.log('  第一次可请假训练：', firstOptText.replace(/\s+/g, ' ').trim());

  const disabledAtStart = await evalJS(`document.querySelector('.sv-make').disabled`);
  check('没选训练和原因时按钮禁用', disabledAtStart === true);

  /* ── 选一次 + 一个原因 → 生成回执 ── */
  await evalJS(`document.querySelectorAll('.sv-leave-opt')[0].click(); document.querySelectorAll('.sv-reason')[0].click(); 'x'`);
  await sleep(200);
  const enabledNow = await evalJS(`document.querySelector('.sv-make').disabled`);
  check('选完两项后按钮可用', enabledNow === false);
  await evalJS(`document.querySelector('.sv-make').click(); 'x'`);
  await sleep(400);
  const code = await evalJS(`(document.querySelector('.sv-rcpt-code')||{}).textContent||''`);
  const codeOk = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code.trim());
  check('生成了 12 位回执码', codeOk, code.trim());
  const rcptVisible = await evalJS(`!document.querySelector('.sv-rcpt').hidden`);
  check('回执面板展开', rcptVisible === true);
  await shot('s4-leave-receipt.png');

  /* ── 回执码本身：解出来必须就是这个人 / 这次 / 这个原因 ── */
  const decoded = await evalJS(`window.XGYShare.decodeReceipt(${JSON.stringify(code)})`);
  const fpMine = await evalJS(`window.XGYShare.fpOf(${JSON.stringify(p0.name)}, ${p0.number})`);
  check('回执码解出正确指纹', decoded && decoded.fp === fpMine, `${decoded && decoded.fp} vs ${fpMine}`);
  check('回执码带日期和时间', !!(decoded && /^\d{4}-\d{2}-\d{2}$/.test(decoded.date) && /^\d{2}:\d{2}$/.test(decoded.start)), `${decoded && decoded.date} ${decoded && decoded.start}`);
  check('回执码带原因', !!(decoded && decoded.reasonText), decoded && decoded.reasonText);
  const rcDate = decoded.date;
  const rcStart = decoded.start;

  /* ── 篡改一位 → 必须报校验错 ── */
  const badCode = code.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const badRes = await evalJS(`(() => { try { window.XGYShare.decodeReceipt(${JSON.stringify(badCode)}); return 'no-throw'; } catch (e) { return e.message; } })()`);
  check('改一位就报校验失败', badRes !== 'no-throw', String(badRes));

  /* ── 队长端：粘贴码 → 预览 → 一键登记 ── */
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1500);
  await evalJS(`document.querySelector('.nav-item[data-page="attendance"]').click(); 'x'`);
  await sleep(500);
  const hasBtn = await evalJS(`!!document.querySelector('#attRcptBtn')`);
  check('考勤页有「回执」按钮', hasBtn === true);
  await evalJS(`document.querySelector('#attRcptBtn').click(); 'x'`);
  await sleep(400);
  const layoutProbe = await evalJS(`(() => {
    const m = document.querySelector('#modalScrim .modal');
    const r = m.getBoundingClientRect();
    return { vw: window.innerWidth, x: Math.round(r.x), w: Math.round(r.width), scrollW: document.documentElement.scrollWidth };
  })()`);
  console.log('· 布局量测', JSON.stringify(layoutProbe));
  check('弹窗不超出屏幕', layoutProbe.vw >= layoutProbe.x + layoutProbe.w && layoutProbe.scrollW <= layoutProbe.vw, JSON.stringify(layoutProbe));
  await evalJS(`(() => {
    const ta = document.querySelector('#rcptInput');
    ta.value = '【请假回执】${p0.name} #${p0.number}\\n原因：生病\\n回执码：' + ${JSON.stringify(code)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  const whoText = await evalJS(`(document.querySelector('.rcpt-who')||{}).textContent||''`);
  check('整段消息粘贴后认出是谁', whoText.includes(p0.name), whoText.replace(/\s+/g, ' ').trim());
  const factsText = await evalJS(`(document.querySelector('.rcpt-facts')||{}).textContent||''`);
  check('预览带日期、原因、当前状态', /哪一次/.test(factsText) && /原因/.test(factsText) && /当前/.test(factsText), factsText.replace(/\s+/g, ' ').trim());
  const applyable = await evalJS(`document.querySelector('#rcptApply').disabled`);
  check('可以点「登记为请假」', applyable === false);
  await shot('s4-receipt-modal.png');

  await evalJS(`document.querySelector('#rcptApply').click(); 'x'`);
  await sleep(900);

  const stored = await evalJS(`(() => {
    const d = JSON.parse(localStorage.getItem('xgy_volleyball_v2'));
    const out = [];
    Object.keys(d.weeks).forEach((k) => (d.weeks[k] || []).forEach((s) => {
      if (s.date === ${JSON.stringify(rcDate)} && s.attendance && s.attendance[${JSON.stringify(p0.id)}]) {
        out.push({ date: s.date, start: s.start, st: s.attendance[${JSON.stringify(p0.id)}] });
      }
    }));
    return out;
  })()`);
  const hit = (stored || []).find((x) => x.date === rcDate);
  check('考勤真的写成「请假」', !!hit && hit.st === 'leave', hit ? `${hit.date} ${hit.start} → ${hit.st}` : '没找到记录');
  check('正是回执里那一场', !!hit && hit.start === rcStart, `${rcStart} vs ${hit && hit.start}`);
  const cellText = await evalJS(`(() => {
    const c = Array.from(document.querySelectorAll('.att-cell')).find((el) => el.dataset.player === ${JSON.stringify(p0.id)} && el.textContent.includes('请假'));
    return c ? c.className : '';
  })()`);
  check('表格里格子显示「请假」', /leave/.test(cellText), cellText);
  await shot('s4-att-after.png');

  /* ── 回执链接：#rcpt= 直接弹确认 ── */
  const urlCode = code.replace(/-/g, '');
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#rcpt=${urlCode}` });
  await sleep(1800);
  const modalOpen = await evalJS(`document.querySelector('#modalScrim').classList.contains('show')`);
  check('回执链接直接弹确认框', modalOpen === true);
  const prefilled = await evalJS(`document.querySelector('#rcptInput').value`);
  check('链接里的码已填好', prefilled.replace(/-/g, '').length >= 12, prefilled);
  const hashCleared = await evalJS(`location.hash`);
  check('打开后清掉 hash（刷新不会再弹）', hashCleared === '');
  await shot('s4-receipt-link.png');

  /* ── 乱码必须明确报错，不能瞎登记 ── */
  await evalJS(`(() => {
    const ta = document.querySelector('#rcptInput');
    ta.value = 'hello world';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const badMsg = await evalJS(`(document.querySelector('.rcpt-card.is-bad')||{}).textContent||''`);
  const badDisabled = await evalJS(`document.querySelector('#rcptApply').disabled`);
  check('乱码给出明确提示', badMsg.length > 0, badMsg.replace(/\s+/g, ' ').trim().slice(0, 40));
  check('乱码时不能点登记', badDisabled === true);

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
} catch (e) {
  console.error('运行出错:', e.message);
  failed += 1;
} finally {
  ws.close();
  edge.kill();
  server.close();
  process.exit(failed ? 1 : 0);
}
