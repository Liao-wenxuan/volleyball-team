/**
 * 把 app.js 切成 src/ 下的分片源文件。
 *
 * 为什么要拆：app.js 已 5000+ 行、全部在一个 IIFE 里，靠命名约定而非模块边界维持。
 * 但**不能**直接改成 ESM —— 那会破坏两件事：
 *   1. tests/load-app.mjs 用 node:vm 加载**单个** app.js 文件跑纯函数测试；
 *   2. build.mjs 把 app.js 内联进单文件 HTML 供用户双击离线使用。
 *
 * 所以方案是：**源码分片 → build 拼回单个 app.js**。
 * 产物形态完全不变（还是一个 app.js、一个 IIFE），vm 机制零改动，
 * 只是把「维护」这件事从 5000 行一个文件，变成按领域分的一堆文件。
 *
 * 切分依据：app.js 顶层那些 ══════ 区块注释。每个区块是一个完整领域，
 * 按它切开基本等于按依赖切开（同一领域的函数总是挨在一起）。
 *
 * 用法：node tools/split-app.mjs [--dry]
 *   --dry 只报告切分计划，不写文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP = path.join(ROOT, 'app.js');
const OUT = path.join(ROOT, 'src');

const DRY = process.argv.includes('--dry');

/* 源文件从哪来（关键设计，踩过坑）：
 *
 * app.js 是**构建产物** —— build.mjs 会把 src/ 下的分片拼成 app.js 并覆盖它。
 * 所以切分脚本不能直接读磁盘上的 app.js：上一轮 build 留下的产物里可能
 * 已经有多余空行（我调试时踩过：偏差会在「切分 → 构建 → 再切分」之间累积，
 * 一次比一次多几个空行，最后产物比原文多 25 行）。
 *
 * 正确做法：切分的**唯一真源**是 git 里的原始 app.js（HEAD 版本），
 * 它永远是「未拼接过的原始状态」。用 git show 读，拿不到就报错退出 ——
 * 宁可什么都不做，也不能用被污染的产物当源。
 */
import { execFileSync } from 'node:child_process';

function readOriginalAppJs() {
  try {
    return execFileSync('git', ['show', 'HEAD:app.js'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (e) {
    console.error(
      '无法从 git 读取原始 app.js（git show HEAD:app.js 失败）。\n' +
      '  切分必须以未拼接过的原始文件为源，否则偏差会累积。\n' +
      '  请确认：① 在 git 仓库里；② app.js 已提交（至少有一次提交）。'
    );
    process.exit(1);
  }
}

const src = readOriginalAppJs();
const lines = src.split('\n');

// ── 定位 IIFE 边界 ──────────────────────────────────────────────
// app.js 是**单一 IIFE**：第 5 行 "(function () {" 开始，文件末尾 "})();" 结束。
// 注意：内部还有 3 个嵌套 IIFE（ensureMod / 导入解析 / 别处），它们的 "})();" 带缩进，
// 所以不能取第一个匹配 —— 必须取**顶格**的那个。
const iifeStart = lines.findIndex((l) => /^\(function\s*\(\)\s*\{/.test(l));
if (iifeStart < 0) throw new Error('找不到 IIFE 起始行');
const iifeEnd = lines.findIndex((l, i) => i > iifeStart && /^\}\)\(\);?\s*$/.test(l));
if (iifeEnd < 0) throw new Error('找不到 IIFE 结束行');

// ── 找出所有顶层区块注释 ────────────────────────────────────────
// 两种真实存在的写法（app.js 里两种都有）：
//   A)  /* ══════════ 工具 ══════════ */          单行
//   B)  /* ══════════ 按需加载的模块 ══════════     标题在下一行
//        ...正文...
//        ═══════════════════════════════ */        (A 形式带尾部)
// 统一处理：先找 "/* ══...═" 开头的行，从该行往后 3 行内找标题。
const markers = [];
for (let i = iifeStart + 1; i < iifeEnd; i++) {
  if (!/^\s{2}\/\*\s*[═─]{3,}/.test(lines[i])) continue;
  // 标题可能就在本行（结尾有 */），也可能在接下来的 1~2 行
  let title = null;
  const inline = lines[i].match(/[═─]{3,}\s*(.+?)\s*[═─]{3,}/);
  if (inline && !/^\s*[═─]{3,}/.test(inline[1] || '')) {
    title = inline[1].trim();
  } else {
    for (let j = i + 1; j <= Math.min(i + 2, iifeEnd - 1); j++) {
      const t2 = lines[j].trim();
      if (!t2 || t2.startsWith('*')) continue;
      const m2 = t2.match(/^([═─]{3,})\s*(.+?)\s*[═─]{0,}/);
      if (m2 && m2[2] && !/^[═─\s*\/]+$/.test(m2[2])) { title = m2[2].trim(); break; }
    }
  }
  if (!title) continue;
  markers.push({ line: i, title });
}

// ── 每个区块归到一个领域文件 ────────────────────────────────────
// 归类规则：标题里出现某些关键词的区块，归到对应领域；
// 没匹配到的落到 misc（后面人工再分）。
const RULES = [
  { file: 'core.js',        re: /^(工具|常量|日期|数据|基础数据操作|按需加载的模块)$/ },
  { file: 'theme.js',       re: /^(主题|阵型板常量)$/ },
  { file: 'players.js',     re: /^(人员管理|队员表单 \/ 抽屉|批量导入名单|从表格导入)/ },
  { file: 'attendance.js',  re: /^(考勤|训练弹窗|阵容完整度)/ },
  { file: 'skills.js',      re: /^(成长计划|单项调整|训练后批量调整)$/ },
  { file: 'formation.js',   re: /^(阵型板)$/ },
  { file: 'cards.js',       re: /^(训练卡|赛季卡|阵型图|分享队伍动态|请假回执)/ },
  { file: 'settings.js',    re: /^(设置 \/ 数据|导入链接)/ },
  { file: 'backup.js',      re: /^(导入备份)/ },
  { file: 'ui.js',          re: /^(UI 基础|侧边栏|最近动态|雷达图|总览)$/ },
  { file: 'router.js',      re: /^(页面切换|命令面板|事件绑定)$/ },
  { file: 'cloud.js',       re: /^(云端桥接)/ },
  { file: 'ai.js',          re: /^(AI 助手)/ },
  { file: 'boot.js',        re: /^(启动|PWA)/ }
];

function pickFile(title) {
  for (const r of RULES) if (r.re.test(title)) return r.file;
  return 'misc.js';
}

// ── 生成切分计划 ────────────────────────────────────────────────
// prologue = 文件头注释 + IIFE 起始行，直到第一个区块之前
// （踩过：写成 slice(iifeStart+1, ...) 会丢掉 "(function () {" 这一行，
//   拼出来的产物少了 IIFE 开头，整个文件语法错误）
//
// 注意 prologue 末尾**可能带一个空行**（原文里 IIFE 开头与第一个区块之间有空行）。
// 那个空行要保留 —— 拼接时各段原样相接，不额外补也不额外删。
const prologue = lines.slice(0, markers[0].line);
const epilogue = lines.slice(iifeEnd);              // 从 "})();" 开始到文件末尾

// ── 归类：每个区块落到哪个领域文件 ──────────────────────────────
// 关键约束：**一个领域的区块必须构成原文件里的一段连续区间**。
// 因为分片文件是按「原序」拼接的，如果 core 的两个区块中间夹着 players 的区块，
// 它们就被迫分成两个文件（core-a / core-b），很难看。
// 所以先把归属算出来，再把「被别的领域打断」的领域拆成多个连续段。
const blockFile = markers.map(m => pickFile(m.title));

// 按原序扫描，把**紧邻**的同归属区块合成一个「段」
// 段只记 [start, end) 行区间 —— **不做任何 trim**，
// 这样分片拼回去就是原文的逐行复制，空行、缩进、注释一个字符都不差。
//
// 关键（踩过的坑）：合并时必须同时满足「同归属」**且「紧邻」**。
// 只判同归属会出事：core 的「工具」「常量」「按需加载」三块中间夹着 theme 的两块，
// 若一路合并，core 的区间会跨越 theme 的内容，把 theme 的代码也写进 core.js ——
// 结果是同一段代码出现两次，产物里多了 25 行。
const segments = []; // { file, start, end, titles: [] }
for (let i = 0; i < markers.length; i++) {
  const start = markers[i].line;
  const end = i + 1 < markers.length ? markers[i + 1].line : iifeEnd;
  const file = blockFile[i];
  const last = segments[segments.length - 1];
  // 紧邻 = 上一段的 end 就是本段的 start
  if (last && last.file === file && last.end === start) {
    last.end = end;
    last.titles.push(markers[i].title);
  } else {
    segments.push({ file, start, end, titles: [markers[i].title] });
  }
}

// 同一领域被拆成多段时，文件名叫 foo.js / foo-2.js
const fileSeq = new Map();
const groups = new Map();
const order = [];
for (const seg of segments) {
  const n = (fileSeq.get(seg.file) || 0) + 1;
  fileSeq.set(seg.file, n);
  const name = n === 1 ? seg.file : seg.file.replace(/\.js$/, '-' + n + '.js');
  groups.set(name, seg);
  order.push(name);
}

/* ── 分片顺序 = 原始 app.js 里的出现顺序 ────────────────────────
 *
 * 踩过的坑：最初想按「领域」重排分片（core → theme → players…），
 * 结果直接炸了 —— ReferenceError: Cannot access 'FX_ROLES' before initialization。
 *
 * 原因：JS 的 const/let 有 TDZ（暂时性死区），**声明之前引用会抛错**，
 * 而不是像 var 那样拿到 undefined。app.js 里 blankDB() 在模块加载期就会调用
 * blankFormation()，后者依赖 theme.js 里的 FX_ROLES 常量。
 * 一旦把 theme.js 排到 core.js 后面，blankDB() 执行时 FX_ROLES 还没初始化。
 *
 * 所以：**分片必须严格保持原始行序**。领域只决定「哪些相邻区块归到一个文件」，
 * 不决定文件之间的先后。这样内容与原文件逐行等价，初始化顺序也天然不变。
 */
console.log('app.js 总行数:', lines.length);
console.log('识别到区块:', markers.length, '个');
console.log('');
console.log('切分计划（顺序 = 原始出现顺序，不重排）：');
for (const f of order) {
  const g = groups.get(f);
  console.log('  ' + f.padEnd(16) + String(g.end - g.start).padStart(5) + ' 行   ' +
    g.titles.join(' / '));
}
console.log('');
if (process.argv.includes('--verbose')) {
  console.log('每个区块的归属与区间：');
  markers.forEach((m, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].line : iifeEnd;
    console.log('  行' + String(m.line + 1).padStart(5) +
      ' [' + m.line + ',' + end + ') ' +
      String(end - m.line).padStart(4) + ' 行  ' +
      blockFile[i].padEnd(15) + ' ' + m.title);
  });
  console.log('');
}

if (DRY) {
  console.log('--dry：只报告，不写文件。');
  process.exit(0);
}

// ── 写文件 ──────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });

for (const f of order) {
  const g = groups.get(f);
  const header = [
    '/* ' + '='.repeat(60),
    ' * ' + f.replace(/\.js$/, '') + ' —— ' + g.titles.join(' / '),
    ' *',
    ' * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。',
    ' * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。',
    ' * ' + '='.repeat(60) + ' */'
  ];
  // 正文 = 原文的精确行区间 [g.start, g.end)，一个字符都不改。
  // 关键：g.end 是「下一个区块注释行的位置」，所以这段区间**包含**原文件里
  // 本区块与下一区块之间的那个空行。区间原样复制即可，不需要任何拼接/补空行。
  const body = lines.slice(g.start, g.end);
  fs.writeFileSync(path.join(OUT, f), [...header, ...body].join('\n'), 'utf8');
  console.log('写出 src/' + f);
}

// 记录构建顺序，供 build.mjs 读取
fs.writeFileSync(
  path.join(OUT, '.order.json'),
  JSON.stringify({ order, prologue, epilogue }, null, 2),
  'utf8'
);
console.log('写出 src/.order.json');
