/**
 * 前端纯函数单测 · 跑法：`npm run test:pure`（或 `node --test tests/pure.test.mjs`）
 *
 * 测的是 app.js 里的生产函数本身，由 tests/load-app.mjs 用 vm 导出，
 * 不复制实现、不启浏览器、不碰 DOM 渲染。覆盖六类最容易在重构时悄悄坏掉、
 * 又恰好没有 UI 回归能抓到的边界：
 *   工具转义 / 日期与周边界 / 技能 0.5 步进 / 数据规范化白名单 /
 *   阵型 0.25m 吸附 / 粘贴导入的四类文本解析。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './load-app.mjs';

const p = loadPure();

/* vm 里创建的对象/数组带另一个 realm 的原型，deepStrictEqual 会判
 * 「Values have same structure but are not reference-equal」——明明内容一样也算挂。
 * 用 JSON 往返把结果压成当前 realm 的普通值再比：断言的是内容，不是原型出身。 */
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

describe('工具与转义', () => {
  test('clamp 夹取上下界，区间内原样返回', () => {
    assert.equal(p.clamp(5, 0, 10), 5);
    assert.equal(p.clamp(12, 0, 10), 10);
    assert.equal(p.clamp(-3, 0, 10), 0);
  });

  test('roundHalf 按 0.5 步进，半值向上，字符串先转数字', () => {
    assert.equal(p.roundHalf(7.26), 7.5);
    assert.equal(p.roundHalf(7.24), 7);
    assert.equal(p.roundHalf(7.25), 7.5);
    assert.equal(p.roundHalf('7.3'), 7.5);
    assert.equal(p.roundHalf(''), 0);
    assert.ok(Number.isNaN(p.roundHalf('abc')));
  });

  test('esc 转义五种 HTML 危险字符，空值转空串', () => {
    assert.equal(p.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(p.esc(null), '');
    assert.equal(p.esc(undefined), '');
    assert.equal(p.esc(0), '0');
  });

  test('pad2 个位补零、两位数不补', () => {
    assert.equal(p.pad2(3), '03');
    assert.equal(p.pad2(12), '12');
  });
});

describe('日期与周边界', () => {
  test('getMonday 周日归到上周二起的周一，周一保持当天', () => {
    assert.equal(p.dateKey(p.getMonday(new Date(2026, 10, 8))), '2026-11-02'); // 周日
    assert.equal(p.dateKey(p.getMonday(new Date(2026, 10, 2))), '2026-11-02'); // 周一
  });

  test('getMonday 跨月、跨年不出错', () => {
    assert.equal(p.dateKey(p.getMonday(new Date(2026, 11, 1))), '2026-11-30');
    assert.equal(p.dateKey(p.getMonday(new Date(2027, 0, 1))), '2026-12-28');
  });

  test('dateKey 补零且 parseKey 能往返', () => {
    const d = new Date(2026, 0, 5);
    assert.equal(p.dateKey(d), '2026-01-05');
    assert.equal(p.dateKey(p.parseKey('2026-01-05')), '2026-01-05');
    assert.equal(p.dateKey(p.parseKey('2026-12-31')), '2026-12-31');
  });

  test('parseKey 把不存在的日期归一化（2026 非闰年）', () => {
    assert.equal(p.dateKey(p.parseKey('2026-02-29')), '2026-03-01');
    assert.ok(Number.isNaN(p.parseKey('not-a-date').getTime()));
  });

  test('addDays 跨月跨年，startOfDay 清掉时分秒', () => {
    assert.equal(p.dateKey(p.addDays(new Date(2026, 10, 30), 3)), '2026-12-03');
    assert.equal(p.dateKey(p.addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
    const d = p.startOfDay(new Date(2026, 10, 8, 23, 45, 12));
    assert.equal(d.getHours() + d.getMinutes() + d.getSeconds(), 0);
  });

  test('显示格式与 isSameDay', () => {
    assert.equal(p.fmtMD(new Date(2026, 0, 5)), '1.05');
    assert.equal(p.fmtRange(new Date(2026, 10, 2)), '11.02 – 11.08');
    assert.equal(p.fmtDateCN(new Date(2026, 10, 8)), '11月8日 周日');
    assert.equal(p.isSameDay(new Date(2026, 10, 8, 1, 0), new Date(2026, 10, 8, 23, 0)), true);
    assert.equal(p.isSameDay(new Date(2026, 10, 8), new Date(2026, 10, 9)), false);
  });
});

describe('技能分与调整记录', () => {
  test('normalizeSkills 缺省时六项全为 5', () => {
    same(p.normalizeSkills(null), {
      serve: 5, receive: 5, set: 5, spike: 5, block: 5, defense: 5
    });
  });

  test('normalizeSkills 按 0.5 步进取整', () => {
    assert.equal(p.normalizeSkills({ serve: 7.26 }).serve, 7.5);
    assert.equal(p.normalizeSkills({ serve: 7.24 }).serve, 7);
    assert.equal(p.normalizeSkills({ serve: 8.2 }).serve, 8);
  });

  test('normalizeSkills 把越界值夹回 0–10', () => {
    const s = p.normalizeSkills({ serve: 99, receive: -3 });
    assert.equal(s.serve, 10);
    assert.equal(s.receive, 0);
  });

  test('normalizeSkills 非法值、空串、null 都退回默认 5', () => {
    const s = p.normalizeSkills({ serve: 'abc', receive: '', set: null });
    assert.equal(s.serve, 5);
    assert.equal(s.receive, 5);
    assert.equal(s.set, 5);
  });

  test('overall 六项平均保留一位小数，normalizeLog 同步步进并算 delta', () => {
    assert.equal(p.overall({ skills: { serve: 7, receive: 8, set: 6, spike: 9, block: 5, defense: 6 } }), 6.8);
    const log = p.normalizeLog({ playerId: 'p1', skill: 'serve', before: 6.2, after: 7.8 });
    assert.equal(log.before, 6);
    assert.equal(log.after, 8);
    assert.equal(log.delta, 2);
    assert.equal(log.source, 'manual');
  });
});

describe('数据规范化白名单', () => {
  test('normalizePlayer 空输入给出完整默认结构', () => {
    const x = p.normalizePlayer({});
    assert.equal(x.name, '');
    assert.equal(x.number, 0);
    assert.equal(x.position, '主攻');
    assert.equal(x.grade, '大一');
    assert.equal(x.gender, '');
    assert.equal(x.height, 0);
    assert.equal(x.note, '');
    same(x.skills, p.normalizeSkills(null));
    assert.match(x.id, /^p_/);
  });

  test('normalizePlayer 保留合法值、去名字空格、点评截断 300 字', () => {
    const x = p.normalizePlayer({
      id: 'p1', name: ' 张三 ', number: '7', position: '二传', grade: '大三',
      gender: '女', height: 188, skills: { serve: 8.2 }, note: 'x'.repeat(310)
    });
    assert.equal(x.id, 'p1');
    assert.equal(x.name, '张三');
    assert.equal(x.number, 7);
    assert.equal(x.position, '二传');
    assert.equal(x.grade, '大三');
    assert.equal(x.gender, '女');
    assert.equal(x.height, 188);
    assert.equal(x.skills.serve, 8);
    assert.equal(x.note.length, 300);
  });

  test('normalizePlayer 非法枚举回退，带单位身高归 0（导入前需先走 normalizeImportHeight）', () => {
    const x = p.normalizePlayer({ position: '前锋', grade: '博五', gender: '未知', height: '188cm' });
    assert.equal(x.position, '主攻');
    assert.equal(x.grade, '大一');
    assert.equal(x.gender, '');
    assert.equal(x.height, 0);
  });

  test('normalizeSession 只保留四种合法考勤态，非法态被丢弃', () => {
    const s = p.normalizeSession({
      date: '2026-11-08',
      attendance: { a: 'present', b: 'late', c: 'leave', d: 'absent', e: 'bogus', f: 1 }
    });
    same(s.attendance, { a: 'present', b: 'late', c: 'leave', d: 'absent' });
    assert.equal(s.date, '2026-11-08');
    assert.equal(s.start, '16:30');
    assert.equal(s.end, '18:30');
    assert.equal(s.status, 'scheduled');
  });

  test('normalizeSession 非法日期返回 null，因雨取消状态被保留', () => {
    assert.equal(p.normalizeSession({ date: 'not-a-date' }), null);
    assert.equal(p.normalizeSession({}), null);
    const s = p.normalizeSession({ date: '2026-11-08', status: 'cancelled', cancelReason: '下雨' });
    assert.equal(s.status, 'cancelled');
    assert.equal(s.cancelReason, '下雨');
  });
});

describe('阵型坐标与 0.25m 吸附', () => {
  test('fxSnap 按 0.25 米吸附', () => {
    assert.equal(p.fxSnap(6.37), 6.25);
    assert.equal(p.fxSnap(6.38), 6.5);
    assert.equal(p.fxSnap(4.5), 4.5);
  });

  test('fxSnap / fxClamp 把坐标夹进 0.30–8.70 的边界内缩', () => {
    assert.equal(p.fxSnap(0.1), 0.3);
    assert.equal(p.fxSnap(99), 8.7);
    assert.equal(p.fxClamp(-5), 0.3);
    assert.equal(p.fxClamp(20), 8.7);
  });

  test('blankFormation 产出六个角色位与默认坐标', () => {
    const f = p.blankFormation();
    same(Object.keys(f.pos).sort(), ['lib', 'mb', 'oh1', 'oh2', 'opp', 's']);
    assert.equal(f.version, 1);
    assert.equal(f.preset, 'base');
    same(f.pos.s, { x: 6.3, y: 1.1 });
  });

  test('normalizeFormation 脏坐标回退默认或夹取，名称截断 12 字，非法 preset 变 custom', () => {
    const f = p.normalizeFormation({
      pos: { s: { x: 'abc', y: 99 } }, name: '一二三四五六七八九十十一十二十三十四', preset: 'nope'
    });
    assert.equal(f.pos.s.x, 6.3);
    assert.equal(f.pos.s.y, 8.7);
    assert.equal(f.name.length, 12);
    assert.equal(f.preset, 'custom');
    same(p.normalizeFormation(null), p.blankFormation());
  });
});

describe('粘贴名单的文本解析', () => {
  test('splitRow 认 Tab、逗号、中文逗号、竖线、连续空格', () => {
    const want = ['张三', '7', '主攻'];
    for (const line of ['张三\t7\t主攻', '张三,7,主攻', '张三，7，主攻', '张三|7|主攻', '张三  7  主攻']) {
      same(p.splitRow(line), want, line);
    }
  });

  test('splitRow 丢掉行尾空列但保留中间空列', () => {
    same(p.splitRow('张三\t7\t主攻\t'), ['张三', '7', '主攻']);
    same(p.splitRow('张三\t\t主攻'), ['张三', '', '主攻']);
  });

  test('normalizeImportPosition 别名按优先级归一，L/lib 认自由人', () => {
    assert.equal(p.normalizeImportPosition('接应二传'), '接应');
    assert.equal(p.normalizeImportPosition('副攻手'), '副攻');
    assert.equal(p.normalizeImportPosition('L'), '自由人');
    assert.equal(p.normalizeImportPosition('lib'), '自由人');
    assert.equal(p.normalizeImportPosition('libero'), '');
    assert.equal(p.normalizeImportPosition(''), '');
  });

  test('normalizeImportGrade 认中文、数字年级、研究生，未知截断 8 字', () => {
    assert.equal(p.normalizeImportGrade('大三'), '大三');
    assert.equal(p.normalizeImportGrade('三年级'), '大三');
    assert.equal(p.normalizeImportGrade('3年级'), '大三');
    assert.equal(p.normalizeImportGrade('研二'), '研二');
    assert.equal(p.normalizeImportGrade('未知内容'.repeat(3)), '未知内容未知内容');
  });

  test('normalizeImportNumber 剥号/#/no. 前缀，小数四舍五入，非法值 NaN', () => {
    assert.equal(p.normalizeImportNumber('5号'), 5);
    assert.equal(p.normalizeImportNumber('#12'), 12);
    assert.equal(p.normalizeImportNumber('no.3'), 3);
    assert.equal(p.normalizeImportNumber('3.7'), 4);
    assert.ok(Number.isNaN(p.normalizeImportNumber('abc')));
    assert.ok(Number.isNaN(p.normalizeImportNumber('')));
  });

  test('normalizeImportHeight 认 cm/厘米 与米制小数，非法值 NaN', () => {
    assert.equal(p.normalizeImportHeight('188cm'), 188);
    assert.equal(p.normalizeImportHeight('185厘米'), 185);
    assert.equal(p.normalizeImportHeight('1.85'), 185);
    assert.equal(p.normalizeImportHeight('2.5'), 250);
    assert.ok(Number.isNaN(p.normalizeImportHeight('abc')));
    assert.ok(Number.isNaN(p.normalizeImportHeight('')));
  });
});
