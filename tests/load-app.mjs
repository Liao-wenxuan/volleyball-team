/**
 * 在 Node 里加载生产 app.js 的纯函数集合（不启动 UI、不需要浏览器）。
 *
 * app.js 是一个 IIFE，末尾会调用 init() 操作 DOM。它在末尾留了一个
 * `typeof module !== 'undefined'` 的导出钩子：浏览器里没有 CommonJS 的 module，
 * 那段是死代码；这里用 vm 注入 module，启动调用会被跳过，只拿到纯函数。
 *
 * 这样测的是仓库里那份真源码，不是复制出来的副本；DOM 桩只需撑住顶层的
 * 常量/函数定义，不需要实现任何渲染逻辑。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = readFileSync(path.join(ROOT, 'app.js'), 'utf8');

export function loadPure() {
  const noop = () => {};
  const storage = () => ({
    getItem: () => null, setItem: noop, removeItem: noop, clear: noop,
    key: () => null, length: 0
  });
  const el = () => ({
    style: {}, dataset: {}, innerHTML: '', textContent: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop,
    setAttribute: noop, querySelector: () => null, querySelectorAll: () => []
  });

  const sandbox = {
    module: { exports: {} },
    console, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {
      addEventListener: noop, removeEventListener: noop, XGYCloud: undefined,
      localStorage: storage(), sessionStorage: storage(),
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      location: { hash: '', href: 'http://localhost/', search: '' },
      navigator: { userAgent: '' }
    },
    document: {
      currentScript: { src: '' }, addEventListener: noop, readyState: 'complete',
      querySelector: () => null, querySelectorAll: () => [], createElement: el,
      head: el(), body: el(), documentElement: el()
    },
    navigator: {
      userAgent: '', standalone: false,
      serviceWorker: { register: () => Promise.resolve({}), addEventListener: noop }
    },
    localStorage: storage(), sessionStorage: storage(),
    fetch: () => Promise.reject(new Error('纯函数测试不应发起网络请求')),
    alert: noop, confirm: () => false, prompt: () => null,
    requestAnimationFrame: noop, getComputedStyle: () => ({}),
    location: { hash: '', href: 'http://localhost/', search: '' },
    Image: function () {}, Blob: function () {}, FileReader: function () {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  sandbox.self = sandbox.window;

  vm.runInNewContext(SRC, sandbox, { filename: 'app.js', timeout: 5000 });
  const api = sandbox.module.exports;
  if (!api || Object.keys(api).length < 20) {
    throw new Error('app.js 的测试导出钩子没生效（或纯函数列表被改短了）');
  }
  return api;
}
