/**
 * 阵型导出图的纯函数单测 · 跑法：`npm run test:pure`
 *
 * 测的是 courtcard.js 里的生产函数本身（vm 加载，见 load-courtcard.mjs）。
 * 最容易悄悄坏掉的契约是「导出图和屏幕战术板用同一个换算口径」：
 * 屏幕用 `x / FX_SIZE * 100%`（FX_SIZE=9），图里用 `x / 9 * 边长`。
 * 一旦有人把其中一边改成别的分母，发到群里的站位图就跟教练平板上摆的对不上了，
 * 而这种错没有任何 UI 回归能抓到。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCourtPure } from './load-courtcard.mjs';

const p = loadCourtPure();
const box = { x: 56, y: 216, w: 638, h: 638 };
const plain = (v) => JSON.parse(JSON.stringify(v)); // 跨 realm 原型，先压成当前 realm 的值

describe('courtPoint：米 → 画布像素', () => {
  test('0 米落在球场左上角，9 米落在右下角', () => {
    assert.deepEqual(plain(p.courtPoint(0, 0, box)), { x: 56, y: 216 });
    assert.deepEqual(plain(p.courtPoint(9, 9, box)), { x: 694, y: 854 });
  });

  test('换算口径和屏幕战术板一致（x/9 × 边长）', () => {
    // box 取 900×900 时，每米正好 100px，可直接和 `x/9*100%` 对照
    const b = { x: 0, y: 0, w: 900, h: 900 };
    for (const m of [0.25, 1.1, 4.5, 6.3, 8.7]) {
      const pt = p.courtPoint(m, m, b);
      assert.ok(Math.abs(pt.x - m * 100) < 1e-9, `x=${m} 换算不一致`);
      assert.ok(Math.abs(pt.y - m * 100) < 1e-9, `y=${m} 换算不一致`);
    }
  });

  test('3m 线在 1/3 处，和 CSS 的 top:100%/3 对齐', () => {
    const pt = p.courtPoint(4.5, 3, box);
    assert.ok(Math.abs(pt.y - (216 + 638 / 3)) < 1e-9);
  });

  test('越界/负数/非数字一律夹到 [0,9]，棋子不会飞出画布', () => {
    assert.deepEqual(plain(p.courtPoint(-5, 99, box)), { x: 56, y: 854 });
    assert.deepEqual(plain(p.courtPoint(NaN, undefined, box)), { x: 56, y: 216 });
    assert.deepEqual(plain(p.courtPoint('abc', null, box)), { x: 56, y: 216 });
  });

  test('x 与 y 独立，不会被对方的值串改', () => {
    const pt = p.courtPoint(1.8, 5.6, box);
    assert.ok(Math.abs(pt.x - (56 + 1.8 / 9 * 638)) < 1e-9);
    assert.ok(Math.abs(pt.y - (216 + 5.6 / 9 * 638)) < 1e-9);
  });
});

describe('clampMeters 与 shortLabel', () => {
  test('clampMeters 把脏输入夹成合法米数', () => {
    assert.equal(p.clampMeters(-1), 0);
    assert.equal(p.clampMeters(99), 9);
    assert.equal(p.clampMeters('abc'), 0);
    assert.equal(p.clampMeters(null), 0);
    assert.equal(p.clampMeters(4.25), 4.25);
  });

  test('短标要能区分两个主攻、以及自由人进前排后的换牌', () => {
    assert.equal(p.shortLabel('主攻1'), '主1');
    assert.equal(p.shortLabel('主攻2'), '主2');
    assert.equal(p.shortLabel('副攻1'), '副1');
    assert.equal(p.shortLabel('副攻2'), '副2');
    assert.equal(p.shortLabel('自由人'), '自由');
    assert.equal(p.shortLabel('副攻'), '副攻');
    assert.equal(p.shortLabel('二传'), '二传');
    assert.equal(p.shortLabel('接应'), '接应');
  });

  test('未知/空标签不炸，最多两位', () => {
    assert.equal(p.shortLabel(''), '?');
    assert.equal(p.shortLabel(null), '?');
    assert.equal(p.shortLabel('未知角色名'), '未知');
    assert.ok(p.shortLabel('很长的自定义名字').length <= 2);
  });

  test('短标与全名相同的时候不该在图上复读（模块里靠这个判断）', () => {
    const same = ['副攻', '接应', '二传'];
    const diff = ['主攻1', '主攻2', '自由人', '副攻1', '副攻2'];
    same.forEach((s) => assert.equal(p.shortLabel(s), s));
    diff.forEach((s) => assert.notEqual(p.shortLabel(s), s));
  });
});
