/**
 * 端到端测试：真浏览器（Edge headless）→ 真前端 → 真后端 → 真 SQLite。
 *
 * 覆盖三条最关键的用户路径（跑法：仓库根目录 `npm run e2e`）：
 *   1. 登录门禁：错密码被拦、对密码进云端模式
 *   2. 考勤登记：点击格子 → 刷新后仍在 → 数据确实落到了服务器
 *   3. 阵型板拖拽：松手 0.25m 吸附 → 位置落到服务器（云端推送）
 *
 * 架子：node:test（Node 20+ 内置，不引第二个测试框架）+ playwright-core
 * （Windows 复用系统 Edge；Linux/CI 用已安装的 Chromium 或 E2E_CHROME 指定）。
 * 后端用 tsx 起在系统临时目录的 DB 上，前端用极简静态服务器托管仓库根目录。
 */
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 端口每轮动态取空闲值：万一上一轮有残留进程没杀干净，也不会被这一轮误连
let PORT_HTTP, PORT_API, BASE_HTTP, BASE_API;
const DEMO = { username: 'demo', password: 'demo123456' };

/** 让内核分配一个当前空闲端口，取完立刻释放（只用于挑号，真正监听在后面） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp', // v65 起首屏三帧是 WebP，MIME 不对浏览器可能不走 onerror 回退
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml'
};

let frontServer, apiProc, tmpDir;
let browser, page;
let coachToken = '';

/* ── 环境起停 ── */

before(async () => {
  // 0. 先挑两个空闲端口（固定端口 + 残留进程 = 静默跑在旧库上，这个坑真踩过）
  PORT_HTTP = await freePort();
  do {
    PORT_API = await freePort();
  } while (PORT_API === PORT_HTTP);
  BASE_HTTP = `http://127.0.0.1:${PORT_HTTP}`;
  BASE_API = `http://127.0.0.1:${PORT_API}`;

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
  // 用系统临时目录：preview/ 被 .gitignore 忽略，CI checkout 后并不存在
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'xgy-e2e-db-'));
  const dbPath = path.join(tmpDir, 'e2e.db');
  const env = { ...process.env, DB_PATH: dbPath, PORT: String(PORT_API), JWT_SECRET: 'e2e-secret' };
  // 直接 node + tsx CLI，不用 `npx`/shell:true：Windows 下 shell 包一层后 kill 只杀到 cmd，
  // 真正跑 tsx 的 node 会残留占住端口，下一轮 health 就会连到上一轮的旧库
  const serverDir = path.join(ROOT, 'server');
  const tsxCli = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = (args) =>
    new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [tsxCli, ...args], { cwd: serverDir, env });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`tsx ${args}: ${out}`))));
    });
  await run(['src/seed.ts']);
  apiProc = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
    cwd: serverDir, env, stdio: 'ignore',
    detached: process.platform !== 'win32' // Linux 下成组，after() 才能连子进程一起杀
  });
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE_API}/api/health`);
      if (r.ok) { healthy = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(healthy, '后端 18s 内未就绪（启动失败或端口被占用）——不要静默连到残留进程');

  // 3. 浏览器：本机复用系统 Edge（不下载浏览器）；CI / Linux 用
  //    `npx playwright-core install chromium` 装到默认缓存，不传 executablePath 即可。
  //    也可用 E2E_CHROME 显式指定任意 Chromium 可执行文件。
  const winEdge = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ].find((p) => existsSync(p));
  const exe = process.env.E2E_CHROME || winEdge;
  browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
});

after(async () => {
  await browser?.close();
  // tsx CLI 会再 exec 一个 node 来加载 TS：只 kill 直接子进程会留下真正干活的那个
  if (apiProc?.pid) {
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(apiProc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      try { process.kill(-apiProc.pid, 'SIGTERM'); } catch {}
    }
    try { apiProc.kill(); } catch {}
  }
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
