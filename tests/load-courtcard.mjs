/**
 * 在 Node 里加载生产 courtcard.js 的纯函数（不画 canvas、不需要浏览器）。
 *
 * 和 app.js 同一套路：courtcard.js 是 IIFE，末尾留了 `typeof module !== 'undefined'`
 * 的导出钩子，浏览器里是死代码。顶层只有常量和函数定义，DOM 只在 render() 里用，
 * 所以 vm 桩里故意让 createElement 抛错——纯函数测试不该碰绘图路径。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = readFileSync(path.join(ROOT, 'courtcard.js'), 'utf8');

export function loadCourtPure() {
  const sandbox = {
    module: { exports: {} },
    window: {},
    console,
    document: {
      createElement: () => { throw new Error('纯函数测试不应进入 canvas 绘制路径'); }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(SRC, sandbox, { filename: 'courtcard.js', timeout: 5000 });
  const api = sandbox.module.exports;
  if (!api || typeof api.courtPoint !== 'function' || !sandbox.window.XGYCourt) {
    throw new Error('courtcard.js 的测试导出钩子没生效');
  }
  return api;
}
