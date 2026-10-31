// 端到端验证：队员端「姓名 + 号码」验证 → 我的档案（出勤/进步/六维/点评）
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const jsQR = require_('jsqr');
const { PNG } = require_('pngjs');

const ROOT = process.cwd();
const PORT = 5539;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROF = path.join(ROOT, 'preview', 'edgeprof-share2');
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

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9225', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch('http://127.0.0.1:9225/json/list')).json(); if (list.length) break; } catch { /* retry */ }
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

let failed = 0;
const check = (label, cond, extra) => { if (!cond) failed += 1; ok(label, cond, extra); };

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const seedRaw = readFileSync(path.join(ROOT, 'tools', '.seed-demo.json'), 'utf8');
  const seed = JSON.parse(seedRaw);
  const p0 = seed.players[0];
  const p1 = seed.players[1];

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await evalJS(`localStorage.setItem('xgy_volleyball_v2', ${JSON.stringify(seedRaw)}); 'ok'`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1600);

  /* ── 管理端：签到板块确实没了 ── */
  const navs = await evalJS(`Array.from(document.querySelectorAll('.nav-item')).map(e=>e.dataset.page).join(',')`);
  check('侧栏没有 checkin', !navs.includes('checkin'), navs);
  const hasCheckinPage = await evalJS(`!!document.querySelector('#page-checkin')`);
  check('签到页 DOM 已移除', hasCheckinPage === false);
  const cardBtn = await evalJS(`!!document.querySelector('#attCardBtn')`);
  check('考勤页有训练卡按钮', cardBtn === true);

  /* ── 队长端：生成分享链接 ── */
  await evalJS(`document.querySelector('#menuShare').click(); 'x'`);
  await sleep(700);
  const link = await evalJS(`document.querySelector('#shareLink').value`);
  check('生成分享链接', typeof link === 'string' && link.includes('#share='), `${link ? link.length : 0} 字符`);
  /* ── 二维码：画对了没、能不能解回同一条链接 ── */
  const qrStat = await evalJS(`(() => {
    const cv = document.querySelector('#shareQr');
    if (!cv) return { err: 'canvas 不存在' };
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark += 1;
    return { w: cv.width, h: cv.height, dark, total: cv.width * cv.height,
             cssW: Math.round(cv.getBoundingClientRect().width),
             tips: (document.querySelector('#shareQrTips') || {}).textContent || '' };
  })()`);
  check('二维码已画到 canvas', qrStat && qrStat.w > 0 && qrStat.dark > 0,
    qrStat ? `${qrStat.w}×${qrStat.h}，屏幕显示 ${qrStat.cssW}px，深色 ${(qrStat.dark / qrStat.total * 100).toFixed(1)}%，${qrStat.tips}` : String(qrStat && qrStat.err));

  // 用 jsQR（真解码器）扫画布像素：画出来东西必须真能被扫出来，且解回同一条链接
  const scan = async (label, targetPx, expect) => {
    const dataUrl = await evalJS(`(() => {
      const cv = document.querySelector('#shareQr');
      if (!cv) return '';
      const target = ${targetPx ? 'Math.round(cv.getBoundingClientRect().width)' : 'cv.width'};
      const c2 = document.createElement('canvas');
      c2.width = target; c2.height = target;
      const ctx = c2.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target, target);
      ctx.drawImage(cv, 0, 0, target, target);
      return c2.toDataURL('image/png');
    })()`);
    if (!dataUrl) return { label, ok: false, why: 'canvas 不存在' };
    const img = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
    const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    const want = expect || link;
    return { label, ok: !!res && res.data === want, got: res ? res.data : '', px: img.width };
  };

  const scans = [];
  scans.push(await scan('原始画布', false));
  scans.push(await scan('缩到屏幕显示尺寸', true));
  for (const r of scans) {
    check(`实扫解码 · ${r.label}`, r.ok,
      r.ok ? `内容与链接一致（${r.px}px）` : `解不出或内容不符${r.got ? '：' + r.got.slice(0, 40) : ''}`);
  }

  const aiBox = await evalJS(`(document.querySelector('.share-ai')||{}).className||''`);
  const hasAiBtn = await evalJS(`!!document.querySelector('#shareAi')`);
  check('分享弹窗有生成点评入口', aiBox.includes('share-ai'), hasAiBtn ? 'AI 按钮（seed 带假 Key）' : '模板提示');
  await shot('s2-share-modal.png');

  /* ── 队员端：打开链接第一条 ── */
  await evalJS(`document.querySelector('#shareClose').click(); 'x'`);
  await sleep(300);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await send('Page.navigate', { url: link });
  await sleep(1500);

  const gate = await evalJS(`!!document.querySelector('#svForm')`);
  check('打开链接先出验证表单', gate === true);
  const noNameList = await evalJS(`!!document.querySelector('.sv-pick')`);
  check('页面不摊全队名单', noNameList === false);
  await shot('s2-gate.png');

  /* 错误号码 */
  await evalJS(`document.querySelector('#svName').value=${JSON.stringify(p0.name)}; document.querySelector('#svNo').value='999'; document.querySelector('#svForm').requestSubmit(); 'x'`);
  await sleep(400);
  const errShown = await evalJS(`!document.querySelector('#svErr').hidden`);
  check('号码错 → 提示且不放行', errShown === true);
  await shot('s2-gate-error.png');

  /* 正确姓名 + 号码 */
  await evalJS(`document.querySelector('#svNo').value=${JSON.stringify(String(p0.number))}; document.querySelector('#svForm').requestSubmit(); 'x'`);
  await sleep(900);
  const selfTitle = await evalJS(`(document.querySelector('.sv-h1')||{}).textContent||''`);
  check('验证通过 → 进入本人档案', selfTitle.includes(p0.name), selfTitle.replace(/\s+/g, ' '));
  const gain = await evalJS(`(document.querySelector('.sv-gain-grid')||{}).children.length||0`);
  check('六项进步格子', gain === 6, `${gain} 格`);
  const gainHead = await evalJS(`(document.querySelectorAll('.sv-sec h2')[0]||{}).textContent||''`);
  check('进步总分有数字', /\d/.test(gainHead), gainHead);
  const radar = await evalJS(`document.querySelectorAll('.sv-radar-poly').length`);
  check('雷达图渲染', radar === 1);
  const weakTxt = await evalJS(`(document.querySelector('.sv-weak')||{}).textContent||''`);
  check('标出最弱项', /(凹进去|最该)/.test(weakTxt), weakTxt.trim());
  const noteTxt = await evalJS(`(document.querySelector('.sv-tipcard p')||{}).textContent||''`);
  check('有建议和鼓励', noteTxt.length > 20, `${noteTxt.length} 字`);
  console.log('  点评：', noteTxt);
  const tl = await evalJS(`document.querySelectorAll('.sv-tl-row').length`);
  check('最近训练时间线', tl > 0, `${tl} 行`);
  await shot('s2-self.png');

  /* 换人 */
  await evalJS(`document.querySelector('#svSwitch').click(); 'x'`);
  await sleep(500);
  const backGate = await evalJS(`!!document.querySelector('#svForm')`);
  check('换个人回到验证页', backGate === true);

  /* 第二个人能进 */
  await evalJS(`document.querySelector('#svName').value=${JSON.stringify(p1.name)}; document.querySelector('#svNo').value=${JSON.stringify(String(p1.number))}; document.querySelector('#svForm').requestSubmit(); 'x'`);
  await sleep(700);
  const t2 = await evalJS(`(document.querySelector('.sv-h1')||{}).textContent||''`);
  check('另一名队员也能验证通过', t2.includes(p1.name), t2.replace(/\s+/g, ' '));

  /* ── 带 AI 点评的版本：链接会变长，确认码还能解 ── */
  await evalJS(`(() => {
    const raw = localStorage.getItem('xgy_volleyball_v2');
    const d = JSON.parse(raw);
    d.shareNotes = {};
    d.players.forEach((p, i) => {
      d.shareNotes[p.id] = ('你一传从 6.0 涨到 7.0，这 1 分是自己练出来的。现在最该补的是二传，网前定点传球 100 次，重点练手腕弹送。' + '这是第' + (i + 1) + '个人的点评。');
    });
    localStorage.setItem('xgy_volleyball_v2', JSON.stringify(d));
    return 'ok';
  })()`);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1600);
  await evalJS(`document.querySelector('#menuShare').click(); 'x'`);
  await sleep(1800);
  const link2 = await evalJS(`document.querySelector('#shareLink').value`);
  const tips2 = await evalJS(`(document.querySelector('#shareQrTips')||{}).textContent||''`);
  check('带 AI 点评的链接', typeof link2 === 'string' && link2.includes('#share='), `${link2 ? link2.length : 0} 字符`);
  check('二维码提示文案跟着变', tips2.length > 0, tips2);
  const ai = await scan('AI 点评版原图', false, link2);
  check('AI 点评版二维码可解', ai.ok, ai.ok ? `内容一致（${ai.px}px）` : '解不出');
  const saveBtn = await evalJS(`!!document.querySelector('#shareQrSave')`);
  check('有「保存二维码图片」按钮', saveBtn === true);
  await shot('s3-share-ai.png');

  /* ── 老格式链接（v1 JSON）必须还能打开 ── */
  const legacyPath = path.join(ROOT, 'preview', 'demo-link.txt');
  if (existsSync(legacyPath)) {
    const legacy = readFileSync(legacyPath, 'utf8').trim();
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await send('Page.navigate', { url: legacy });
    await sleep(2600);
    let legacyState = await evalJS(`({
      gate: !!document.querySelector('#svForm'),
      txt: ((document.querySelector('#shareView') || document.body).innerText || '').replace(/\\s+/g, ' ').slice(0, 120)
    })`);
    if (!legacyState.gate && !legacyState.txt) { await sleep(1600); legacyState = await evalJS(`({
      gate: !!document.querySelector('#svForm'),
      txt: ((document.querySelector('#shareView') || document.body).innerText || '').replace(/\\s+/g, ' ').slice(0, 120)
    })`); }
    // 进门可能是验证页，也可能因为本机记着「上次验证过的本人」直接进档案——两种都算解开了老格式
    check('老格式链接还能打开（验证页 / 直接进本人档案）',
      legacyState.gate === true || /出勤|涨了/.test(legacyState.txt),
      legacyState.gate ? '验证页' : legacyState.txt.slice(0, 60));
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
  }

  /* 桌面宽度 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(path.join(SHOTS, 's2-self-full.png'), Buffer.from(r.result.data, 'base64'));
  console.log('· 截图 s2-self-full.png（整页）');

  if (!failed) writeFileSync(path.join(SHOTS, 'demo-link.txt'), link, 'utf8');
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
