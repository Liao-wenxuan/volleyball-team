#!/usr/bin/env node
/**
 * Cloudflare 接入预检 / 复检脚本。
 *
 * 用途：在改 NS 之前、之后各跑一次，用事实代替肉眼判断。
 *   node tools/cf-precheck.mjs            # 现状快照（改 NS 前跑这个）
 *   node tools/cf-precheck.mjs --verify   # 接入后验收（改 NS 后跑这个）
 *
 * 依赖：只需要 Node 内置模块，不装任何东西。
 *
 * 为什么值得单独写一个脚本：
 *   DNS 迁移的失败模式是「看起来成功了但其实只生效了一半」——
 *   NS 换了但记录没补全、橙云灰云点反了、sw.js 被缓存了。
 *   这些光看控制台面板容易漏，必须用命令把状态钉死。
 */
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import net from 'node:net';

/** 迁移前后的关键事实都写在这里，改域名时改这一处就够 */
const DOMAIN = 'bscjs.top';
const SERVER_IP = '47.84.52.175';
const CLOUDFLARE_NS_HINT = 'ns.cloudflare.com';

/**
 * 三个生产子域。proxy=true 表示期望走 CDN（橙云），false 表示直连（灰云）。
 * 加子域时改这里。
 */
const HOSTS = [
  { host: 'vb.bscjs.top', proxy: true, note: '排球队管理系统（本次要修的）' },
  { host: 'csp.bscjs.top', proxy: false, note: 'content-sharing-platform（保持直连）' },
  { host: 'vigil.bscjs.top', proxy: false, note: 'Vigil 监控面板（保持直连）' }
];

const VERIFY = process.argv.includes('--verify');

/** 跑 nslookup 并解析出结果。拿不到就返回 null（不猜、不假装成功）。 */
function nslookup(domain, type, server) {
  try {
    const args = server ? ['-type=' + type, domain, server] : ['-type=' + type, domain];
    // nslookup 把 "Non-authoritative answer" 之类写 stderr，会混进输出 —— 丢掉它
    const out = execFileSync('nslookup', args, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out;
  } catch {
    return null;
  }
}

/**
 * 从 nslookup 输出里抽出 A 记录地址。
 * 输出格式（实测）：
 *   Server:  UnKnown
 *   Address:  10.4.252.22          ← 本机 DNS 服务器地址，排在 Name 之前
 *
 *   Name:    vb.bscjs.top
 *   Address:  47.84.52.175         ← 真正的 A 记录
 *
 * 规则：只取第一个 Name 行之后的 Address。Name 之前的是 DNS 服务器自己。
 */
function extractAddrs(out) {
  if (!out) return [];
  const lines = out.split(/\r?\n/).map(l => l.trim());
  const addrs = [];
  let seenName = false;
  for (const line of lines) {
    if (/^Name:/.test(line)) { seenName = true; continue; }
    if (!seenName) continue;
    const m = line.match(/^Address:\s+([0-9.]+)\s*$/);
    if (m && !addrs.includes(m[1])) addrs.push(m[1]);
  }
  return [...new Set(addrs)];
}

/** 从 nslookup 输出里抽 nameserver 名字。 */
function extractNS(out) {
  if (!out) return [];
  return [...out.matchAll(/nameserver = (\S+)/g)].map(m => m[1]);
}

/** 从 nslookup 输出里抽「本机/被查询 DNS 服务器的 IP」——用来从 A 记录里剔除。 */
function extractServerAddrs(out) {
  if (!out) return [];
  const addrs = [];
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (/^Address:/.test(t)) {
      const m = t.match(/^Address:\s+([0-9.]+)\s*$/);
      if (m) addrs.push(m[1]);
    }
  }
  return [...new Set(addrs)];
}

/**
 * HTTPS GET，返回状态码与响应头（只取需要的）。
 *
 * 关键：Node 的 https.request 不认 HTTPS_PROXY 环境变量，而某些跨境链路
 * 【必须走系统代理】才能出网（curl 会自动认，Node 不会，于是 curl 200 / Node 超时）。
 * 所以这里显式支持代理：有 HTTPS_PROXY 时先 CONNECT 隧道 + tls.connect，否则直连。
 */
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';

function httpsGetDirect(host, path) {
  return new Promise((resolve) => {
    const req = https.request(
      { host, port: 443, path, method: 'GET', servername: host, timeout: 12000 },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, headers: {}, error: e.message }));
    req.end();
  });
}

function httpsGetViaProxy(host, path) {
  return new Promise((resolve) => {
    const u = new URL(PROXY);
    const fail = (e) => resolve({ status: 0, headers: {}, error: e.message });
    const connectReq = http.request({
      host: u.hostname,
      port: Number(u.port) || 80,
      method: 'CONNECT',
      path: `${host}:443`,
      timeout: 12000
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return fail(new Error('proxy CONNECT ' + res.statusCode)); }
      const tlsSock = tls.connect({ socket, servername: host }, () => {
        tlsSock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      tlsSock.on('data', (d) => {
        buf += d.toString('utf8');
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.slice(0, end);
        const first = head.split('\r\n')[0] || '';
        const m = first.match(/HTTP\/[\d.]+ (\d{3})/);
        const headers = {};
        head.split('\r\n').slice(1).forEach((l) => {
          const i = l.indexOf(':');
          if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
        });
        resolve({ status: m ? Number(m[1]) : 0, headers });
        tlsSock.destroy();
      });
      tlsSock.on('error', fail);
      tlsSock.setTimeout(12000, () => { tlsSock.destroy(); fail(new Error('timeout')); });
    });
    connectReq.on('timeout', () => { connectReq.destroy(); resolve({ status: 0, headers: {}, error: 'timeout' }); });
    connectReq.on('error', fail);
    connectReq.end();
  });
}

function httpsGet(host, path = '/') {
  return PROXY ? httpsGetViaProxy(host, path) : httpsGetDirect(host, path);
}

function line(s = '') { console.log(s); }
function ok(s) { line('  [OK]   ' + s); }
function bad(s) { line('  [WARN] ' + s); }
function info(s) { line('  [INFO] ' + s); }

async function main() {
  line('');
  line('='.repeat(70));
  line(' Cloudflare 接入' + (VERIFY ? '复检' : '预检') + ' · ' + DOMAIN);
  line('='.repeat(70));

  // ── 1. NS 现状 ──────────────────────────────────────────────
  line('');
  line('[1] 权威 NS');
  const nsOut = nslookup(DOMAIN, 'NS');
  const ns = extractNS(nsOut);
  if (!ns.length) {
    bad('查不到 NS（可能是本机 DNS 限制）——换台机器或用 nslookup -type=NS ' + DOMAIN + ' dns25.hichina.com');
  } else {
    ns.forEach(n => line('       ' + n));
    const onCF = ns.some(n => n.includes(CLOUDFLARE_NS_HINT));
    if (VERIFY) {
      onCF ? ok('NS 已指向 Cloudflare') : bad('NS 仍是 ' + ns[0] + '，尚未切到 Cloudflare');
    } else {
      onCF ? info('已经在 Cloudflare 上了（如果这是预期，说明你已改过 NS）')
           : info('当前仍是阿里云 NS —— 这是迁移前的正常状态');
    }
  }

  // ── 2. 各子域解析 ──────────────────────────────────────────
  line('');
  line('[2] 子域解析');
  for (const h of HOSTS) {
    const out = nslookup(h.host, 'A');
    const serverAddrs = extractServerAddrs(out);
    const addrs = extractAddrs(out, serverAddrs);
    if (!addrs.length) {
      bad(h.host + ' 查不到 A 记录');
      continue;
    }
    const hit = addrs.includes(SERVER_IP);
    line('  ' + h.host.padEnd(22) + addrs.join(', '));
    if (hit) ok('  → 指向源站 ' + SERVER_IP + '（' + h.note + '）');
    else info('  → 非源站 IP：走 CDN 时解析到 Cloudflare 边缘 IP 属正常');
  }

  // ── 3. HTTPS 实测 ──────────────────────────────────────────
  line('');
  line('[3] HTTPS 实测（每个子域 1 次）');
  for (const h of HOSTS) {
    const r = await httpsGet(h.host, '/api/health');
    const cf = r.headers['server'] === 'cloudflare' || !!r.headers['cf-ray'];
    const via = r.headers['via'] ? ' via=' + r.headers['via'] : '';
    const status = r.status ? r.status + via : 'ERR ' + (r.error || '?');
    line('  ' + h.host.padEnd(22) + String(status).padEnd(28) + (cf ? ' [Cloudflare]' : ''));
    if (VERIFY) {
      // 401/403 是「服务要求登录」，说明服务是活的，不是故障 —— 只在完全连不上时报警。
      // （vigil 的面板要 token，/api/health 会返回 401，这是预期行为。）
      const reachable = r.status > 0;
      const needsAuth = r.status === 401 || r.status === 403;
      if (reachable && !needsAuth && r.status < 400) ok('  → HTTP ' + r.status);
      else if (needsAuth) info('  → HTTP ' + r.status + '（需要登录，服务可达）');
      else bad('  → HTTP ' + r.status + '，异常');
      if (h.proxy) {
        cf ? ok('  → 确认走了 Cloudflare CDN（橙云生效）')
           : bad('  → 期望走 CDN 但没看到 Cloudflare 响应头，检查 Proxy status 是不是橙云');
      } else {
        cf ? bad('  → 期望直连却经过了 Cloudflare，检查 Proxy status 是不是灰云')
           : ok('  → 确认直连（灰云生效）');
      }
    }
  }

  // ── 4. 接入后专项检查 ──────────────────────────────────────
  if (VERIFY) {
    line('');
    line('[4] 接入后专项检查');
    const sw = await httpsGet('vb.bscjs.top', '/sw.js');
    const cfCache = sw.headers['cf-cache-status'];
    if (cfCache) {
      const bad1 = /HIT|EXPIRED|STALE/.test(cfCache);
      bad1 ? bad('sw.js 命中 Cloudflare 缓存（' + cfCache + '）→ SW 永远更新不了，必须加 Bypass 规则')
          : ok('sw.js 未被缓存（' + cfCache + '）');
    } else {
      info('sw.js 无 cf-cache-status 头（可能未经过缓存层）——用 DevTools 再确认一次');
    }

    const mf = await httpsGet('vb.bscjs.top', '/manifest.webmanifest');
    const ct = String(mf.headers['content-type'] || '');
    ct.includes('application/manifest+json') ? ok('manifest MIME 正确：' + ct)
                                             : bad('manifest MIME 异常：' + ct);
  }

  line('');
  line('='.repeat(70));
  line(VERIFY ? '复检完成。请对照第 6 节验证清单逐条打勾。'
               : '预检完成。请对照 docs/Cloudflare接入手册.md 第 1 节核对快照是否一致。');
  line('='.repeat(70));
  line('');
}

main().catch((e) => {
  console.error('预检脚本异常：', e);
  process.exit(1);
});
