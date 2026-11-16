/**
 * 本地应急代理 + 发版版本号的纯函数守卫 · `npm run test:pure` 的一部分
 *
 * 1) 代理脚本的头改写曾在预览版里验证过，但只靠手工跑浏览器；这里锁死四个最容易
 *    悄悄回归的点：HSTS/Alt-Svc 必须删、Location 必须改写回本地、Cookie Domain 必须去掉、
 *    Authorization 不能被误删（Bearer token 是云端登录的唯一凭证）。
 * 2) 「改了 sw.js 的 VERSION 却忘了跑 node build.mjs」会让用户拿旧 HTML 引用旧缓存，
 *    症状像业务 bug。这里让 index.html / SHELL 的版本引用与 VERSION 强制一致。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cleanHeaders,
  rewriteLocation,
  upstreamHeaders,
  localOriginOf,
  probeSummary
} from '../tools/local-proxy.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const HOST = 'vb.bscjs.top';
const LOCAL = 'http://localhost:8787';

describe('本地应急代理 · 头改写', () => {
  test('rewriteLocation：http/https 都改写回本地，路径与 query 原样保留', () => {
    assert.equal(rewriteLocation(`https://${HOST}/admin?x=1`, HOST, LOCAL), `${LOCAL}/admin?x=1`);
    assert.equal(rewriteLocation(`http://${HOST}/`, HOST, LOCAL), `${LOCAL}/`);
  });

  test('rewriteLocation：别的域名、以及只含域名文本的路径不动', () => {
    assert.equal(rewriteLocation('https://example.com/a', HOST, LOCAL), 'https://example.com/a');
    assert.equal(rewriteLocation(`/go?next=https://${HOST}`, HOST, LOCAL), `/go?next=https://${HOST}`);
    // 上游域名里的点必须按字面量转义，不能被正则当成通配符
    assert.equal(rewriteLocation('https://vbXbscjsXtop/', HOST, LOCAL), 'https://vbXbscjsXtop/');
  });

  test('upstreamHeaders：换 Host、删代理专用头，保留 Authorization 与自定义头', () => {
    const input = {
      host: 'localhost:8787',
      'proxy-authorization': 'Basic leak',
      'proxy-connection': 'keep-alive',
      authorization: 'Bearer token-123',
      'x-team-id': 'team-1',
      'content-type': 'application/json'
    };
    const out = upstreamHeaders(input, HOST);
    assert.equal(out.host, HOST);
    assert.equal(out.authorization, 'Bearer token-123');
    assert.equal(out['x-team-id'], 'team-1');
    assert.equal(out['content-type'], 'application/json');
    assert.equal('proxy-authorization' in out, false);
    assert.equal('proxy-connection' in out, false);
    assert.equal('proxy-authorization' in input, true, '不能改坏调用方传进来的对象');
  });

  test('cleanHeaders：删 HSTS/Alt-Svc、改写 Location、去掉 Cookie 的 Domain', () => {
    const input = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'strict-transport-security': 'max-age=31536000',
      'alt-svc': 'h3=":443"; ma=2592000',
      location: `https://${HOST}/admin`,
      'set-cookie': [
        'sid=1; Domain=vb.bscjs.top; Path=/; HttpOnly',
        'theme=dark; domain = vb.bscjs.top ; Secure',
        'a=2; HttpOnly'
      ]
    };
    const out = cleanHeaders(input, HOST, LOCAL);
    assert.equal('strict-transport-security' in out, false);
    assert.equal('alt-svc' in out, false);
    assert.equal(out.location, `${LOCAL}/admin`);
    assert.equal(out['content-type'], 'text/html; charset=utf-8');
    assert.equal(out['cache-control'], 'no-cache');
    assert.deepEqual(out['set-cookie'], [
      'sid=1; Path=/; HttpOnly',
      'theme=dark; Secure',
      'a=2; HttpOnly'
    ]);
    assert.equal(input.location, `https://${HOST}/admin`, '不能改坏上游响应头对象');
  });

  test('cleanHeaders：没有这些头时原样返回，set-cookie 非数组也不炸', () => {
    assert.deepEqual(cleanHeaders({ 'content-type': 'application/json' }, HOST, LOCAL), { 'content-type': 'application/json' });
    const out = cleanHeaders({ 'set-cookie': 'sid=1; Domain=vb.bscjs.top' }, HOST, LOCAL);
    assert.equal(out['set-cookie'], 'sid=1; Domain=vb.bscjs.top');
  });

  test('localOriginOf：优先用请求 Host，缺省回退到 localhost', () => {
    assert.equal(localOriginOf({ headers: { host: '192.168.1.7:8787' } }, 8787), 'http://192.168.1.7:8787');
    assert.equal(localOriginOf({ headers: {} }, 8787), 'http://localhost:8787');
  });
});

describe('发版版本号 · 一致性守卫', () => {
  const sw = read('../sw.js');
  const html = read('../index.html');
  const version = sw.match(/const VERSION\s*=\s*'(v\d+)'/);

  test('sw.js 的 VERSION 是唯一真源，且形如 vN', () => {
    assert.ok(version, 'sw.js 里找不到 const VERSION = \'vN\'');
    assert.match(version[1], /^v\d+$/);
  });

  test('index.html 的所有 ?v= 引用都等于 VERSION（忘了跑 build.mjs 会在这里变红）', () => {
    const refs = html.match(/\?v=v\d+/g) || [];
    assert.ok(refs.length >= 5, `index.html 只有 ${refs.length} 处版本引用，build.mjs 可能没跑`);
    assert.ok(refs.every((r) => r === `?v=${version[1]}`), `版本引用不一致：${[...new Set(refs)].join(', ')} vs ${version[1]}`);
  });

  test('SW 预缓存 SHELL 的所有 ?v= 引用都等于 VERSION', () => {
    const refs = sw.match(/\?v=v\d+/g) || [];
    assert.ok(refs.length >= 5, `SHELL 只有 ${refs.length} 处版本引用`);
    assert.ok(refs.every((r) => r === `?v=${version[1]}`), `SHELL 版本引用不一致：${[...new Set(refs)].join(', ')} vs ${version[1]}`);
  });
});

describe('应急代理 · 上游自检文案', () => {
  test('可达：带 HTTP 状态与耗时，不出现失败提示', () => {
    const s = probeSummary({ ok: true, status: 200, ms: 396, error: '' }, HOST);
    assert.match(s, /可达/);
    assert.match(s, /HTTP 200/);
    assert.match(s, /396ms/);
    assert.doesNotMatch(s, /交叉核对/);
  });

  test('超时：明确说连接超时，并给出交叉核对路径', () => {
    const s = probeSummary({ ok: false, status: 0, ms: 2000, error: 'timeout' }, HOST);
    assert.match(s, /连接超时/);
    assert.match(s, /交叉核对/);
    assert.match(s, new RegExp(HOST.replace(/\./g, '\\.')));
    assert.doesNotMatch(s, /可达（HTTP/);
  });

  test('连接错误 / 空错误都渲染得出来，不抛异常', () => {
    assert.match(probeSummary({ ok: false, error: 'ECONNRESET' }, HOST), /ECONNRESET/);
    assert.match(probeSummary({ ok: false, error: '' }, HOST), /未知错误/);
  });
});

describe('按需模块 · 四处清单一致性守卫', () => {
  const app = read('../app.js');
  const build = read('../build.mjs');
  const mods = [...app.matchAll(/^\s*(\w+):\s*\['([^']+\.js)',\s*'([^']+)'\]/gm)]
    .map((m) => ({ key: m[1], file: m[2], globalName: m[3] }));
  const lazy = (build.match(/const lazyMods\s*=\s*\[([^\]]+)\]/) || [])[1];
  const assetRe = build.split('\n').find((l) => l.includes('const ASSET_RE')) || '';

  test('app.js 的 MODS 解析得到 6 个按需模块，文件与全局名都对得上', () => {
    assert.equal(mods.length, 6, `解析到 ${mods.length} 个：${mods.map((m) => m.key).join(',')}`);
    for (const m of mods) {
      const url = new URL('../' + m.file, import.meta.url);
      assert.ok(existsSync(fileURLToPath(url)), `${m.file} 不存在`);
      assert.ok(read('../' + m.file).includes(m.globalName), `${m.file} 里找不到 ${m.globalName}`);
    }
  });

  test('build.mjs 的 lazyMods 与 MODS 是同一批模块（新增模块漏内联会在这里变红）', () => {
    assert.ok(lazy, 'build.mjs 里找不到 const lazyMods');
    const names = lazy.split(',').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(names, mods.map((m) => m.key).sort());
  });

  test('ASSET_RE 覆盖所有按需模块（漏了发版时 ?v= 不刷新，旧缓存会 404）', () => {
    assert.ok(assetRe, 'build.mjs 里找不到 ASSET_RE');
    for (const m of mods) {
      assert.ok(assetRe.includes(m.file.replace('.', '\\.')), `${m.file} 没进 ASSET_RE`);
    }
  });
});
