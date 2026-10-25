// 生成 README 截图用的演示数据（只注入截图浏览器会话，不进代码、不影响用户本机）
const SK = ['serve', 'receive', 'set', 'spike', 'block', 'defense'];
const P = (id, name, number, position, grade, height, sk) => ({
  id, name, number, position, grade, height,
  skills: Object.fromEntries(SK.map((k, i) => [k, sk[i]])),
  createdAt: 1760000000000, updatedAt: 1760000000000
});
const players = [
  P('p1', '陈一鸣', 1, '主攻', '大二', 186, [7.5, 7, 5, 8.5, 6, 7]),
  P('p2', '李昊然', 2, '主攻', '大一', 183, [6.5, 6.5, 4.5, 7.5, 5.5, 6]),
  P('p3', '王子航', 3, '副攻', '大二', 190, [6, 5.5, 4, 8, 8.5, 6.5]),
  P('p4', '刘俊熙', 4, '副攻', '大三', 188, [5.5, 5, 4.5, 7.5, 7.5, 6]),
  P('p5', '张思远', 5, '二传', '大二', 179, [5, 6, 9, 5.5, 4.5, 6.5]),
  P('p6', '赵子墨', 6, '二传', '大一', 177, [4.5, 5.5, 7.5, 5, 4, 5.5]),
  P('p7', '黄嘉树', 7, '接应', '大三', 185, [7, 6, 5, 8, 6.5, 7.5]),
  P('p8', '周天佑', 8, '接应', '大二', 184, [6, 5.5, 5, 7, 6, 6.5]),
  P('p9', '吴启铭', 9, '自由人', '大二', 175, [4, 9, 4.5, 4.5, 5, 9]),
  P('p10', '郑博文', 10, '自由人', '大一', 173, [4, 8, 4, 4, 4.5, 8.5])
];

const weekSessions = (monday, base) => [
  { id: `s_${monday}_tue`, date: plus(monday, 1), start: '16:30', end: '18:30', venue: '', templateId: 'tue', status: 'scheduled', cancelReason: '', attendance: att(base, 0), createdAt: 1760000000000, updatedAt: 1760000000000 },
  { id: `s_${monday}_fri`, date: plus(monday, 4), start: '16:30', end: '18:30', venue: '', templateId: 'fri', status: 'scheduled', cancelReason: '', attendance: att(base, 1), createdAt: 1760000000000, updatedAt: 1760000000000 },
  { id: `s_${monday}_sun`, date: plus(monday, 6), start: '08:30', end: '11:30', venue: '', templateId: 'sun', status: 'scheduled', cancelReason: '', attendance: {}, createdAt: 1760000000000, updatedAt: 1760000000000 }
];
function plus(monday, n) {
  const d = new Date(monday + 'T00:00:00');
  d.setDate(d.getDate() + n);
  // 本地日期串（toISOString 是 UTC，GMT+8 下会差一天）
  const p2 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
// 两种考勤分布：0=全员到齐带 1 个迟到；1=有请假缺席
function att(mode, _) {
  const a = {};
  players.forEach((p, i) => {
    if (mode === 0) a[p.id] = i === 4 ? 'late' : 'present';
    else a[p.id] = i === 3 ? 'absent' : i === 6 ? 'leave' : i === 9 ? 'late' : 'present';
  });
  return a;
}

const weeks = {
  '2026-10-19': weekSessions('2026-10-19', 0),
  '2026-10-12': weekSessions('2026-10-12', 1),
  '2026-10-05': weekSessions('2026-10-05', 0)
};

// 技能日志：近三周、每名队员若干条正向变动
const SK_CN = { serve: '发球', receive: '一传', set: '二传', spike: '扣球', block: '拦网', defense: '防守' };
const skillLogs = [];
let logN = 0;
players.forEach((p, pi) => {
  SK.forEach((sk, si) => {
    if ((pi + si) % 3 === 0) return;
    const after = p.skills[sk];
    const delta = [0.5, 1][ (pi + si) % 2 ];
    const before = Math.max(0, +(after - delta).toFixed(1));
    skillLogs.push({
      id: 'log' + (++logN), playerId: p.id, skill: sk,
      before, after, delta, source: 'training',
      date: plus('2026-10-19', (pi + si) % 6), at: 1760500000000 + logN * 3600e3
    });
  });
});

const fxPos = (o) => Object.fromEntries(Object.entries(o).map(([k, [x, y]]) => [k, { x, y }]));
const formations = [
  { id: 'f_demo1', name: '接发球站位', pos: fxPos({ s: [6.3, 1.1], mb: [4.5, 0.85], opp: [2.6, 1.35], oh1: [1.8, 5.6], lib: [4.5, 7.0], oh2: [7.0, 5.9] }), at: 1760600000000 },
  { id: 'f_demo2', name: '防反退守', pos: fxPos({ s: [6.8, 3.6], mb: [4.5, 3.35], opp: [2.2, 3.8], oh1: [1.4, 7.4], lib: [4.5, 8.2], oh2: [7.4, 7.4] }), at: 1760700000000 }
];

const db = {
  version: 2,
  settings: { theme: 'aurora', ai: { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-demo-screenshot' } },
  players,
  weeks,
  skillLogs,
  formation: { version: 1, preset: 'base', pos: fxPos({ s: [6.3, 1.1], mb: [4.5, 0.85], opp: [2.6, 1.35], oh1: [1.8, 5.6], lib: [4.5, 7.0], oh2: [7.0, 5.9] }) },
  formations,
  aiChat: []
};
import { writeFileSync } from 'node:fs';
writeFileSync('tools/.seed-demo.json', JSON.stringify(db));
console.log('seed ok,', (JSON.stringify(db).length / 1024).toFixed(1) + 'KB,', players.length, '名队员,', Object.keys(weeks).length, '周,', skillLogs.length, '条技能日志');
