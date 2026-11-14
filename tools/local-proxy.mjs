// 本地反向代理：浏览器只连 http://localhost:8787（纯 HTTP，无跨境 TLS 握手），
// 由本进程用「强制 TLS 1.2」连接线上服务器。
//
// 为什么需要：某些跨境链路会丢弃 Chromium 默认发出的 TLS 1.3 ClientHello，
// 浏览器直连站点时页面一直转 / 登录报 Failed to fetch；服务端改配置无效（包根本没到），
// 客户端强制 TLS 1.2 则稳定可达。本脚本把「强制 TLS 1.2」放进本机进程，
// 浏览器无需任何启动参数、独立 profile 或系统代理设置。
//
// 用法（仓库根目录）：
//   npm run proxy                    # 本机，http://localhost:8787/
//   VB_PROXY_LAN=1 npm run proxy    # 同一 WiFi 的手机也能访问
//   VB_PROXY_PORT=9000 npm run proxy
//
// 端口 8787 是刻意的：cloud.js 的 DEFAULT_BASE = 'http://localhost:8787'，
// 页面跑在 localhost:8787 时登录地址自动等于自己，零配置；
// 用局域网 IP 访问时 defaultBase() 返回 location.origin，同样自动指向本代理。
// 换成别的端口，就得在登录页「服务器地址」里手动填。
//
// 仅本机应急工具，不改产品代码、不动服务器配置，关掉窗口即失效。
// 根治跨境链路要靠 CDN / 换 IP / 换线路，那是产品决策，不在这里解决。
//
// 本文件作为模块导入时不会启动服务（供 tests/proxy.test.mjs 测纯函数）。
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.VB_PROXY_PORT || 8787);
const BIND = process.env.VB_PROXY_LAN === '1' ? '0.0.0.0' : '127.0.0.1';
const UPSTREAM_HOST = process.env.VB_PROXY_HOST || 'vb.bscjs.top';
// 直连 IP，避免本机 DNS 被系统代理影响；换服务器时用环境变量覆盖
const UPSTREAM_IP = process.env.VB_PROXY_IP || '47.84.52.175';
const TIMEOUT_MS = Number(process.env.VB_PROXY_TIMEOUT || 20000);

/** 把上游响应里的 Location 改写回本地 origin，否则浏览器会跳回那条坏链路。 */
export function rewriteLocation(value, upstreamHost, localOrigin) {
  const escaped = String(upstreamHost).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(value).replace(new RegExp(`https?://${escaped}`, 'g'), localOrigin);
}

/**
 * 清洗上游响应头：本地是 http，HSTS / Alt-Svc 无意义且会把浏览器引回原站；
 * Cookie 的 Domain 指向上游域名时必须去掉，否则本地 origin 会直接丢弃。
 */
export function cleanHeaders(headers, upstreamHost, localOrigin) {
  const h = { ...headers };
  delete h['strict-transport-security'];
  delete h['alt-svc'];
  if (h.location) h.location = rewriteLocation(h.location, upstreamHost, localOrigin);
  if (Array.isArray(h['set-cookie'])) {
    h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*Domain=[^;]+/gi, ''));
  }
  return h;
}

/** 请求头：改 Host 为上游域名，并去掉系统代理可能塞进来的两跳专用头。 */
export function upstreamHeaders(reqHeaders, upstreamHost) {
  const h = { ...reqHeaders, host: upstreamHost };
  delete h['proxy-authorization'];
  delete h['proxy-connection'];
  return h;
}

export function localOriginOf(req, port) {
  const host = req.headers.host || `localhost:${port}`;
  return `http://${host}`;
}

function createProxy() {
  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    servername: UPSTREAM_HOST,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2', // 关键：避开被丢弃的 TLS 1.3 ClientHello 特征
    rejectUnauthorized: true
  });

  let okCount = 0;
  let failCount = 0;

  const server = http.createServer((req, res) => {
    const started = Date.now();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const headers = upstreamHeaders(req.headers, UPSTREAM_HOST);
      const localOrigin = localOriginOf(req, PORT);

      const up = https.request(
        {
          host: UPSTREAM_IP,
          port: 443,
          servername: UPSTREAM_HOST,
          path: req.url,
          method: req.method,
          headers,
          agent,
          timeout: TIMEOUT_MS
        },
        (upRes) => {
          okCount++;
          const ms = Date.now() - started;
          console.log(`  ${req.method.padEnd(6)} ${req.url.slice(0, 60).padEnd(60)} ${upRes.statusCode}  ${ms}ms`);
          res.writeHead(upRes.statusCode, cleanHeaders(upRes.headers, UPSTREAM_HOST, localOrigin));
          upRes.pipe(res);
        }
      );

      const fail = (reason) => {
        failCount++;
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`本地代理连不上服务器（${reason}）。\n服务器本身可能正常，可先用浏览器打开 https://${UPSTREAM_HOST}/api/health 核对。\n累计：成功 ${okCount} / 失败 ${failCount}`);
      };
      up.on('timeout', () => { up.destroy(new Error('upstream timeout')); });
      up.on('error', (e) => fail(e.message));
      if (chunks.length) up.write(Buffer.concat(chunks));
      up.end();
    });
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n端口 ${PORT} 已被占用。若是本机后端服务，先关掉它；或设 VB_PROXY_PORT=其他端口（需同步改登录页「服务器地址」）。`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });

  return server;
}

function start() {
  const server = createProxy();
  server.listen(PORT, BIND, () => {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) ips.push(i.address);
      }
    }
    console.log('='.repeat(66));
    console.log(' 排球队管理系统 · 本地加速代理已启动（强制 TLS 1.2 连线上）');
    console.log('='.repeat(66));
    console.log(` 上游：${UPSTREAM_HOST} (${UPSTREAM_IP})`);
    console.log(`\n 本机浏览器打开：  http://localhost:${PORT}/`);
    if (BIND === '0.0.0.0' && ips.length) {
      console.log(' 同一 WiFi 的手机： ' + ips.map((ip) => `http://${ip}:${PORT}/`).join(' 或 '));
      console.log(' （手机打不开就是防火墙/不同网段，可忽略这一行）');
    }
    console.log('\n 登录页「服务器地址」会自动填成页面自己，不用手动改。');
    console.log(' 用完直接关掉这个窗口即可，不会改动任何项目代码。');
    console.log('\n 请求日志：');
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) start();
