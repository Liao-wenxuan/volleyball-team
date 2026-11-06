/**
 * 端到端测试：真浏览器（Edge headless）→ 真前端 → 真后端 → 真 SQLite。
 *
 * 覆盖三条最关键的用户路径（跑法：仓库根目录 `node e2e/e2e.mjs`）：
 *   1. 登录门禁：错密码被拦、对密码进云端模式
 *   2. 考勤登记：点击格子 → 刷新后仍在 → 数据确实落到了服务器
 *   3. 阵型板拖拽：松手 0.25m 吸附 → 位置落到服务器（云端推送）
 *
 * 架子：node:test（Node 20+ 内置，不引第二个测试框架）+ playwright-core（复用系统 Edge，
 * 不下载浏览器）。后端用 tsx 起在临时 DB 上，前端用极简静态服务器托管仓库根目录。
 */
import http from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_HTTP = 5588; // 前端
const PORT_API = 8799;  // 后端
const BASE_HTTP = `http://127.0.0.1:${PORT_HTTP}`;
const BASE_API = `http://127.0.0.1:${PORT_API}`;
const DEMO = { username: 'demo', password: 'demo123456' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml'
};

let frontServer, apiProc, tmpDir;
let browser, page;
let coachToken = '';

/* ── 环境起停 ── */

before(async () => {
  // 1. 静态托管前端（禁 sw.js：测试不需要离线缓存插进来）
  frontServer = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/sw.js') {
      res.writeHead(404);
      res.end('no sw');
      return;
    }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !existsSync(f)) {
      res.writeHead(404);
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(f));
  });
  await new Promise((r) => frontServer.listen(PORT_HTTP, '127.0.0.1', r));

  // 2. 临时库 + 种子 + 后端
  tmpDir = mkdtempSync(path.join(ROOT, 'preview', 'e2e-db-'));
  const dbPath = path.join(tmpDir, 'e2e.db');
  const env = { ...process.env, DB_PATH: dbPath, PORT: String(PORT_API), JWT_SECRET: 'e2e-secret' };
  const run = (args) =>
    new Promise((resolve, reject) => {
      const p = spawn('npx', ['tsx', ...args], { cwd: path.join(ROOT, 'server'), env, shell: true });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`tsx ${args}: ${out}`))));
    });
  await run(['src/seed.ts']);
  apiProc = spawn('npx', ['tsx', 'src/index.ts'], { cwd: path.join(ROOT, 'server'), env, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE_API}/api/health`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }

  // 3. 浏览器（系统 Edge，不下载 Chromium）
  const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const exe = existsSync(EDGE) ? EDGE : 'C:/Program Files/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
});

after(async () => {
  await browser?.close();
  apiProc?.kill();
  frontServer?.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

/* ── 工具 ── */

/** 在登录门禁里填服务器地址 + 账号密码并提交 */
async function login(base = BASE_API, username = DEMO.username, password = DEMO.password) {
  await page.goto(BASE_HTTP, { waitUntil: 'networkidle' });
  // 展开折叠的「服务器地址」
  await page.evaluate(() => {
    const d = document.querySelector('.gate-adv');
    if (d) d.open = true;
  });
  await page.fill('#gateForm input[name=base]', base);
  await page.fill('#gateForm input[name=username]', username);
  await page.fill('#gateForm input[name=password]', password);
  await page.click('#gateSubmit');
}

const gotoPage = async (name) => {
  await page.click(`.nav-item[data-page="${name}"]`);
  await page.waitForTimeout(400); // 等渲染（数据在内存，本地渲染很快）
};

/* ══════════ 测试 ══════════ */

test('E2E-1 登录门禁：错密码被拦，对密码进入云端模式', async () => {
  await page.goto(BASE_HTTP, { waitUntil: 'networkidle' });
  // 未登录 → 停在门禁
  assert.equal(await page.locator('#authGate').isVisible(), true, '未登录应停在登录门禁');

  // 错密码 → 门禁上显示错误，不放进去
  await login(BASE_API, DEMO.username, 'wrong-password');
  await page.waitForSelector('#gateErr:not([hidden])');
  assert.match(await page.textContent('#gateErr'), /用户名或密码不对/);
  assert.equal(await page.locator('#authGate').isVisible(), true, '错密码后仍应停在门禁');

  // 对密码 → 进应用，云端模式生效
  await login();
  await page.waitForSelector('html.gate-pass');
  await page.waitForSelector('body.cloud-on');
  assert.match(await page.textContent('#brandMode'), /CLOUD/, '顶栏应显示云端模式');

  // 存下 token 供后续用例与接口校验
  coachToken = await page.evaluate(() => localStorage.getItem('xgy_api_token'));
  assert.ok(coachToken, '登录后应拿到 token');
});

test('E2E-2 考勤登记：点击落格 → 刷新后仍在 → 服务器确有这条数据', async () => {
  await gotoPage('attendance');
  const cell = page.locator('.att-cell:not(.disabled)').first();
  await cell.waitFor();
  const before = await cell.getAttribute('class');
  assert.match(before, /unmarked/, '初始应为未登记');

  // 点击一次：未登记 → 出勤
  await cell.click();
  await page.waitForFunction(
    () => document.querySelector('.att-cell')?.classList.contains('present'),
    { timeout: 5000 }
  );
  assert.match(await cell.getAttribute('class'), /present/, '点击一次应变为出勤');

  // 刷新：token 还在 → 自动回登录态 → 数据从服务器拉回来
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body.cloud-on');
  await gotoPage('attendance');
  const cellAfter = page.locator('.att-cell.present').first();
  await cellAfter.waitFor();
  assert.ok(true, '刷新后出勤格仍存在');

  // 终极核对：直接问服务器（不经过前端）
  const weeks = await (await fetch(`${BASE_API}/api/weeks/all`, {
    headers: { Authorization: `Bearer ${coachToken}` }
  })).json();
  const allSessions = Object.values(weeks.weeks).flat();
  const marked = allSessions.filter((s) => Object.values(s.attendance).includes('present'));
  assert.ok(marked.length >= 1, '服务器上应至少有一条 present 考勤');
});

test('E2E-3 阵型板：拖拽松手按 0.25m 吸附，且推送到了服务器', async () => {
  await gotoPage('tactics');
  // 注意：棋子是 #fxCourt 里的 .fx-token[data-role]；
  // #fxRoles 里的 [data-pos] 只是侧栏图例文字，没有坐标样式
  const piece = page.locator('#fxCourt .fx-token[data-role="oh1"]');
  await piece.waitFor();

  const court = await page.locator('#fxCourt').boundingBox();
  const start = await piece.boundingBox();
  const startX = (parseFloat(await piece.evaluate((el) => el.style.left)) / 100) * 9;
  const startY = (parseFloat(await piece.evaluate((el) => el.style.top)) / 100) * 9;

  // 拖到场地中部偏右上的位置
  const grabX = start.x + start.width / 2;
  const grabY = start.y + start.height / 2;
  const dropX = court.x + court.width * 0.7;
  const dropY = court.y + court.height * 0.35;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600); // 松手 → 吸附 → save() → 云端推送

  // 断言 1：位置变了（先断言值是有效数字，别让 NaN 蒙混过关）
  const endX = (parseFloat(await piece.evaluate((el) => el.style.left)) / 100) * 9;
  const endY = (parseFloat(await piece.evaluate((el) => el.style.top)) / 100) * 9;
  assert.ok(Number.isFinite(endX) && Number.isFinite(endY), `拖拽后坐标应为数字，实际 x=${endX} y=${endY}`);
  assert.ok(
    Math.abs(endX - startX) > 0.01 || Math.abs(endY - startY) > 0.01,
    `拖拽后位置应发生变化（start ${startX},${startY} → end ${endX},${endY}）`
  );

  // 断言 2：吸附到 0.25m 网格（容差放宽到网格的 2%：坐标经 % 字符串换算有浮点误差）
  const TOL = 0.25 * 0.02;
  for (const [label, v] of [['x', endX], ['y', endY]]) {
    const remainder = Math.abs(v / 0.25 - Math.round(v / 0.25)) * 0.25;
    assert.ok(remainder < TOL, `${label}=${v} 应吸附在 0.25m 网格上（偏差 ${remainder.toFixed(6)}m）`);
  }

  // 断言 3：云端确有这份站位（拖拽触发 cloudPushFormation）
  const f = await (await fetch(`${BASE_API}/api/formation`, {
    headers: { Authorization: `Bearer ${coachToken}` }
  })).json();
  assert.equal(f.formation.preset, 'custom', '手动拖过应回落自定义');
  assert.ok(Math.abs(f.formation.pos.oh1.x - endX) < TOL, '服务器 x 应与页面一致');
  assert.ok(Math.abs(f.formation.pos.oh1.y - endY) < TOL, '服务器 y 应与页面一致');
});
