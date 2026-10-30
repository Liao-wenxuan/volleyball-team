/* ═══════════════════════════════════════════════════════
   信工院排球队 · 本地球队管理
   队员 / 训练 / 考勤 / 技能点 · 纯原生 JS
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // 分享链接（#share=...）打开的是队员只读视图，share.js 已接管页面，主应用不启动
  if (window.__XGY_SHARE_MODE) return;

  /* ══════════ 工具 ══════════ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const roundHalf = (v) => Math.round(Number(v) * 2) / 2;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let uidSeq = 0;
  const BUILD = '2026-10-30 · r11'; // 每次改版手动加一，页脚会显示，用来确认「跑的是哪一版」
  const uid = (p) => `${p}_${Date.now().toString(36)}_${(++uidSeq).toString(36)}`;
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ══════════ 常量 ══════════ */
  const DB_KEY = 'xgy_volleyball_v2';
  const SCHEMA = 2;
  const SKILLS = [
    { key: 'serve', label: '发球' },
    { key: 'receive', label: '一传' },
    { key: 'set', label: '二传' },
    { key: 'spike', label: '扣球' },
    { key: 'block', label: '拦网' },
    { key: 'defense', label: '防守' }
  ];
  const POSITIONS = ['主攻', '副攻', '二传', '接应', '自由人'];
  const GRADES = ['大一', '大二', '大三', '大四', '研一', '研二', '研三'];
  const ROLE_STYLE = {
    '主攻': ['#ff8a5c', '#ffc46b'],
    '副攻': ['#7b6cff', '#4aa8ff'],
    '二传': ['#46e0ff', '#37e39b'],
    '接应': ['#fb7299', '#ff9d6e'],
    '自由人': ['#37e39b', '#b8f06a']
  };
  const DEFAULT_TEMPLATE = [
    { id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '' },
    { id: 'fri', day: 5, label: '周五', start: '16:30', end: '18:30', venue: '' },
    { id: 'sun', day: 0, label: '周日', start: '08:30', end: '11:30', venue: '' }
  ];
  const COURT_SLOTS = [
    { pos: '主攻', x: 106, y: 196, color: '#ff8a5c' },
    { pos: '副攻', x: 170, y: 192, color: '#8f82ff' },
    { pos: '二传', x: 234, y: 196, color: '#46e0ff' },
    { pos: '接应', x: 88, y: 276, color: '#fb7299' },
    { pos: '自由人', x: 170, y: 282, color: '#37e39b' },
    { pos: '副攻', x: 252, y: 276, color: '#4aa8ff' }
  ];
  const PAGES = {
    dashboard: { title: '球队总览', kicker: 'TEAM OPS / OVERVIEW' },
    roster: { title: '人员管理', kicker: 'ROSTER / PLAYERS' },
    attendance: { title: '考勤管理', kicker: 'ATTENDANCE / WEEK' },
    tactics: { title: '阵型板', kicker: 'FORMATION / COURT' },
    growth: { title: '成长计划', kicker: 'SKILLS / GROWTH' },
    ai: { title: 'AI 助手', kicker: 'AI COACH / ASSISTANT' }
  };
  const SOURCE_LABEL = { training: '训练', match: '比赛', manual: '手动' };

  /* ══════════ 主题 ══════════ */
  const THEMES = [
    { id: 'aurora', name: '极光', sub: '紫 + 青', p: '#7b6cff', s: '#46e0ff' },
    { id: 'ocean', name: '深海', sub: '蓝 + 湖青', p: '#3f8cff', s: '#2fd4e8' },
    { id: 'forest', name: '松林', sub: '翠绿 + 黄绿', p: '#2fbf8f', s: '#a8e05f' },
    { id: 'sunset', name: '落日', sub: '橙 + 玫红', p: '#ff7a45', s: '#ff5d8f' },
    { id: 'sakura', name: '樱粉', sub: '粉 + 紫', p: '#f06fb0', s: '#b18cff' },
    { id: 'graphite', name: '石墨', sub: '雾蓝灰', p: '#8ba3c7', s: '#7fd4e8' },
    { id: 'paper', name: '素纸', sub: '冷白 + 靛蓝', p: '#5a55e8', s: '#0a90bd', mode: 'light' },
    { id: 'sand', name: '暖砂', sub: '米白 + 陶土', p: '#c2611f', s: '#a8345a', mode: 'light' },
    { id: 'mint', name: '薄荷', sub: '浅绿 + 湖蓝', p: '#0d8f6f', s: '#0b7ea3', mode: 'light' }
  ];
  const THEME_IDS = THEMES.map((t) => t.id);
  const isTheme = (v) => THEME_IDS.includes(v);

  /* ══════════ 阵型板常量 ══════════ */
  const FX_SIZE = 9;      // 半场 9 × 9 米
  const FX_SNAP = 0.25;   // 吸附精度
  const FX_MIN = 0.30;    // 边界内缩
  const FX_MAX = FX_SIZE - 0.30;

  const FX_ROLES = [
    { id: 'oh1', name: '主攻1', color: '#ff9f5c' },
    { id: 'oh2', name: '主攻2', color: '#fb7299' },
    { id: 'mb', name: '副攻', color: '#a89bff' },
    { id: 'opp', name: '接应', color: '#ffbb55' },
    { id: 's', name: '二传', color: '#46e0ff' },
    { id: 'lib', name: '自由人', color: '#37e39b' }
  ];

  // 仅作内部默认站位（「恢复默认」按钮 / 新建初始值用）；预设列表已移除，阵型全部由用户在「阵型库」自行保存
  const FX_PRESETS = {
    base: {
      label: '默认站位',
      pos: {
        s: { x: 6.30, y: 1.10 }, mb: { x: 4.50, y: 0.85 }, opp: { x: 2.60, y: 1.35 },
        oh1: { x: 1.80, y: 5.60 }, lib: { x: 4.50, y: 7.00 }, oh2: { x: 7.00, y: 5.90 }
      }
    }
  };

  function fxClamp(v) { return Math.min(FX_MAX, Math.max(FX_MIN, v)); }
  function fxSnap(v) { return fxClamp(Math.round(v / FX_SNAP) * FX_SNAP); }

  function blankFormation() {
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: FX_PRESETS.base.pos[r.id].x, y: FX_PRESETS.base.pos[r.id].y }; });
    return { version: 1, preset: 'base', pos };
  }

  function normalizeFormation(raw) {
    const base = blankFormation();
    if (!raw || typeof raw !== 'object' || !raw.pos) return base;
    const pos = {};
    FX_ROLES.forEach((r) => {
      const p = raw.pos[r.id];
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      pos[r.id] = {
        x: fxClamp(Number.isFinite(x) ? x : base.pos[r.id].x),
        y: fxClamp(Number.isFinite(y) ? y : base.pos[r.id].y)
      };
    });
    return { version: 1, preset: FX_PRESETS[raw.preset] ? raw.preset : 'custom', pos };
  }

  /* ══════════ 日期 ══════════ */
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const getMonday = (d) => {
    const x = startOfDay(d);
    const day = x.getDay();
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
    return x;
  };
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseKey = (k) => {
    const [y, m, d] = String(k).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const weekKey = (monday) => dateKey(monday);
  const fmtMD = (d) => `${d.getMonth() + 1}.${pad2(d.getDate())}`;
  const fmtRange = (monday) => `${monday.getMonth() + 1}.${pad2(monday.getDate())} – ${addDays(monday, 6).getMonth() + 1}.${pad2(addDays(monday, 6).getDate())}`;
  const fmtDateCN = (d) => `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_CN[d.getDay()]}`;
  const isSameDay = (a, b) => dateKey(a) === dateKey(b);

  /* ══════════ 数据 ══════════ */
  function blankDB() {
    return { version: SCHEMA, settings: { template: clone(DEFAULT_TEMPLATE), theme: 'aurora' }, players: [], weeks: {}, skillLogs: [], formation: blankFormation(), formations: [], aiChat: [], shareNotes: {} };
  }

  function normalizeSkills(raw) {
    const out = {};
    SKILLS.forEach((s) => {
      const v = raw && raw[s.key] != null && raw[s.key] !== '' ? Number(raw[s.key]) : 5;
      out[s.key] = clamp(roundHalf(Number.isFinite(v) ? v : 5), 0, 10);
    });
    return out;
  }

  function normalizePlayer(raw) {
    const p = raw || {};
    return {
      id: p.id || uid('p'),
      name: String(p.name || '').trim(),
      number: Number.isFinite(Number(p.number)) ? Number(p.number) : 0,
      position: POSITIONS.includes(p.position) ? p.position : '主攻',
      grade: GRADES.includes(p.grade) ? p.grade : '大一',
      height: Number.isFinite(Number(p.height)) ? Number(p.height) : 0,
      skills: normalizeSkills(p.skills),
      createdAt: Number(p.createdAt) || Date.now(),
      updatedAt: Number(p.updatedAt) || Number(p.createdAt) || Date.now()
    };
  }

  function normalizeSession(raw) {
    if (!raw || !raw.date) return null;
    const date = parseKey(raw.date);
    if (Number.isNaN(date.getTime())) return null;
    const attendance = {};
    if (raw.attendance && typeof raw.attendance === 'object') {
      Object.keys(raw.attendance).forEach((pid) => {
        if (['present', 'late', 'leave', 'absent'].includes(raw.attendance[pid])) attendance[pid] = raw.attendance[pid];
      });
    }
    return {
      id: raw.id || uid('s'),
      date: dateKey(date),
      start: raw.start || '16:30',
      end: raw.end || '18:30',
      venue: String(raw.venue || ''),
      templateId: raw.templateId || null,
      status: raw.status === 'cancelled' ? 'cancelled' : 'scheduled',
      cancelReason: String(raw.cancelReason || ''),
      attendance,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now()
    };
  }

  function normalizeLog(raw) {
    if (!raw || !raw.playerId) return null;
    if (!SKILLS.some((s) => s.key === raw.skill)) return null;
    const before = clamp(roundHalf(Number(raw.before)), 0, 10);
    const after = clamp(roundHalf(Number(raw.after)), 0, 10);
    return {
      id: raw.id || uid('log'),
      playerId: raw.playerId,
      skill: raw.skill,
      before,
      after,
      delta: Number.isFinite(Number(raw.delta)) ? Number(raw.delta) : +(after - before).toFixed(1),
      source: ['training', 'match', 'manual'].includes(raw.source) ? raw.source : 'manual',
      date: raw.date || dateKey(new Date()),
      at: Number(raw.at) || Date.now()
    };
  }

  function normalizeDB(raw) {
    const base = blankDB();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.settings && Array.isArray(raw.settings.template) && raw.settings.template.length) {
      base.settings.template = raw.settings.template.slice(0, 3).map((t, i) => {
        const day = Number(t.day);
        const safeDay = Number.isFinite(day) ? day : [2, 5, 0][i];
        return {
          id: t.id || ['tue', 'fri', 'sun'][i] || uid('t'),
          day: safeDay,
          label: WEEK_CN[safeDay],
          start: t.start || '16:30',
          end: t.end || '18:30',
          venue: String(t.venue || '')
        };
      });
    }
    base.players = (Array.isArray(raw.players) ? raw.players : []).map(normalizePlayer).filter((p) => p.name);
    base.skillLogs = (Array.isArray(raw.skillLogs) ? raw.skillLogs : []).map(normalizeLog).filter(Boolean);
    if (raw.weeks && typeof raw.weeks === 'object') {
      Object.keys(raw.weeks).forEach((k) => {
        if (!Array.isArray(raw.weeks[k])) return;
        base.weeks[k] = raw.weeks[k].map(normalizeSession).filter(Boolean).sort(sessionSort);
      });
    }
    base.formation = normalizeFormation(raw.formation);
    base.settings.theme = raw.settings && isTheme(raw.settings.theme) ? raw.settings.theme : 'aurora';
    // AI 配置（BYOK）必须原样带回，否则每次刷新 Key 都会丢
    if (raw.settings && raw.settings.ai && typeof raw.settings.ai === 'object') {
      const a = raw.settings.ai;
      base.settings.ai = {
        base: String(a.base || 'https://api.deepseek.com'),
        model: String(a.model || 'deepseek-chat'),
        key: String(a.key || '')
      };
    }
    // 自定义阵型库（命名保存）
    base.formations = (Array.isArray(raw.formations) ? raw.formations : []).slice(0, 30).map((f) => {
      if (!f || typeof f !== 'object') return null;
      const pos = normalizeFormation({ version: 1, preset: 'custom', pos: f.pos }).pos;
      return { id: f.id || uid('f'), name: String(f.name || '未命名').slice(0, 16), pos, at: Number(f.at) || Date.now() };
    }).filter(Boolean);
    // AI 聊天记录（只存本机，随 db 持久化；最多留 100 条，单条内容截断防膨胀）
    // 队员点评（分享页里的建议和鼓励，按队员 id 存一段文字，生成过就不用重复掏钱）
    base.shareNotes = {};
    if (raw.shareNotes && typeof raw.shareNotes === 'object') {
      Object.keys(raw.shareNotes).forEach((k) => {
        const v = raw.shareNotes[k];
        if (typeof v === 'string' && v.trim()) base.shareNotes[k] = v.trim().slice(0, 300);
      });
    }
    base.aiChat = (Array.isArray(raw.aiChat) ? raw.aiChat : []).slice(-100).map((m) => {
      if (!m || typeof m !== 'object') return null;
      if (m.role !== 'user' && m.role !== 'assistant') return null;
      if (typeof m.content !== 'string' || !m.content) return null;
      return { role: m.role, content: m.content.slice(0, 8000) };
    }).filter(Boolean);
    return base;
  }

  function loadDB() {
    try { localStorage.removeItem('xgy-volley-v1'); } catch (e) { /* ignore */ }
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return blankDB();
      const data = JSON.parse(raw);
      if (!data || data.version !== SCHEMA) return blankDB();
      return normalizeDB(data);
    } catch (e) {
      return blankDB();
    }
  }

  let db = loadDB();
  const state = {
    page: 'dashboard',
    weekMonday: getMonday(new Date()),
    rosterFilter: '全部',
    rosterSearch: '',
    stackOpen: false,
    palette: [],
    paletteIndex: 0,
    confirmResolver: null,
  };

  function save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      toast('保存失败：本机存储空间不足或被禁用', 'warn');
    }
  }

  /* ══════════ 基础数据操作 ══════════ */
  const getPlayer = (id) => db.players.find((p) => p.id === id);
  const overall = (p) => +(SKILLS.reduce((a, s) => a + Number(p.skills[s.key] || 0), 0) / SKILLS.length).toFixed(1);
  const teamAverage = () => (db.players.length ? +(db.players.reduce((a, p) => a + overall(p), 0) / db.players.length).toFixed(1) : null);
  const teamSkillAverages = () => (db.players.length ? SKILLS.map((s) => +(db.players.reduce((a, p) => a + Number(p.skills[s.key] || 0), 0) / db.players.length).toFixed(1)) : null);
  const skillLabel = (key) => (SKILLS.find((s) => s.key === key) || {}).label || key;
  const sourceLabel = (src) => SOURCE_LABEL[src] || '手动';
  const positionStyle = (pos) => ROLE_STYLE[pos] || ['#7b6cff', '#46e0ff'];

  function sessionSort(a, b) {
    const da = `${a.date}T${a.start || '00:00'}`;
    const dbb = `${b.date}T${b.start || '00:00'}`;
    return da < dbb ? -1 : da > dbb ? 1 : 0;
  }

  function templateSessions(monday) {
    const key = weekKey(monday);
    if (Array.isArray(db.weeks[key])) return db.weeks[key];
    return db.settings.template.map((t) => {
      const offset = t.day === 0 ? 6 : t.day - 1;
      return {
        id: `s_${key}_${t.id}`,
        date: dateKey(addDays(monday, offset)),
        start: t.start,
        end: t.end,
        venue: t.venue || '',
        templateId: t.id,
        status: 'scheduled',
        cancelReason: '',
        attendance: {},
        createdAt: 0,
        updatedAt: 0
      };
    }).sort(sessionSort);
  }

  const getSessions = (monday) => templateSessions(monday);

  function ensureWeek(monday) {
    const key = weekKey(monday);
    if (!Array.isArray(db.weeks[key])) {
      const now = Date.now();
      db.weeks[key] = templateSessions(monday).map((s) => ({ ...s, createdAt: now, updatedAt: now }));
      save();
    }
    return db.weeks[key];
  }

  function resetWeek(monday) {
    if (CloudOn()) {
      // 云端模式：服务器按模板生成（已存在的周不会被重置，避免误丢考勤）
      delete db.weeks[weekKey(monday)];
      save();
      window.XGYCloud.syncWeek(weekKey(monday), true).then(() => renderAllCurrent());
      toast('已从云端重新加载本周训练');
      return;
    }
    delete db.weeks[weekKey(monday)];
    save();
    renderAttendance();
    renderDashboard();
    renderSidebar();
    toast('已按模板重新生成本周训练');
  }

  const sessionStart = (s) => new Date(`${s.date}T${s.start || '00:00'}:00`);
  const sessionEnd = (s) => new Date(`${s.date}T${s.end || '23:59'}:00`);

  function sessionStatus(s) {
    if (s.status === 'cancelled') {
      return { key: 'cancelled', text: s.cancelReason === '下雨' ? '因雨取消' : '已取消', cls: 'cancelled' };
    }
    const now = new Date();
    const end = sessionEnd(s);
    const start = sessionStart(s);
    if (now > end) return { key: 'done', text: '已结束', cls: 'done' };
    if (now >= start && now <= end) return { key: 'live', text: '进行中', cls: 'live' };
    if (isSameDay(now, parseKey(s.date))) return { key: 'today', text: '今天', cls: 'today' };
    return { key: 'upcoming', text: '待训练', cls: 'upcoming' };
  }

  function sessionCounts(s) {
    const c = { present: 0, late: 0, leave: 0, absent: 0, marked: 0 };
    Object.values(s.attendance || {}).forEach((st) => {
      if (c[st] != null) { c[st] += 1; c.marked += 1; }
    });
    c.attended = c.present + c.late;
    c.rate = c.marked ? Math.round((c.attended / c.marked) * 100) : null;
    return c;
  }

  function weekStats(monday) {
    const sessions = getSessions(monday);
    const active = sessions.filter((s) => s.status !== 'cancelled');
    const counts = { present: 0, late: 0, leave: 0, absent: 0, marked: 0 };
    const perPlayer = new Map(db.players.map((p) => [p.id, { present: 0, late: 0, leave: 0, absent: 0, marked: 0 }]));
    active.forEach((s) => {
      db.players.forEach((p) => {
        const st = s.attendance[p.id];
        if (!st || counts[st] == null) return;
        counts[st] += 1; counts.marked += 1;
        const r = perPlayer.get(p.id);
        if (r) { r[st] += 1; r.marked += 1; }
      });
    });
    const totalCells = active.length * db.players.length;
    const rate = counts.marked ? Math.round(((counts.present + counts.late) / counts.marked) * 100) : null;
    const perfect = db.players.filter((p) => {
      const r = perPlayer.get(p.id);
      return active.length > 0 && r && r.marked === active.length && r.present === active.length;
    }).length;
    return { sessions, active, counts, totalCells, unmarked: totalCells - counts.marked, rate, perfect, perPlayer };
  }

  function hasAnyAttendance() {
    return Object.values(db.weeks).some((arr) => Array.isArray(arr) && arr.some((s) => Object.keys(s.attendance || {}).length > 0));
  }

  function pushLog(playerId, skill, before, after, source, date) {
    db.skillLogs.push({
      id: uid('log'), playerId, skill, before, after,
      delta: +(after - before).toFixed(1), source,
      date: date || dateKey(new Date()), at: Date.now()
    });
  }

  function applySkillChanges(changes, source, date) {
    let count = 0;
    changes.forEach((ch) => {
      const p = getPlayer(ch.playerId);
      if (!p) return;
      const before = Number(p.skills[ch.skill] || 0);
      const after = clamp(roundHalf(Number(ch.value)), 0, 10);
      if (after === before) return;
      p.skills[ch.skill] = after;
      p.updatedAt = Date.now();
      pushLog(p.id, ch.skill, before, after, source, date);
      count += 1;
    });
    if (count) {
      save();
      if (CloudOn()) {
        const payload = changes
          .filter((ch) => getPlayer(ch.playerId))
          .map((ch) => ({ playerId: ch.playerId, skill: ch.skill, after: clamp(roundHalf(Number(ch.value)), 0, 10) }));
        if (payload.length) {
          cloudFire(
            window.XGYCloud.push.skillBatch(payload, source, date || dateKey(new Date())).then((resp) => {
              if (resp && Array.isArray(resp.players)) db.players = resp.players.map(normalizePlayer);
              save();
            }),
            null
          );
        }
      }
    }
    return count;
  }

  /* ══════════ UI 基础 ══════════ */
  function toast(msg, type = 'ok') {
    const stack = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-ico">${type === 'ok' ? '✓' : '!'}</span><span>${esc(msg)}</span>`;
    if (type !== 'ok') $('.toast-ico', el).style.cssText = 'background:rgba(255,187,85,.14);color:#ffbb55';
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, 3200);
  }

  function syncLock() {
    const locked = $('#drawer').classList.contains('open')
      || $('#modalScrim').classList.contains('show')
      || $('#paletteScrim').classList.contains('show')
      || $('#confirmScrim').classList.contains('show');
    document.body.classList.toggle('lock', locked);
  }

  function emptyState(icon, title, text, actions) {
    return `<div class="empty-state"><span class="es-ico">${icon}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${actions ? `<div class="es-actions">${actions}</div>` : ''}</div>`;
  }

  function miniEmpty(text) {
    return `<div class="mini-empty"><span>○</span><p>${esc(text)}</p></div>`;
  }

  function confirmDialog(opts) {
    const o = Object.assign({ title: '确认操作', message: '', ok: '确认', danger: true }, opts || {});
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
      $('#confirmTitle').textContent = o.title;
      $('#confirmMsg').textContent = o.message;
      $('#confirmOk').textContent = o.ok;
      $('#confirmOk').className = `btn ${o.danger ? 'btn-danger' : 'btn-primary'}`;
      $('#confirmScrim').classList.add('show');
      syncLock();
    });
  }
  function resolveConfirm(v) {
    $('#confirmScrim').classList.remove('show');
    const r = state.confirmResolver;
    state.confirmResolver = null;
    syncLock();
    if (r) r(v);
  }

  function openModal(title, body, opts) {
    const o = opts || {};
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modal').className = `modal${o.wide ? ' wide' : o.mid ? ' mid' : ''}`;
    $('#modalScrim').classList.add('show');
    closePopovers();
    syncLock();
  }
  function closeModal() {
    $('#modalScrim').classList.remove('show');
    syncLock();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#drawerScrim').classList.remove('show');
    syncLock();
  }
  function closePalette() {
    $('#paletteScrim').classList.remove('show');
    syncLock();
  }
  function closePopovers() { $$('.popover').forEach((p) => p.classList.remove('open')); }

  let revealIO = null;
  function refreshReveals() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach((el) => el.classList.add('in'));
      return;
    }
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
    }
    $$('.reveal:not(.in)').forEach((el) => revealIO.observe(el));
    const active = $('.page.active');
    if (active) {
      setTimeout(() => {
        $$('.reveal', active).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight * 1.1 && r.bottom > 0) el.classList.add('in');
        });
      }, 260);
    }
  }

  function relTime(ts) {
    const diff = Date.now() - Number(ts || 0);
    if (!Number.isFinite(diff) || diff < 0) return '刚刚';
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return `${Math.floor(d / 30)} 个月前`;
  }

  /* ══════════ 侧边栏 ══════════ */
  function renderSidebar() {
    $('#navPlayerCount').textContent = db.players.length;
    const stats = weekStats(getMonday(new Date()));
    const rate = stats.rate;
    const ring = $('#seasonRing');
    const C = 213.6;
    ring.style.strokeDashoffset = String(rate == null ? C : C * (1 - rate / 100));
    $('#seasonRate').textContent = rate == null ? '—' : `${rate}%`;
    $('#seasonBar').style.width = `${rate || 0}%`;
    if (!db.players.length) $('#seasonSub').textContent = '还没有队员';
    else if (rate == null) $('#seasonSub').textContent = `已登记 0 / ${stats.totalCells}`;
    else $('#seasonSub').textContent = `已登记 ${stats.counts.marked} / ${stats.totalCells}`;
  }

  /* ══════════ 最近动态 ══════════ */
  function getActivity() {
    const items = [];
    db.players.forEach((p) => {
      items.push({ type: 'player', at: p.createdAt, icon: '👤', title: `新队员 ${p.name}`, sub: `${p.position} · ${p.number} 号`, playerId: p.id });
    });
    db.skillLogs.slice(-80).forEach((l) => {
      const p = getPlayer(l.playerId);
      if (!p) return;
      items.push({
        type: 'skill', at: l.at, icon: l.delta > 0 ? '↗' : '↘',
        title: `${p.name} · ${skillLabel(l.skill)} ${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}`,
        sub: `${sourceLabel(l.source)} · 当前 ${l.after.toFixed(1)} 分`, playerId: p.id
      });
    });
    Object.keys(db.weeks).forEach((k) => {
      db.weeks[k].forEach((s) => {
        if (s.status === 'cancelled' && s.updatedAt) {
          items.push({
            type: 'cancel', at: s.updatedAt, icon: '☔',
            title: `${fmtDateCN(parseKey(s.date))} 训练取消`,
            sub: s.cancelReason || '临时调整', weekMonday: k
          });
        }
      });
    });
    return items.sort((a, b) => b.at - a.at).slice(0, 8);
  }

  function renderActivity() {
    const items = getActivity();
    const el = $('#activityList');
    if (!items.length) { el.innerHTML = miniEmpty('还没有动态。添加队员或调整技能后会出现在这里。'); return; }
    el.innerHTML = items.map((it) => `
      <button class="notif-item" data-activity="${it.type}" ${it.playerId ? `data-player="${it.playerId}"` : ''} ${it.weekMonday ? `data-week="${it.weekMonday}"` : ''}>
        <span class="ni-ico ${it.type === 'cancel' ? 'amber' : it.type === 'skill' ? 'violet' : 'green'}">${it.icon}</span>
        <span><b>${esc(it.title)}</b><em>${esc(it.sub)}</em><i>${relTime(it.at)}</i></span>
      </button>`).join('');
  }

  /* ══════════ 雷达图 ══════════ */
  function radarSVG10(values, size = 250, centerLabel = null) {
    const c = size / 2;
    const R = size * 0.335;
    const gid = uid('rg');
    const pt = (i, r) => {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      return [c + Math.cos(a) * r, c + Math.sin(a) * r];
    };
    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const pts = SKILLS.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
      grid += `<polygon class="radar-grid" points="${pts}"/>`;
    });
    let axes = '';
    SKILLS.forEach((_, i) => {
      const [x, y] = pt(i, R);
      axes += `<line class="radar-axis" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    });
    const poly = (arr) => arr.map((v, i) => pt(i, R * clamp(v, 0, 10) / 10).map((n) => n.toFixed(1)).join(',')).join(' ');
    let labels = '';
    SKILLS.forEach((s, i) => {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const x = c + Math.cos(a) * (R + 19);
      const y = c + Math.sin(a) * (R + 19);
      const anchor = Math.abs(Math.cos(a)) < 0.25 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      labels += `<text class="radar-label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${s.label}</text>`;
    });
    let dots = '';
    values.forEach((v, i) => {
      const [x, y] = pt(i, R * clamp(v, 0, 10) / 10);
      dots += `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4"/>`;
    });
    const center = centerLabel
      ? `<text class="radar-center-num" x="${c}" y="${c + 6}">${esc(centerLabel)}</text><text class="radar-center-sub" x="${c}" y="${c + 20}">全队均值</text>`
      : '';
    return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs><radialGradient id="${gid}" cx="50%" cy="50%" r="65%"><stop offset="0%" stop-color="rgba(168,155,255,.45)"/><stop offset="100%" stop-color="rgba(123,108,255,.14)"/></radialGradient></defs>
      ${grid}${axes}
      <polygon class="radar-poly" style="fill:url(#${gid})" points="${poly(values)}"/>
      ${dots}${center}${labels}
    </svg>`;
  }

  /* ══════════ 总览 ══════════ */
  function renderDashboard() {
    cloudEnsureWeek(getMonday(new Date()));
    const monday = getMonday(new Date());
    const stats = weekStats(monday);
    const avg = teamAverage();
    const avgSkills = teamSkillAverages();
    const rate = stats.rate;
    const scheduled = stats.sessions.length;
    const cancelled = stats.sessions.filter((s) => s.status === 'cancelled').length;

    $('#heroWeek').textContent = `本周 · ${fmtRange(monday)}`;
    if (!db.players.length) $('#heroSub').textContent = '还没有队员。先把队伍建起来，训练和考勤才有意义。';
    else {
      const attText = stats.counts.marked ? `已登记 ${stats.counts.marked} 项考勤` : '还没有考勤记录';
      $('#heroSub').textContent = `${db.players.length} 名队员 · 本周 ${stats.active.length} 次训练 · ${attText}`;
    }
    $('#heroPlayers').textContent = db.players.length;
    $('#heroRate').textContent = rate == null ? '—' : `${rate}%`;
    $('#heroAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#chipTrain').textContent = scheduled;
    $('#chipRate').textContent = rate == null ? '—' : `${rate}%`;
    $('#chipAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#courtCaption').innerHTML = db.players.length
      ? '<i class="pulse-dot small"></i>点击场上位置查看队员'
      : '<i class="pulse-dot small"></i>点击空位添加第一名队员';

    const primary = $('#heroPrimary');
    const secondary = $('#heroSecondary');
    if (!db.players.length) {
      primary.textContent = '添加第一名队员';
      primary.onclick = () => openPlayerForm();
      secondary.textContent = '查看训练模板';
      secondary.onclick = () => openSettings();
    } else {
      primary.textContent = '训练后调整';
      primary.onclick = () => openBatchAdjust();
      secondary.textContent = '查看本周训练';
      secondary.onclick = () => { state.weekMonday = getMonday(new Date()); go('attendance'); };
    }

    renderCourtPlayers();
    renderOnboarding();

    $('#kpiPlayers').textContent = db.players.length;
    $('#kpiPlayerTag').textContent = db.players.length ? '在队' : '空';
    $('#kpiPlayerSub').textContent = db.players.length ? `${new Set(db.players.map((p) => p.position)).size} / 5 个位置已覆盖` : '先添加第一名队员';
    $('#kpiRate').textContent = rate == null ? '—' : rate;
    $('#kpiRateUnit').textContent = rate == null ? '' : '%';
    $('#kpiRateTag').textContent = rate == null ? '未登记' : '本周';
    $('#kpiRateSub').textContent = stats.counts.marked ? `已登记 ${stats.counts.marked} / ${stats.totalCells} 项` : '还没有考勤记录';
    $('#kpiSessions').textContent = scheduled;
    $('#kpiSessionTag').textContent = '模板';
    $('#kpiSessionSub').textContent = cancelled ? `${cancelled} 次已取消` : (db.players.length ? '全部正常' : '先添加队员');
    $('#kpiAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#kpiAvgSub').textContent = avg == null ? '还没有队员' : `${db.players.length} 名队员 · 6 项均值`;

    renderDashSessions(stats);
    renderDashRing(stats);
    renderStack();
    renderTeamRadar(avgSkills, avg);
    renderHeatmap();
    renderSidebar();
    renderActivity();
  }

  function renderOnboarding() {
    const done = [true, db.players.length > 0, hasAnyAttendance(), db.skillLogs.length > 0];
    const count = done.filter(Boolean).length;
    $('#onboarding').hidden = count >= 4;
    $('#onboardPct').textContent = `${count} / 4`;
    $('#onboardBar').style.width = `${count / 4 * 100}%`;
    $$('#onboardSteps .onboard-step').forEach((btn, i) => {
      btn.classList.toggle('done', done[i]);
      const num = $('.os-num', btn);
      if (num) num.textContent = done[i] ? '✓' : String(i + 1);
    });
  }

  function renderCourtPlayers() {
    const used = {};
    $('#courtPlayers').innerHTML = COURT_SLOTS.map((slot) => {
      const list = db.players.filter((p) => p.position === slot.pos);
      const idx = used[slot.pos] || 0;
      used[slot.pos] = idx + 1;
      const p = list[idx];
      return `<g class="pos${p ? '' : ' empty'}" ${p ? `data-player="${p.id}"` : ''} data-role="${slot.pos}" style="--role:${slot.color}" transform="translate(${slot.x},${slot.y})">
        <circle class="pos-halo" r="20"/><circle class="pos-dot" r="12"/>
        <text class="pos-num" y="3.5">${p ? p.number : '+'}</text>
        <text class="pos-role" y="24">${slot.pos}</text>
      </g>`;
    }).join('');
  }

  function initCoverflow(root, items, onOpen) {
    if (!root) return;
    const track = $('.cf-track', root);
    const dots = $('.cf-dots', root);
    if (!track || !dots) return;
    track.innerHTML = items.map(sessionCardHTML).join('');
    dots.innerHTML = items.map((_, i) => `<button data-i="${i}" aria-label="第 ${i + 1} 次训练"></button>`).join('');
    let index = 0;
    const cards = Array.from(track.children);
    const dbtns = Array.from(dots.children);

    const layout = () => {
      cards.forEach((card, i) => {
        const off = i - index;
        const abs = Math.abs(off);
        card.style.opacity = abs > 2 ? 0 : String((1 - abs * 0.18).toFixed(2));
        card.style.pointerEvents = abs > 2 ? 'none' : 'auto';
        card.style.transform = `translateX(${off * 160}px) translateZ(${-abs * 150}px) rotateY(${off * -23}deg) scale(${1 - abs * 0.055})`;
        card.style.zIndex = String(20 - abs);
        card.classList.toggle('is-active', off === 0);
        card.classList.toggle('is-far', abs > 0);
      });
      dbtns.forEach((d, i) => d.classList.toggle('active', i === index));
    };
    const goTo = (i) => { index = (i + items.length) % items.length; layout(); };
    root.querySelectorAll('.cf-arrow').forEach((btn) => {
      btn.onclick = () => goTo(index + (btn.dataset.cf === 'next' ? 1 : -1));
    });
    dbtns.forEach((d, i) => { d.onclick = () => goTo(i); });
    cards.forEach((card, i) => {
      card.addEventListener('click', () => {
        if (root._dragged) return;
        if (i !== index) goTo(i);
        else if (onOpen) onOpen(items[i]);
      });
    });
    let sx = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cf-arrow,.cf-dots')) return;
      sx = e.clientX; root._dragged = false;
    });
    root.addEventListener('pointermove', (e) => {
      if (sx !== null && Math.abs(e.clientX - sx) > 10) root._dragged = true;
    });
    root.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 44) goTo(index + (dx < 0 ? 1 : -1));
      setTimeout(() => { root._dragged = false; }, 80);
    });
    root.addEventListener('pointerleave', () => { sx = null; });
    clearInterval(root._timer);
    root._timer = setInterval(() => { if (!root.matches(':hover')) goTo(index + 1); }, 7000);
    layout();
  }

  function sessionCardHTML(s) {
    const d = parseKey(s.date);
    const st = sessionStatus(s);
    const c = sessionCounts(s);
    const total = db.players.length;
    const colors = s.templateId === 'tue' ? ['#7b6cff', '#46e0ff']
      : s.templateId === 'fri' ? ['#46e0ff', '#37e39b']
        : s.templateId === 'sun' ? ['#ffbb55', '#ff7a59']
          : ['#8f82ff', '#fb7299'];
    const statusClass = st.key === 'cancelled' ? 'loss' : st.key === 'done' ? 'win' : '';
    const mid = s.status === 'cancelled'
      ? '<div class="cf-score" style="font-size:17px">已取消</div>'
      : (total ? `<div class="cf-score" style="font-size:18px">${c.marked}/${total}<i>已登记</i></div>` : '<div class="cf-score" style="font-size:14px">先添加队员</div>');
    return `<article class="cf-card" data-session="${s.id}" style="--a:${colors[0]};--b:${colors[1]}">
      <div class="cf-inner">
        <div class="cf-top"><span class="cf-comp">本周训练</span><span class="cf-status ${statusClass}">${st.text}</span></div>
        <div class="cf-crest" style="background:linear-gradient(140deg,${colors[0]},${colors[1]})">${d.getDate()}</div>
        <div class="cf-opp">${WEEK_CN[d.getDay()]}训练</div>
        <div class="cf-sub">${esc(s.start)} – ${esc(s.end)} · ${esc(s.venue || '地点待定')}</div>
        <div class="cf-mid">${mid}<div class="cf-foot"><span>${fmtMD(d)}</span><span>${s.templateId ? '固定模板' : '加练'}</span></div></div>
      </div>
    </article>`;
  }

  function renderDashSessions(stats) {
    const root = $('#dashCoverflow');
    const wrap = $('#dashSessions');
    const empty = $('#dashSessionsEmpty');
    if (!stats.sessions.length) {
      wrap.hidden = true;
      empty.hidden = false;
      empty.innerHTML = emptyState('📅', '本周还没有训练安排', '可以按固定模板重新生成，或者单独加一次训练。', '<button class="btn btn-primary" data-action="reset-week">按模板生成</button><button class="btn btn-ghost" data-action="add-session">添加加练</button>');
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;
    root.hidden = false;
    initCoverflow(root, stats.sessions, (s) => {
      state.weekMonday = getMonday(parseKey(s.date));
      go('attendance');
    });
  }

  function renderDashRing(stats) {
    const rate = stats.rate;
    const ring = $('#dashRing .ring-value');
    const C = 452.4;
    ring.style.strokeDashoffset = String(rate == null ? C : C * (1 - rate / 100));
    ring.style.stroke = rate == null ? 'rgba(255,255,255,.18)' : rate >= 90 ? 'var(--green)' : rate >= 60 ? 'var(--amber)' : 'var(--red)';
    $('#dashRate').textContent = rate == null ? '—' : rate;
    const dashPct = $('.ring-hero .ring-center span');
    if (dashPct) dashPct.style.display = rate == null ? 'none' : '';
    $('#dashMarkedNote').textContent = db.players.length ? `已登记 ${stats.counts.marked} / ${stats.totalCells} 项` : '还没有队员';
    const tag = $('#dashRateTag');
    tag.hidden = rate == null;
    if (rate != null) {
      tag.textContent = rate >= 90 ? '达标' : '待提升';
      tag.className = `tag-pill ${rate >= 90 ? 'green' : 'amber'}`;
    }
    $('#dashLegendPresent').textContent = stats.counts.present;
    $('#dashLegendLate').textContent = stats.counts.late;
    $('#dashLegendLeave').textContent = stats.counts.leave;
    $('#dashLegendAbsent').textContent = stats.counts.absent;
  }

  function renderStack() {
    const logs = db.skillLogs.slice().sort((a, b) => b.at - a.at).slice(0, 6);
    const stack = $('#stack');
    const wrap = $('#stackWrap');
    const empty = $('#stackEmpty');
    const btn = $('#stackToggle');
    if (!logs.length) {
      wrap.hidden = true;
      empty.hidden = false;
      btn.hidden = true;
      empty.innerHTML = miniEmpty('还没有技能调整。去成长页给队员加减技能点，这里会留下记录。');
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;
    btn.hidden = false;
    stack.dataset.count = String(logs.length);
    stack.innerHTML = logs.map((l) => {
      const p = getPlayer(l.playerId);
      if (!p) return '';
      const d = l.date ? parseKey(l.date) : new Date(l.at);
      const sign = l.delta > 0 ? '+' : '';
      return `<article class="stack-card" data-player="${p.id}">
        <span class="sc-date"><b>${d.getDate()}</b><em>${d.getMonth() + 1}月</em></span>
        <div class="sc-main"><strong>${esc(p.name)} · ${skillLabel(l.skill)} ${sign}${l.delta.toFixed(1)}</strong><span>${sourceLabel(l.source)} · ${fmtMD(d)}</span></div>
        <span class="sc-count ${l.delta > 0 ? '' : 'down'}" title="当前 ${l.after.toFixed(1)} 分">${l.after.toFixed(1)}</span>
      </article>`;
    }).join('');
    const open = state.stackOpen;
    stack.classList.toggle('open', open);
    stack.style.height = open ? `${Math.max(96, logs.length * 96)}px` : '96px';
    btn.classList.toggle('on', open);
    btn.querySelector('span').textContent = open ? '收起' : '展开';
  }

  function renderTeamRadar(avgSkills, avg) {
    const el = $('#teamRadar');
    const tag = $('#radarTag');
    if (!avgSkills) {
      el.innerHTML = miniEmpty('添加队员后显示全队技能雷达。');
      tag.hidden = true;
      return;
    }
    el.innerHTML = radarSVG10(avgSkills, 250, avg.toFixed(1));
    tag.hidden = false;
    tag.textContent = `均值 ${avg.toFixed(1)}`;
  }

  function heatColor(rate, cancelled) {
    if (cancelled) return 'rgba(255,107,138,.13)';
    if (rate == null) return 'rgba(255,255,255,.045)';
    if (rate >= 90) return 'rgba(255,187,85,.62)';
    if (rate >= 75) return 'rgba(123,108,255,.55)';
    if (rate >= 50) return 'rgba(123,108,255,.35)';
    return 'rgba(123,108,255,.2)';
  }

  function renderHeatmap() {
    const el = $('#heatmap');
    const tag = $('#heatTag');
    if (!db.players.length) {
      el.innerHTML = miniEmpty('添加队员并登记考勤后，这里会出现出勤热力。');
      tag.hidden = true;
      $('#heatWeekRate').textContent = '—';
      $('#heatWeeks').textContent = '0';
      $('#heatSessions').textContent = '0';
      return;
    }
    tag.hidden = false;
    tag.textContent = '近 14 周';
    const thisMonday = getMonday(new Date());
    const weeks = Array.from({ length: 14 }, (_, i) => addDays(thisMonday, (i - 13) * 7));
    let totalSessions = 0;
    el.innerHTML = db.settings.template.map((t) => {
      const cells = weeks.map((m) => {
        const stored = Array.isArray(db.weeks[weekKey(m)]);
        if (!stored) return `<i class="heat-none" title="${fmtRange(m)} · 无记录"></i>`;
        const s = getSessions(m).find((x) => x.templateId === t.id);
        if (!s) return `<i class="heat-none" title="${fmtRange(m)} · 无训练"></i>`;
        if (s.status !== 'cancelled') totalSessions += 1;
        const c = sessionCounts(s);
        const cancelled = s.status === 'cancelled';
        const title = `${fmtDateCN(parseKey(s.date))} · ${cancelled ? (s.cancelReason || '已取消') : (c.rate == null ? '未登记' : `出勤 ${c.rate}%（${c.marked} 项）`)}`;
        return `<i style="background:${heatColor(c.rate, cancelled)}" title="${esc(title)}"></i>`;
      }).join('');
      return `<div class="heat2-row"><span class="heat2-label">${t.label.slice(-1)}</span><div class="heat2-cells">${cells}</div></div>`;
    }).join('');
    const stat = weekStats(thisMonday);
    $('#heatWeekRate').textContent = stat.rate == null ? '—' : `${stat.rate}%`;
    $('#heatWeeks').textContent = String(new Set(weeks.filter((m) => getSessions(m).some((s) => Object.keys(s.attendance || {}).length)).map((m) => weekKey(m))).size);
    $('#heatSessions').textContent = String(totalSessions);
  }

  /* ══════════ 人员管理 ══════════ */
  function renderRoster() {
    const q = state.rosterSearch.trim().toLowerCase();
    const list = db.players.filter((p) => {
      const okRole = state.rosterFilter === '全部' || p.position === state.rosterFilter;
      const okQ = !q || p.name.toLowerCase().includes(q) || String(p.number).includes(q);
      return okRole && okQ;
    });

    $('#rsCount').textContent = db.players.length;
    const avgH = db.players.length ? (db.players.reduce((a, p) => a + p.height, 0) / db.players.length).toFixed(1) : '—';
    $('#rsHeight').textContent = avgH;
    const avg = teamAverage();
    $('#rsAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#rsCoverage').textContent = `${new Set(db.players.map((p) => p.position)).size} / 5`;
    $('#rosterSub').textContent = db.players.length
      ? `${db.players.length} 名队员 · 平均身高 ${avgH}cm · 平均技能 ${avg.toFixed(1)} 分`
      : '还没有队员。从添加第一名队员开始。';

    $$('#roleFilters .chip').forEach((chip) => {
      const role = chip.dataset.role;
      const n = role === '全部' ? db.players.length : db.players.filter((p) => p.position === role).length;
      const i = chip.querySelector('i');
      if (i) i.textContent = n;
      chip.classList.toggle('active', chip.dataset.role === state.rosterFilter);
    });

    const grid = $('#rosterGrid');
    grid.innerHTML = list.map((p, i) => playerCardHTML(p, i)).join('');
    grid.hidden = list.length === 0;
    const empty = $('#rosterEmpty');
    if (list.length) empty.innerHTML = '';
    else if (!db.players.length) empty.innerHTML = emptyState('🏐', '还没有队员', '有现成名单的话用「批量导入」，粘贴一段表格就全进来了；也可以一个个填。', '<button class="btn btn-primary" data-action="bulk-import">批量导入名单</button><button class="btn btn-ghost" data-action="add-player">添加第一名队员</button>');
    else empty.innerHTML = emptyState('🔍', '没有匹配的队员', '换个关键词或位置筛选试试。', '<button class="btn btn-ghost" data-action="clear-filter">清除筛选</button>');

    attachTilt(grid);
    renderSidebar();
  }

  function playerCardHTML(p, i) {
    const [a, b] = positionStyle(p.position);
    const ov = overall(p);
    const strip = SKILLS.map((s) => {
      const v = Number(p.skills[s.key] || 0);
      return `<i style="background:${a};opacity:${(0.15 + (v / 10) * 0.85).toFixed(2)}" title="${s.label} ${v.toFixed(1)}"></i>`;
    }).join('');
    return `<article class="player-card card-spot" data-id="${p.id}" style="--a:${a};--b:${b};--i:${i}">
      <div class="pc-top"><div class="pc-avatar">${esc(p.name[0] || '?')}</div><div class="pc-num">${pad2(p.number)}</div></div>
      <div class="pc-info"><h3 class="pc-name">${esc(p.name)}</h3><div class="pc-meta">${p.position} · ${p.grade} · ${p.height}cm</div></div>
      <div class="pc-score-row">
        <div class="pc-overall"><b>${ov.toFixed(1)}</b><span>综合</span></div>
        <div class="pc-strip">${strip}</div>
      </div>
      <div class="pc-foot"><span class="pc-state">6 项技能 · ${relTime(p.updatedAt)}</span><span class="pc-open">查看档案 →</span></div>
    </article>`;
  }

  function attachTilt(root) {
    $$('.player-card', root).forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', `${((0.5 - py) * 5).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ══════════ 队员表单 / 抽屉 ══════════ */
  function skillInputsHTML(values) {
    return `<div class="skill-form">${SKILLS.map((s) => {
      const v = values ? Number(values[s.key] || 0) : 5;
      return `<label class="skill-field"><span>${s.label}</span><input name="skill_${s.key}" type="number" min="0" max="10" step="0.5" value="${v.toFixed(1)}"></label>`;
    }).join('')}</div>`;
  }

  function openPlayerForm(playerId, opts) {
    const o = opts || {};
    const p = playerId ? getPlayer(playerId) : null;
    if (playerId && !p) return;
    const title = p ? `编辑 ${p.name}` : '新增队员';
    const body = `<form id="playerForm">
      <div class="form-grid">
        <div class="field"><label>姓名</label><input name="name" required maxlength="10" value="${p ? esc(p.name) : ''}" placeholder="例如：陈子昂"></div>
        <div class="field"><label>号码</label><input name="number" type="number" min="0" max="99" required value="${p ? p.number : ''}" placeholder="7"></div>
        <div class="field"><label>位置</label><select name="position">${POSITIONS.map((pos) => `<option ${((p && p.position) || o.position) === pos ? 'selected' : ''}>${pos}</option>`).join('')}</select></div>
        <div class="field"><label>年级</label><select name="grade">${GRADES.map((g) => `<option ${p && p.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field full"><label>身高 (cm)</label><input name="height" type="number" min="140" max="230" required value="${p ? p.height : ''}" placeholder="185"></div>
      </div>
      ${p ? `<div class="form-note">技能点在成长计划里调整，编辑资料不会改动技能。</div>`
        : `<div class="form-section-title"><span>初始技能点</span><button type="button" class="btn-mini" id="fillFive">全部 5.0</button></div>${skillInputsHTML(null)}<div class="form-note">0–10 分，步进 0.5。之后每次训练或比赛后到成长页加减。</div>`}
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="submit" class="btn btn-primary">${p ? '保存资料' : '加入球队'}</button></div>
    </form>`;
    openModal(title, body, { mid: !p });
    const form = $('#playerForm');
    if (!p) {
      $('#fillFive').onclick = () => {
        SKILLS.forEach((s) => { const input = form.querySelector(`[name="skill_${s.key}"]`); if (input) input.value = '5.0'; });
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      const number = Number(fd.get('number'));
      const height = Number(fd.get('height'));
      if (!name) { toast('姓名不能为空', 'warn'); return; }
      if (!Number.isInteger(number) || number < 0 || number > 99) { toast('号码需要 0–99 的整数', 'warn'); return; }
      if (!height || height < 140 || height > 230) { toast('身高需要在 140–230cm 之间', 'warn'); return; }
      const dup = db.players.find((x) => x.number === number && x.id !== (p && p.id));
      if (dup) { toast(`号码 ${number} 已经被 ${dup.name} 使用`, 'warn'); return; }
      if (p) {
        const payload = { name, number, height, position: String(fd.get('position')), grade: String(fd.get('grade')) };
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.playerUpdate(p.id, payload);
            Object.assign(p, normalizePlayer(resp.player));
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          Object.assign(p, payload);
          p.updatedAt = Date.now();
        }
        save(); closeModal(); renderRoster(); renderDashboard();
        if ($('#drawer').classList.contains('open')) openPlayer(p.id);
        toast('队员资料已更新');
      } else {
        const skills = {};
        SKILLS.forEach((s) => {
          const v = Number(fd.get(`skill_${s.key}`));
          skills[s.key] = clamp(roundHalf(Number.isFinite(v) ? v : 5), 0, 10);
        });
        const payload = { name, number, height, position: String(fd.get('position')), grade: String(fd.get('grade')), skills };
        let np;
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.playerCreate(payload);
            np = normalizePlayer(resp.player);
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          np = normalizePlayer({ id: uid('p'), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
        }
        db.players.push(np);
        save(); closeModal(); renderRoster(); renderDashboard(); renderSidebar(); renderActivity();
        if (state.page !== 'roster') go('roster');
        toast(`${np.name} 已加入球队`);
        setTimeout(() => openPlayer(np.id), 260);
      }
    };
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* 走兜底 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ══════════ 批量导入名单 ══════════ */
  const IMPORT_FIELDS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '名字', '队员', 'name'] },
    { key: 'number', label: '号码', aliases: ['号码', '球衣号', '号', 'number'] },
    { key: 'position', label: '位置', aliases: ['位置', '场上位置', '司职', 'position'] },
    { key: 'grade', label: '年级', aliases: ['年级', '年级/班级', 'grade'] },
    { key: 'height', label: '身高', aliases: ['身高', '身高(cm)', '身高cm', 'height'] }
  ];

  function splitRow(line) {
    let cells = line.split('\t');
    if (cells.length < 2) cells = line.split(/[,，]/);
    if (cells.length < 2) cells = line.split(/[|｜]/);
    if (cells.length < 2) cells = line.split(/\s{2,}/);
    if (cells.length < 2) cells = line.trim().split(/\s+/);
    return cells.map((c) => String(c).trim()).filter((c, i, a) => !(c === '' && i === a.length - 1));
  }

  function normalizeImportPosition(raw) {
    const s = String(raw || '');
    if (s.includes('接应')) return '接应';
    if (s.includes('二传')) return '二传';
    if (s.includes('副攻')) return '副攻';
    if (s.includes('主攻')) return '主攻';
    if (s.includes('自由') || /^(l|lib)$/i.test(s)) return '自由人';
    return '';
  }

  function normalizeImportGrade(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const hit = GRADES.find((g) => s.includes(g));
    if (hit) return hit;
    const m = s.match(/([一二三四1-4])年级?/);
    if (m) {
      const map = { 一: '大一', 二: '大二', 三: '大三', 四: '大四', 1: '大一', 2: '大二', 3: '大三', 4: '大四' };
      return map[m[1]] || '';
    }
    const y = s.match(/研([一二三1-3])/);
    if (y) {
      const map = { 一: '研一', 二: '研二', 三: '研三', 1: '研一', 2: '研二', 3: '研三' };
      return map[y[1]] || '';
    }
    return s.slice(0, 8);
  }

  function normalizeImportNumber(raw) {
    const s = String(raw || '').replace(/[号#]/g, '').replace(/^no\.?/i, '').trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }

  function normalizeImportHeight(raw) {
    const s = String(raw || '').toLowerCase().replace(/cm|厘米|公分/g, '').trim();
    if (!s) return NaN;
    let n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    if (n > 0 && n < 3) n = n * 100; // 1.88 这种写法
    return Math.round(n);
  }

  /** 把粘贴进来的一段文本解析成待导入行，含每行的问题标注 */
  function parseRosterText(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { rows: [], header: false };

    // 表头识别：单字别名（如「号」）必须完全相等，避免把「5号」这种数据行当表头
    const matchField = (cell) => IMPORT_FIELDS.find((f) => f.aliases.some((a) => cell === a || (a.length >= 2 && cell.includes(a))));
    const first = splitRow(lines[0]).map((c) => c.toLowerCase());
    const firstHits = first.map(matchField).filter(Boolean);
    const header = new Set(firstHits.map((f) => f.key)).size >= 2;
    const cols = {};
    if (header) {
      first.forEach((c, i) => {
        const f = matchField(c);
        if (f && cols[f.key] === undefined) cols[f.key] = i;
      });
    } else {
      IMPORT_FIELDS.forEach((f, i) => { cols[f.key] = i; });
    }

    const used = new Set(db.players.map((p) => p.number));
    const rows = [];
    lines.slice(header ? 1 : 0).forEach((rawLine) => {
      // 接龙里的序号：「1. 张三 …」「2、张三 …」，整行层面先剥掉
      const line = rawLine.replace(/^\s*\d{1,2}\s*[.、)．:：]\s*/, '');
      let cells = splitRow(line);
      // 剥不干净时（如「1.」独立成列）再按列丢一次
      if (cells.length >= 4 && /^\d{1,2}\s*[.、)．:：]$/.test(cells[0])) cells = cells.slice(1);
      const pick = (k) => (cols[k] === undefined ? '' : (cells[cols[k]] || ''));
      const raw = {
        name: String(pick('name') || '').trim().slice(0, 10),
        number: normalizeImportNumber(pick('number')),
        position: normalizeImportPosition(pick('position')),
        grade: normalizeImportGrade(pick('grade')),
        height: normalizeImportHeight(pick('height'))
      };
      const issues = [];
      if (!raw.name) issues.push({ level: 'err', text: '缺姓名' });
      if (!Number.isFinite(raw.number) || raw.number < 0 || raw.number > 99) issues.push({ level: 'err', text: '号码无效' });
      else if (used.has(raw.number)) issues.push({ level: 'err', text: `号码 ${raw.number} 重复` });
      if (!Number.isFinite(raw.height) || raw.height < 140 || raw.height > 230) issues.push({ level: 'err', text: '身高异常' });
      if (!raw.position) { raw.position = '主攻'; issues.push({ level: 'warn', text: '位置未知，按主攻' }); }
      if (!raw.grade) { raw.grade = '大一'; issues.push({ level: 'warn', text: '年级未知，按大一' }); }
      if (Number.isFinite(raw.number)) used.add(raw.number);
      rows.push({ raw, issues, on: issues.every((i) => i.level !== 'err') });
    });
    return { rows, header };
  }

  function openBulkImport() {
    const sample = '姓名\t号码\t位置\t年级\t身高\n张辰\t1\t主攻\t大三\t188\n李睿\t7\t二传\t大二\t182';
    const body = `<div class="import-wrap">
      <div class="import-help">
        从 Excel / 腾讯文档 / 金山表格整块复制，直接粘贴进来就行；也认逗号、空格分隔的接龙文本（如 <code>1. 张辰 1号 主攻 大三 188</code>）。
        带表头会自动识别列，没表头按 <b>姓名 号码 位置 年级 身高</b> 顺序读。
      </div>
      <textarea id="importText" class="import-input" rows="7" spellcheck="false" placeholder="姓名	号码	位置	年级	身高
张辰	1	主攻	大三	188
李睿	7	二传	大二	182"></textarea>
      <div class="import-actions-row">
        <button type="button" class="btn-mini" id="importTpl">复制收集模板</button>
        <button type="button" class="btn-mini" id="importSample">填入示例</button>
        <button type="button" class="btn-mini" id="importClear">清空</button>
        <span class="import-hint" id="importHint"></span>
      </div>
      <div id="importPreview" class="import-preview"></div>
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="button" class="btn btn-primary" id="importGo" disabled>导入</button></div>
    </div>`;
    openModal('批量导入队员', body, { wide: true });

    const ta = $('#importText');
    const preview = $('#importPreview');
    const go = $('#importGo');
    const hint = $('#importHint');
    let parsed = { rows: [], header: false };

    function repaint() {
      parsed = parseRosterText(ta.value);
      const ok = parsed.rows.filter((r) => r.on).length;
      const bad = parsed.rows.length - ok;
      hint.textContent = parsed.rows.length
        ? `识别到 ${parsed.rows.length} 行 · 可导入 ${ok} 行${bad ? ` · ${bad} 行有问题` : ''}`
        : '';
      go.disabled = ok === 0;
      if (!parsed.rows.length) { preview.innerHTML = ''; return; }
      preview.innerHTML = `<div class="ip-head">
          <span>共 ${parsed.rows.length} 行${parsed.header ? '（已识别表头）' : ''}</span>
          <button type="button" class="btn-mini" id="importToggle">反选可导入行</button>
        </div>
        <div class="ip-table">
        ${parsed.rows.map((r, i) => `<div class="ip-row${r.on ? '' : ' off'}">
            <label class="ip-check"><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} ${r.issues.some((x) => x.level === 'err') ? 'disabled' : ''}></label>
            <span class="ip-num">${Number.isFinite(r.raw.number) ? pad2(r.raw.number) : '—'}</span>
            <span class="ip-name">${esc(r.raw.name || '（无名）')}</span>
            <span class="ip-pos">${esc(r.raw.position)}</span>
            <span class="ip-grade">${esc(r.raw.grade)}</span>
            <span class="ip-h">${Number.isFinite(r.raw.height) ? r.raw.height + 'cm' : '—'}</span>
            <span class="ip-issue">${r.issues.map((x) => `<i class="ip-tag ${x.level}">${esc(x.text)}</i>`).join('')}</span>
          </div>`).join('')}
        </div>`;
      const toggle = $('#importToggle');
      if (toggle) toggle.onclick = () => {
        parsed.rows.forEach((r) => { if (r.issues.every((x) => x.level !== 'err')) r.on = !r.on; });
        preview.querySelectorAll('.ip-check input').forEach((cb) => {
          const r = parsed.rows[Number(cb.dataset.i)];
          cb.checked = r.on;
          cb.closest('.ip-row').classList.toggle('off', !r.on);
        });
        go.disabled = parsed.rows.filter((r) => r.on).length === 0;
      };
      preview.querySelectorAll('.ip-check input').forEach((cb) => {
        cb.onchange = () => {
          const r = parsed.rows[Number(cb.dataset.i)];
          r.on = cb.checked;
          cb.closest('.ip-row').classList.toggle('off', !r.on);
          go.disabled = parsed.rows.filter((x) => x.on).length === 0;
        };
      });
    }

    ta.addEventListener('input', repaint);
    ta.addEventListener('paste', () => setTimeout(repaint, 0));
    $('#importTpl').onclick = () => {
      const tpl = '姓名\t号码\t位置\t年级\t身高\n'
        + '（每个人复制上一行，改成自己的，接在下面，别删第一行）\n\n'
        + '位置填：主攻 / 副攻 / 二传 / 接应 / 自由人\n';
      copyText(tpl) ? toast('收集模板已复制，发到群里让大家接龙')
        : toast('复制失败，手动选中模板文字复制', 'warn');
    };
    $('#importSample').onclick = () => { ta.value = sample; repaint(); ta.focus(); };
    $('#importClear').onclick = () => { ta.value = ''; repaint(); ta.focus(); };

    go.onclick = async () => {
      const picked = parsed.rows.filter((r) => r.on);
      if (!picked.length) return;
      const cloud = CloudOn();
      go.disabled = true;
      let done = 0;
      let failed = 0;
      for (const r of picked) {
        const payload = {
          name: r.raw.name, number: r.raw.number, position: r.raw.position,
          grade: r.raw.grade, height: r.raw.height,
          skills: SKILLS.reduce((o, s) => { o[s.key] = 5; return o; }, {})
        };
        try {
          const np = cloud
            ? normalizePlayer((await window.XGYCloud.push.playerCreate(payload)).player)
            : normalizePlayer({ id: uid('p'), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
          db.players.push(np);
          done += 1;
        } catch (err) { failed += 1; }
      }
      save(); closeModal(); renderRoster(); renderDashboard(); renderSidebar(); renderActivity();
      if (state.page !== 'roster') go('roster');
      toast(failed ? `导入 ${done} 人，${failed} 人失败` : `已导入 ${done} 名队员`);
    };
    repaint();
    ta.focus();
  }

  function openPlayer(id) {
    const p = getPlayer(id);
    if (!p) return;
    const [a, b] = positionStyle(p.position);
    const logs = db.skillLogs.filter((l) => l.playerId === p.id).sort((x, y) => y.at - x.at).slice(0, 20);
    const best = SKILLS.slice().sort((s1, s2) => Number(p.skills[s2.key]) - Number(p.skills[s1.key]))[0];
    const stats = weekStats(getMonday(new Date()));
    const me = stats.perPlayer.get(p.id) || { present: 0, late: 0, leave: 0, absent: 0, marked: 0 };
    $('#drawerBody').innerHTML = `
      <div class="dr-hero">
        <span class="dr-num">${pad2(p.number)}</span>
        <div class="dr-top">
          <span class="u-avatar" style="--a:${a};--b:${b}">${esc(p.name[0] || '?')}</span>
          <div>
            <h3>${esc(p.name)}</h3>
            <p>${p.position} · ${p.grade} · ${p.height}cm</p>
            <div class="dr-tags"><span class="dr-tag v">${p.position}</span><span class="dr-tag">${p.number} 号</span><span class="dr-tag">${overall(p).toFixed(1)} 分</span></div>
          </div>
        </div>
      </div>
      <div class="dr-stats">
        <div class="dr-stat"><b>${overall(p).toFixed(1)}</b><span>综合评分</span></div>
        <div class="dr-stat"><b>${skillLabel(best.key)}</b><span>最强项 ${Number(p.skills[best.key]).toFixed(1)}</span></div>
        <div class="dr-stat"><b>${me.marked ? Math.round(((me.present + me.late) / me.marked) * 100) + '%' : '—'}</b><span>本周出勤</span></div>
      </div>
      <div class="dr-section"><h4>能力雷达</h4><div class="radar-box">${radarSVG10(SKILLS.map((s) => Number(p.skills[s.key])), 230)}</div></div>
      <div class="dr-section"><h4>技术细项</h4><div class="dr-skill">${SKILLS.map((s) => `<div class="skill-item"><span>${s.label}</span><div class="skill-bar"><i style="width:${Number(p.skills[s.key]) * 10}%"></i></div><b>${Number(p.skills[s.key]).toFixed(1)}</b></div>`).join('')}</div></div>
      <div class="dr-section"><h4>调整记录</h4><div class="log-list">${logs.length ? logs.map((l) => {
        const d = l.date ? parseKey(l.date) : new Date(l.at);
        return `<div class="log-row"><span class="log-date">${fmtMD(d)}</span><span class="log-skill">${skillLabel(l.skill)}</span><span class="log-delta ${l.delta >= 0 ? 'up' : 'down'}">${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}</span><b>${l.after.toFixed(1)}</b><em class="log-source">${sourceLabel(l.source)}</em></div>`;
      }).join('') : '<div class="mini-empty small">还没有调整记录。</div>'}</div></div>
      <div class="dr-actions"><button class="btn btn-ghost" data-action="edit-player" data-player="${p.id}">编辑资料</button><button class="btn btn-danger-ghost" data-action="delete-player" data-player="${p.id}">删除队员</button></div>
      <p class="form-note">删除队员会同时删除他的考勤和技能调整记录。</p>`;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawerScrim').classList.add('show');
    closePopovers();
    syncLock();
  }

  async function deletePlayer(id) {
    const p = getPlayer(id);
    if (!p) return;
    const ok = await confirmDialog({ title: `删除 ${p.name}？`, message: '会同时删除他的全部考勤记录和技能调整记录。这个操作无法撤销。', ok: '确认删除' });
    if (!ok) return;
    if (CloudOn()) {
      try { await window.XGYCloud.push.playerDelete(id); }
      catch (err) { toast(`删除失败：${err.message}`, 'warn'); return; }
    }
    db.players = db.players.filter((x) => x.id !== id);
    Object.keys(db.weeks).forEach((k) => (db.weeks[k] || []).forEach((s) => { if (s.attendance) delete s.attendance[id]; }));
    db.skillLogs = db.skillLogs.filter((l) => l.playerId !== id);
    save();
    closeDrawer();
    renderAllCurrent();
    toast(`${p.name} 已从球队删除`);
  }

  /* ══════════ 考勤 ══════════ */
  const ATT_CYCLE = ['', 'present', 'late', 'leave', 'absent'];
  const ATT_LABEL = { present: '出勤', late: '迟到', leave: '请假', absent: '缺席', '': '登记' };

  function renderAttendance() {
    cloudEnsureWeek(state.weekMonday);
    const monday = state.weekMonday;
    const stats = weekStats(monday);
    $('#weekLabel').textContent = weekRelativeLabel(monday);
    $('#weekRange').textContent = fmtRange(monday);

    if (!db.players.length) {
      $('#attBody').hidden = true;
      $('#attNoPlayers').hidden = false;
      $('#attNoPlayers').innerHTML = emptyState('🏐', '先添加队员', '没有队员就没办法登记考勤。先到人员管理添加第一名队员。', '<button class="btn btn-primary" data-action="add-player">添加队员</button><button class="btn btn-ghost" data-goto="roster">去人员管理</button>');
      renderSidebar();
      return;
    }
    $('#attBody').hidden = false;
    $('#attNoPlayers').hidden = true;
    $('#attNoPlayers').innerHTML = '';

    renderAttSummary(stats);
    if (!stats.sessions.length) {
      $('#attGrid').hidden = true;
      $('#attEmpty').innerHTML = emptyState('📅', '本周没有训练安排', '这次训练可能被删掉了。可以按模板重新生成，或者单独加一次。', '<button class="btn btn-primary" data-action="reset-week">按模板生成</button><button class="btn btn-ghost" data-action="add-session">添加加练</button>');
      $('#allPresent').disabled = true;
    } else {
      $('#attGrid').hidden = false;
      $('#attEmpty').innerHTML = '';
      $('#allPresent').disabled = false;
      renderAttGrid(stats);
    }
    renderAttSide(stats);
    renderSidebar();
  }

  function weekRelativeLabel(monday) {
    const cur = getMonday(new Date());
    const diff = Math.round((monday - cur) / (7 * 86400000));
    if (diff === 0) return '本周';
    if (diff === -1) return '上周';
    if (diff === 1) return '下周';
    return fmtRange(monday);
  }

  function renderAttSummary(stats) {
    $('#sumRate').innerHTML = stats.rate == null ? '—' : `${stats.rate}<em>%</em>`;
    $('#sumPerfect').textContent = stats.perfect;
    $('#sumLate').textContent = stats.counts.late;
    $('#sumAbsent').textContent = stats.counts.absent;
    $('#attNote').textContent = `${stats.sessions.length} 次训练 · 已登记 ${stats.counts.marked} / ${stats.totalCells} 项`;
  }

  function renderAttGrid(stats) {
    const sessions = stats.sessions;
    const n = sessions.length;
    const cols = `clamp(140px, 18vw, 180px) repeat(${n}, minmax(106px,1fr)) 62px`;
    let html = `<div class="att-row att-head-row" style="grid-template-columns:${cols}">
      <div>队员</div>
      ${sessions.map((s) => {
        const d = parseKey(s.date);
        const st = sessionStatus(s);
        const c = sessionCounts(s);
        return `<button class="att-session-head ${st.cls}" data-session="${s.id}" title="点击编辑本次训练">
          <span class="ash-day">${WEEK_CN[d.getDay()]}</span><span class="ash-date">${d.getMonth() + 1}/${d.getDate()}</span>
          <span class="ash-time">${s.start}–${s.end}</span><span class="ash-status">${st.text}${s.status === 'cancelled' ? '' : ` · ${c.marked}/${db.players.length}`}</span><i class="ash-more">⋯</i>
        </button>`;
      }).join('')}
      <div>全勤</div>
    </div>`;
    db.players.forEach((p) => {
      const [a, b] = positionStyle(p.position);
      const r = stats.perPlayer.get(p.id) || { present: 0, marked: 0 };
      const perfect = stats.active.length > 0 && r.marked === stats.active.length && r.present === stats.active.length;
      html += `<div class="att-row" style="grid-template-columns:${cols}" data-player-row="${p.id}">
        <div class="att-player"><span class="u-avatar" style="--a:${a};--b:${b}">${esc(p.name[0] || '?')}</span><strong>${esc(p.name)}</strong><em>${p.position}</em></div>
        ${sessions.map((s) => {
          if (s.status === 'cancelled') return `<button class="att-cell disabled" disabled title="${esc(s.cancelReason || '已取消')}">取消</button>`;
          const st = s.attendance[p.id] || '';
          return `<button class="att-cell ${st || 'unmarked'}" data-session="${s.id}" data-player="${p.id}" title="点击切换：未登记 / 出勤 / 迟到 / 请假 / 缺席"><i></i>${ATT_LABEL[st]}</button>`;
        }).join('')}
        <div class="att-perfect ${perfect ? 'done' : ''}" data-perfect="${p.id}">${perfect ? '全勤' : '—'}</div>
      </div>`;
    });
    $('#attGrid').innerHTML = html;
  }

  /* ══════════ 阵容完整度：排球特有的领域指标 ══════════
   * 出勤率回答「来了多少人」，这个回答「缺谁、还能练什么」。
   * 判据：本周至少到过一次（出勤/迟到）就算在；请假/缺席/未登记不算。 */
  const POS_CONSEQ = {
    '主攻': '四号位强攻和一传反轮练不了',
    '副攻': '拦网配合和三号位快攻练不了',
    '二传': '进攻组织整个跑不起来',
    '接应': '二号位进攻和右路防守练不了',
    '自由人': '防守轮转和垫球串联练不了'
  };

  function lineupIntegrity(monday) {
    const active = getSessions(monday).filter((s) => s.status !== 'cancelled');
    const came = new Set();
    active.forEach((s) => db.players.forEach((p) => {
      const st = s.attendance[p.id];
      if (st === 'present' || st === 'late') came.add(p.position);
    }));
    return {
      sessions: active.length,
      on: POSITIONS.filter((x) => came.has(x)),
      missing: POSITIONS.filter((x) => !came.has(x))
    };
  }

  function renderLineup(li) {
    const grid = $('#lineupGrid');
    const note = $('#lineupNote');
    if (!grid || !note) return;
    if (!db.players.length || !li.sessions) {
      grid.innerHTML = POSITIONS.map((x) => `<span class="lu-chip dim">${x}</span>`).join('');
      note.innerHTML = `<p class="lu-mut">${db.players.length ? '本周还没有训练或还没人登记' : '先添加队员'}</p>`;
      return;
    }
    const posOf = {};
    db.players.forEach((p) => { (posOf[p.position] = posOf[p.position] || []).push(p); });
    grid.innerHTML = POSITIONS.map((x) => {
      const ok = li.on.includes(x);
      const names = (posOf[x] || []).filter((p) => li.on.includes(x)).map((p) => p.name);
      const title = ok ? `${x}：${names.join('、') || '—'} 本周到过` : `${x}：本周没人到过`;
      return `<span class="lu-chip ${ok ? 'on' : 'off'}" title="${esc(title)}">${ok ? '✓' : '✕'} ${x}</span>`;
    }).join('');
    if (!li.missing.length) {
      note.innerHTML = `<p class="lu-ok">五个位置都到过，战术课想怎么排就怎么排。</p>`;
    } else {
      note.innerHTML = li.missing.map((x) => `<p class="lu-bad"><b>缺${x}</b> · ${POS_CONSEQ[x]}</p>`).join('');
    }
  }

  function renderAttSide(stats) {
    paintDonut(stats);
    renderLineup(lineupIntegrity(state.weekMonday));
    const list = $('#sessionList');
    if (!stats.sessions.length) list.innerHTML = miniEmpty('本周没有训练。');
    else list.innerHTML = stats.sessions.map((s) => {
      const d = parseKey(s.date);
      const st = sessionStatus(s);
      const c = sessionCounts(s);
      const mark = s.status === 'cancelled' ? (s.cancelReason || '已取消') : `${c.marked}/${db.players.length} 已登记`;
      return `<button class="session-mini" data-session="${s.id}">
        <span class="sm-date"><b>${d.getDate()}</b><em>${WEEK_CN[d.getDay()]}</em></span>
        <span class="sm-main"><strong>${s.start}–${s.end}</strong><em>${esc(s.venue || '地点待定')} · ${st.text}</em></span>
        <span class="sm-status ${st.cls}">${mark}</span>
      </button>`;
    }).join('');
    const ex = [];
    stats.active.forEach((s) => {
      db.players.forEach((p) => {
        const st = s.attendance[p.id];
        if (st === 'late' || st === 'leave' || st === 'absent') ex.push({ p, st, s });
      });
    });
    const el = $('#exceptionList');
    if (!ex.length) el.innerHTML = miniEmpty('本周没有迟到、请假或缺席。');
    else el.innerHTML = ex.slice(0, 10).map((x) => `<div class="exception-item">
      <span class="u-avatar" style="--a:${positionStyle(x.p.position)[0]};--b:${positionStyle(x.p.position)[1]}">${esc(x.p.name[0])}</span>
      <strong>${esc(x.p.name)}</strong><span class="ex-tag ${x.st}">${ATT_LABEL[x.st]}</span><em>${fmtMD(parseKey(x.s.date))}</em>
    </div>`).join('') + (ex.length > 10 ? `<div class="exception-more">还有 ${ex.length - 10} 条未显示</div>` : '');
  }

  function paintDonut(stats) {
    const C = 389.6;
    const counts = stats.counts;
    const total = counts.marked || 1;
    let cum = 0;
    ['present', 'late', 'leave', 'absent'].forEach((k) => {
      const el = $(`#attDonut .d-seg[data-k="${k}"]`);
      if (!el) return;
      const len = counts.marked ? C * (counts[k] / total) : 0;
      el.setAttribute('stroke-dasharray', `${Math.max(0, len - 2)} ${C}`);
      el.setAttribute('stroke-dashoffset', String(-cum));
      cum += len;
    });
    $('#donutRate').textContent = stats.rate == null ? '—' : stats.rate;
    const donutPct = $('#attDonut') && $('.donut-center span');
    if (donutPct) donutPct.style.display = stats.rate == null ? 'none' : '';
    $('#donutLegend').innerHTML = ['present', 'late', 'leave', 'absent'].map((k) => {
      const pct = counts.marked ? Math.round((counts[k] / counts.marked) * 100) : 0;
      const dot = k === 'present' ? 'green' : k === 'late' ? 'amber' : k === 'leave' ? 'violet' : 'red';
      return `<div><i class="dot ${dot}"></i>${ATT_LABEL[k]}<b>${counts[k]}</b><em>${pct}%</em></div>`;
    }).join('');
  }

  function onAttCellClick(cell) {
    if (!cell || cell.disabled) return;
    const sid = cell.dataset.session;
    const pid = cell.dataset.player;
    if (CloudOn() && !Array.isArray(db.weeks[weekKey(state.weekMonday)])) {
      cloudEnsureWeek(state.weekMonday);
      return;
    }
    const sessions = ensureWeek(state.weekMonday);
    const s = sessions.find((x) => x.id === sid);
    if (!s || s.status === 'cancelled') return;
    const cur = s.attendance[pid] || '';
    const idx = ATT_CYCLE.indexOf(cur);
    const next = ATT_CYCLE[(idx + 1) % ATT_CYCLE.length];
    if (next) s.attendance[pid] = next; else delete s.attendance[pid];
    s.updatedAt = Date.now();
    save();
    if (CloudOn()) {
      const req = next
        ? window.XGYCloud.push.attSet(sid, pid, next)
        : window.XGYCloud.push.attClear(sid, pid);
      cloudFire(req, () => window.XGYCloud.syncWeek(weekKey(state.weekMonday), true).then(renderAttendance));
    }
    cell.className = `att-cell ${next || 'unmarked'}`;
    cell.innerHTML = `<i></i>${ATT_LABEL[next]}`;
    cell.classList.remove('pop');
    void cell.offsetWidth;
    cell.classList.add('pop');
    const stats = weekStats(state.weekMonday);
    renderAttSummary(stats);
    renderAttSide(stats);
    renderSidebar();
    const head = $(`.att-session-head[data-session="${sid}"]`);
    if (head) {
      const c = sessionCounts(s);
      const status = sessionStatus(s);
      const ash = $('.ash-status', head);
      if (ash) ash.textContent = `${status.text} · ${c.marked}/${db.players.length}`;
    }
    const r = stats.perPlayer.get(pid);
    const pcell = $(`.att-perfect[data-perfect="${pid}"]`);
    if (pcell && r) {
      const perfect = stats.active.length > 0 && r.marked === stats.active.length && r.present === stats.active.length;
      pcell.classList.toggle('done', perfect);
      pcell.textContent = perfect ? '全勤' : '—';
    }
  }

  async function setAllPresent() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const stats = weekStats(state.weekMonday);
    if (!stats.active.length) { toast('本周没有可登记的训练', 'warn'); return; }
    const ok = await confirmDialog({
      title: '一键全勤？',
      message: `会把本周 ${stats.active.length} 次未取消训练的所有队员都标记为出勤，覆盖已有记录。`,
      ok: '标记全勤', danger: false
    });
    if (!ok) return;
    const sessions = ensureWeek(state.weekMonday);
    sessions.forEach((s) => {
      if (s.status === 'cancelled') return;
      db.players.forEach((p) => { s.attendance[p.id] = 'present'; });
      s.updatedAt = Date.now();
    });
    save();
    if (CloudOn()) {
      const reqs = [];
      sessions.forEach((s) => {
        if (s.status === 'cancelled') return;
        db.players.forEach((p) => reqs.push(window.XGYCloud.push.attSet(s.id, p.id, 'present')));
      });
      cloudFire(Promise.all(reqs), () => window.XGYCloud.syncWeek(weekKey(state.weekMonday), true).then(renderAttendance));
    }
    renderAttendance();
    renderDashboard();
    toast('本周已标记为全勤');
  }

  /* ══════════ 训练弹窗 ══════════ */
  function openSessionModal(sessionId, monday, opts) {
    const o = opts || {};
    const isNew = !sessionId;
    let session;
    if (isNew) {
      const today = new Date();
      let date = addDays(monday, 1);
      if (today >= monday && today <= addDays(monday, 6)) date = startOfDay(today);
      const t = db.settings.template[0] || DEFAULT_TEMPLATE[0];
      session = {
        id: uid('s'), date: dateKey(date), start: t.start, end: t.end, venue: '',
        templateId: null, status: 'scheduled', cancelReason: '', attendance: {},
        createdAt: Date.now(), updatedAt: Date.now()
      };
    } else {
      const sessions = ensureWeek(monday);
      session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
    }
    const min = dateKey(monday);
    const max = dateKey(addDays(monday, 6));
    const body = `<form id="sessionForm">
      <div class="form-grid">
        <div class="field"><label>日期</label><input name="date" type="date" required min="${min}" max="${max}" value="${session.date}"></div>
        <div class="field"><label>地点</label><input name="venue" maxlength="24" value="${esc(session.venue)}" placeholder="体育馆 2 号场"></div>
        <div class="field"><label>开始</label><input name="start" type="time" required value="${session.start}"></div>
        <div class="field"><label>结束</label><input name="end" type="time" required value="${session.end}"></div>
      </div>
      <div class="form-note">改动只影响这一周，不会修改固定训练模板。${isNew ? '加练会单独出现在本周列表里。' : ''}</div>
      ${session.status === 'cancelled' ? `<div class="session-banner">本次已取消：${esc(session.cancelReason || '临时调整')}</div>` : ''}
      <div class="session-form-foot">
        <div class="session-danger">
          ${!isNew ? `<button type="button" class="btn btn-ghost" data-session-action="rain">因雨取消</button>` : ''}
          ${!isNew && session.status !== 'cancelled' ? `<button type="button" class="btn btn-ghost" data-session-action="cancel">取消本次</button>` : ''}
          ${!isNew && session.status === 'cancelled' ? `<button type="button" class="btn btn-ghost" data-session-action="restore">恢复训练</button>` : ''}
          ${!isNew ? `<button type="button" class="btn btn-danger-ghost" data-session-action="delete">删除本次</button>` : ''}
        </div>
        <div class="session-save"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="submit" class="btn btn-primary">保存</button></div>
      </div>
    </form>`;
    openModal(isNew ? '添加加练' : '编辑训练', body, { mid: true });
    const form = $('#sessionForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const date = String(fd.get('date'));
      const start = String(fd.get('start'));
      const end = String(fd.get('end'));
      const venue = String(fd.get('venue') || '').trim();
      if (date < min || date > max) { toast('日期需要在这一周内', 'warn'); return; }
      if (start >= end) { toast('结束时间需要晚于开始时间', 'warn'); return; }
      if (isNew) {
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.sessionCreate({ date, start, end, venue });
            const key = weekKey(monday);
            const created = normalizeSession(resp.session);
            if (created) {
              if (!Array.isArray(db.weeks[key])) db.weeks[key] = [];
              db.weeks[key].push(created);
              db.weeks[key].sort(sessionSort);
            }
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          const sessions = ensureWeek(monday);
          sessions.push({ ...session, date, start, end, venue });
          sessions.sort(sessionSort);
        }
        save(); closeModal(); state.weekMonday = getMonday(parseKey(date));
        renderAttendance(); renderDashboard();
        toast('加练已添加');
      } else {
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.sessionUpdate(session.id, { date, start, end, venue });
            const updated = normalizeSession(resp.session);
            if (updated) Object.assign(session, updated);
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          session.date = date; session.start = start; session.end = end; session.venue = venue;
          session.updatedAt = Date.now();
        }
        (db.weeks[weekKey(monday)] || []).sort(sessionSort);
        save(); closeModal(); state.weekMonday = getMonday(parseKey(date));
        renderAttendance(); renderDashboard();
        toast('本次训练已更新');
      }
    };
    $$('[data-session-action]', $('#modalBody')).forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.dataset.sessionAction;
        if (action === 'delete') {
          const marks = Object.keys(session.attendance || {}).length;
          if (marks) {
            const ok = await confirmDialog({ title: '删除这次训练？', message: `这次训练已经有 ${marks} 条考勤记录。删除会一起丢掉这些记录，无法恢复。`, ok: '确认删除' });
            if (!ok) return;
          }
          if (CloudOn()) {
            try { await window.XGYCloud.push.sessionDelete(session.id); }
            catch (err) { toast(`删除失败：${err.message}`, 'warn'); return; }
          }
          const key = weekKey(monday);
          db.weeks[key] = (db.weeks[key] || []).filter((s) => s.id !== session.id);
          save(); closeModal(); renderAttendance(); renderDashboard();
          toast('训练已删除');
          return;
        }
        const nextStatus = action === 'restore' ? 'scheduled' : 'cancelled';
        const nextReason = action === 'rain' ? '下雨' : action === 'cancel' ? '临时调整' : '';
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.sessionUpdate(session.id, { status: nextStatus, cancelReason: nextReason });
            const updated = normalizeSession(resp.session);
            if (updated) Object.assign(session, updated);
          } catch (err) { toast(`操作失败：${err.message}`, 'warn'); return; }
        } else {
          session.status = nextStatus;
          session.cancelReason = nextReason;
          session.updatedAt = Date.now();
        }
        save(); closeModal(); renderAttendance(); renderDashboard();
        toast(action === 'restore' ? '训练已恢复' : `已标记：${session.cancelReason}`);
      };
    });
  }

  /* ══════════ 成长计划 ══════════ */
  function renderGrowth() {
    const avg = teamAverage();
    const thisMonday = getMonday(new Date());
    const weekStart = dateKey(thisMonday);
    const weekEnd = dateKey(addDays(thisMonday, 6));
    const logsThisWeek = db.skillLogs.filter((l) => l.date >= weekStart && l.date <= weekEnd).length;
    const sorted = db.players.slice().sort((a, b) => overall(b) - overall(a));
    $('#gsAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#gsLogs').textContent = logsThisWeek;
    $('#gsTop').textContent = sorted.length ? `${sorted[0].name} ${overall(sorted[0]).toFixed(1)}` : '—';
    $('#gsCount').textContent = db.players.length;

    const matrix = $('#skillMatrix');
    if (!sorted.length) {
      matrix.innerHTML = '';
      $('#matrixEmpty').innerHTML = emptyState('📈', '还没有技能数据', '先添加队员并录入初始技能点，这里会出现全队技能矩阵。', '<button class="btn btn-primary" data-action="add-player">添加队员</button>');
      $('#matrixTag').hidden = true;
    } else {
      $('#matrixEmpty').innerHTML = '';
      $('#matrixTag').hidden = false;
      matrix.innerHTML = `<div class="matrix">
        <div class="matrix-head"><div>队员</div>${SKILLS.map((s) => `<div>${s.label}</div>`).join('')}<div>综合</div></div>
        ${sorted.map((p) => `<div class="matrix-row" data-player-row="${p.id}">
          <button class="m-name" data-open-player="${p.id}"><span class="m-avatar" style="--a:${positionStyle(p.position)[0]};--b:${positionStyle(p.position)[1]}">${esc(p.name[0])}</span><span><b>${esc(p.name)}</b><em>${p.position} · ${p.number} 号</em></span></button>
          ${SKILLS.map((s) => {
            const v = Number(p.skills[s.key] || 0);
            return `<button class="m-cell" data-player="${p.id}" data-skill="${s.key}" style="--v:${v / 10}" title="点击调整 ${esc(p.name)} 的${s.label}">${v.toFixed(1)}</button>`;
          }).join('')}
          <div class="m-overall">${overall(p).toFixed(1)}</div>
        </div>`).join('')}
      </div>`;
    }

    const logs = db.skillLogs.slice().sort((a, b) => b.at - a.at).slice(0, 10);
    const recent = $('#recentLogs');
    if (!logs.length) {
      recent.innerHTML = '';
      $('#recentEmpty').innerHTML = miniEmpty('还没有调整记录。点矩阵里的格子，或使用「训练后调整」。');
    } else {
      $('#recentEmpty').innerHTML = '';
      recent.innerHTML = logs.map((l) => {
        const p = getPlayer(l.playerId);
        if (!p) return '';
        const d = l.date ? parseKey(l.date) : new Date(l.at);
        return `<button class="log-row recent" data-open-player="${p.id}">
          <span class="log-date">${fmtMD(d)}</span>
          <span class="log-main"><b>${esc(p.name)}</b><em>${skillLabel(l.skill)}</em></span>
          <span class="log-delta ${l.delta >= 0 ? 'up' : 'down'}">${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}</span>
          <b class="log-after">${l.after.toFixed(1)}</b><em class="log-source">${sourceLabel(l.source)}</em>
        </button>`;
      }).join('');
    }
  }

  /* ══════════ 单项调整 ══════════ */
  function openAdjustModal(playerId, skillKey) {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const defaultPlayer = getPlayer(playerId) || db.players[0];
    const defaultSkill = skillKey && SKILLS.some((s) => s.key === skillKey) ? skillKey : 'serve';
    const body = `<form id="adjustForm">
      <div class="form-grid">
        <div class="field"><label>队员</label><select name="player">${db.players.map((p) => `<option value="${p.id}" ${p.id === defaultPlayer.id ? 'selected' : ''}>${esc(p.name)} · ${p.position}</option>`).join('')}</select></div>
        <div class="field"><label>技能</label><select name="skill">${SKILLS.map((s) => `<option value="${s.key}" ${s.key === defaultSkill ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        <div class="field"><label>来源</label><select name="source"><option value="training">训练</option><option value="match">比赛</option><option value="manual">手动</option></select></div>
        <div class="field"><label>日期</label><input type="date" name="date" value="${dateKey(new Date())}"></div>
      </div>
      <div class="adjust-preview"><div><span>当前</span><b id="adjustBefore">5.0</b></div><i>→</i><div><span>调整后</span><b id="adjustAfter">5.0</b></div></div>
      <div class="adjust-value"><button type="button" class="step-round" data-adjust-step="-0.5">−</button><input id="adjustInput" type="number" min="0" max="10" step="0.5" value="5.0"><button type="button" class="step-round" data-adjust-step="0.5">+</button></div>
      <div class="form-note">每次只能调整一个队员的一项技能。0–10 分，步进 0.5。</div>
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="submit" class="btn btn-primary">保存调整</button></div>
    </form>`;
    openModal('手动调整技能', body, { mid: true });
    const form = $('#adjustForm');
    const pSel = form.querySelector('[name=player]');
    const sSel = form.querySelector('[name=skill]');
    const input = $('#adjustInput');
    const beforeEl = $('#adjustBefore');
    const afterEl = $('#adjustAfter');
    const current = () => {
      const p = getPlayer(pSel.value);
      return p ? Number(p.skills[sSel.value] || 0) : 0;
    };
    const sync = (setValue) => {
      const cur = current();
      if (setValue != null) input.value = clamp(roundHalf(setValue), 0, 10).toFixed(1);
      const val = clamp(roundHalf(Number(input.value)), 0, 10);
      beforeEl.textContent = cur.toFixed(1);
      afterEl.textContent = val.toFixed(1);
      afterEl.classList.toggle('diff', val !== cur);
    };
    const onChange = () => { input.value = current().toFixed(1); sync(); };
    pSel.onchange = onChange;
    sSel.onchange = onChange;
    input.oninput = () => sync();
    $$('[data-adjust-step]', form).forEach((btn) => { btn.onclick = () => sync(Number(input.value) + Number(btn.dataset.adjustStep)); });
    sync(current());
    form.onsubmit = (e) => {
      e.preventDefault();
      const val = clamp(roundHalf(Number(input.value)), 0, 10);
      const count = applySkillChanges([{ playerId: pSel.value, skill: sSel.value, value: val }], form.source.value, form.date.value || dateKey(new Date()));
      closeModal();
      renderGrowth(); renderRoster(); renderDashboard(); renderActivity();
      if (count) {
        const p = getPlayer(pSel.value);
        toast(`${p.name} · ${skillLabel(sSel.value)} 已更新为 ${val.toFixed(1)}`);
      } else toast('数值没有变化', 'warn');
    };
  }

  /* ══════════ 训练后批量调整 ══════════ */
  function openBatchAdjust() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const mondays = [0, -1, -2, -3].map((n) => addDays(getMonday(new Date()), n * 7));
    const options = [];
    mondays.forEach((m) => { getSessions(m).forEach((s) => { if (s.status !== 'cancelled') options.push({ s, m }); }); });
    options.sort((a, b) => sessionStart(b.s) - sessionStart(a.s));
    if (!options.length) { toast('还没有可用的训练记录，先加一次训练', 'warn'); return; }
    const now = new Date();
    const pastWithMarks = options.find((o) => sessionEnd(o.s) <= now && Object.keys(o.s.attendance || {}).length > 0);
    const pastSession = options.find((o) => sessionEnd(o.s) <= now);
    const defaultOption = pastWithMarks || pastSession || options[0];
    const defaultIndex = Math.max(0, options.indexOf(defaultOption));
    const body = `<div class="batch-wrap">
      <div class="batch-head"><div class="field"><label>选择训练</label><select id="batchSession">${options.map((o, i) => `<option value="${i}" ${i === defaultIndex ? 'selected' : ''}>${fmtDateCN(parseKey(o.s.date))} · ${o.s.start}–${o.s.end}</option>`).join('')}</select></div><div class="batch-hint" id="batchHint"></div></div>
      <div class="batch-scroll"><div id="batchTable"></div></div>
      <div class="batch-foot"><span id="batchCount">还没有改动</span><div><button type="button" class="btn btn-ghost" id="batchReset">重置</button><button type="button" class="btn btn-primary" id="batchSave">保存本次调整</button></div></div>
    </div>`;
    openModal('训练后调整', body, { wide: true });
    let pending = new Map();
    let currentOption = defaultOption;
    let tableListenerBound = false;

    const updateCount = () => { $('#batchCount').textContent = pending.size ? `待保存 ${pending.size} 项改动` : '还没有改动'; };

    const buildTable = () => {
      const s = currentOption.s;
      const hasMarks = Object.keys(s.attendance || {}).length > 0;
      let players = db.players.filter((p) => ['present', 'late'].includes(s.attendance[p.id]));
      const unmarked = !hasMarks;
      if (unmarked) players = db.players.slice();
      $('#batchHint').textContent = unmarked
        ? `这次训练的考勤还没有登记，默认显示全部 ${db.players.length} 名队员。`
        : (players.length ? `按考勤筛选出 ${players.length} 名参训队员（出勤 / 迟到）。` : '这次训练的考勤里没有出勤或迟到的队员。');
      if (!players.length) { $('#batchTable').innerHTML = miniEmpty('这次训练没有参训队员可以调整。'); return; }
      $('#batchTable').innerHTML = `<table class="batch-table">
        <thead><tr><th>队员</th>${SKILLS.map((sk) => `<th>${sk.label}</th>`).join('')}</tr></thead>
        <tbody>${players.map((p) => `<tr data-player="${p.id}">
          <td><div class="batch-player"><span class="u-avatar" style="--a:${positionStyle(p.position)[0]};--b:${positionStyle(p.position)[1]}">${esc(p.name[0])}</span><span><b>${esc(p.name)}</b><em>${p.position}</em></span></div></td>
          ${SKILLS.map((sk) => {
            const v = Number(p.skills[sk.key] || 0);
            return `<td><div class="batch-stepper" data-player="${p.id}" data-skill="${sk.key}" data-value="${v.toFixed(1)}" data-original="${v.toFixed(1)}"><button type="button" data-step="-0.5">−</button><b title="双击数字还原这一格">${v.toFixed(1)}</b><button type="button" data-step="0.5">+</button></div></td>`;
          }).join('')}
        </tr>`).join('')}</tbody></table>`;
      pending = new Map();
      updateCount();
    };

    if (!tableListenerBound) {
      $('#batchTable').addEventListener('click', (e) => {
        const btn = e.target.closest('.batch-stepper button');
        if (!btn) return;
        const box = btn.closest('.batch-stepper');
        const cur = Number(box.dataset.value);
        const next = clamp(roundHalf(cur + Number(btn.dataset.step)), 0, 10);
        box.dataset.value = next.toFixed(1);
        $('b', box).textContent = next.toFixed(1);
        const key = `${box.dataset.player}:${box.dataset.skill}`;
        const original = Number(box.dataset.original);
        if (next === original) pending.delete(key);
        else pending.set(key, { playerId: box.dataset.player, skill: box.dataset.skill, value: next });
        box.classList.toggle('changed', next !== original);
        updateCount();
      });
      $('#batchTable').addEventListener('dblclick', (e) => {
        // 还原只认「双击中间那个数字」。双击 +/− 按钮属于连点调整，一律不还原——
        // 否则两次点击被浏览器判成 dblclick 时，数值会被拉回原值，
        // 看起来就是「点了加号反而变小」（连点越快越容易中招）
        if (!e.target.closest('.batch-stepper b')) return;
        const box = e.target.closest('.batch-stepper');
        if (!box) return;
        const key = `${box.dataset.player}:${box.dataset.skill}`;
        box.dataset.value = box.dataset.original;
        $('b', box).textContent = box.dataset.original;
        box.classList.remove('changed');
        pending.delete(key);
        updateCount();
      });
      tableListenerBound = true;
    }
    $('#batchSession').onchange = (e) => { currentOption = options[Number(e.target.value)]; buildTable(); };
    $('#batchReset').onclick = () => {
      $$('#batchTable .batch-stepper').forEach((box) => {
        box.dataset.value = box.dataset.original;
        $('b', box).textContent = box.dataset.original;
        box.classList.remove('changed');
      });
      pending = new Map();
      updateCount();
    };
    $('#batchSave').onclick = () => {
      if (!pending.size) { toast('没有改动需要保存', 'warn'); return; }
      const count = applySkillChanges(Array.from(pending.values()), 'training', currentOption.s.date);
      closeModal();
      renderGrowth(); renderRoster(); renderDashboard(); renderActivity();
      toast(`已保存 ${count} 项技能调整`);
    };
    buildTable();
  }

  /* ══════════ 设置 / 数据 ══════════ */
  function applyTheme(id) {
    const t = isTheme(id) ? id : 'aurora';
    const meta = THEMES.find((x) => x.id === t) || THEMES[0];
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.mode = meta.mode || 'dark';
    if (db.settings) db.settings.theme = t;
  }

  function setTheme(id) {
    if (!isTheme(id)) return;
    applyTheme(id);
    save();
    if (CloudOn()) cloudFire(window.XGYCloud.push.theme(id), null);
    paintThemeCards();
    const t = THEMES.find((x) => x.id === id);
    toast(`已切换到「${t.name}」`);
  }

  function paintThemeCards() {
    $$('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.themeId === db.settings.theme));
  }

  function openTheme() {
    const body = `<p class="theme-hint">换的是界面的品牌色和背景。深色六套、浅色三套。出勤绿、缺席红、提醒琥珀这三个语义色都不跟着变 —— 不然颜色就不代表状态了。</p>
      <div class="theme-grid">${THEMES.map((t) => `
        <button type="button" class="theme-card" data-theme-id="${t.id}" data-mode="${t.mode || 'dark'}" style="--p1:${t.p};--p2:${t.s}">
          <span class="tc-preview"></span>
          <span class="tc-name">${t.name}${t.mode === 'light' ? '<i class="tc-tag">浅</i>' : ''}</span>
          <span class="tc-sub">${t.sub}</span>
        </button>`).join('')}</div>`;
    openModal('主题色', body, { mid: true });
    $$('.theme-card').forEach((c) => { c.onclick = () => setTheme(c.dataset.themeId); });
    paintThemeCards();
  }

  function openSettings() {
    const t = db.settings.template;
    const body = `<div class="settings-section">
      <h4>固定训练模板</h4>
      <p class="settings-desc">按周重复。改动只影响之后新生成或尚未保存的周，已经保存过的周不会被改写。地点可以先留空，之后在单次训练里补。</p>
      <form id="templateForm"><div class="template-grid">
        ${t.map((x, i) => `<div class="template-row"><span class="tr-day">${x.label}</span><input type="time" name="start_${i}" value="${x.start}" required><input type="time" name="end_${i}" value="${x.end}" required><input type="text" name="venue_${i}" value="${esc(x.venue)}" placeholder="地点（可留空）" maxlength="24"></div>`).join('')}
      </div><div class="form-foot"><button type="submit" class="btn btn-primary">保存模板</button></div></form>
    </div>
    <div class="settings-section">
      <h4>数据管理</h4>
      <p class="settings-desc">所有数据只保存在这台电脑的浏览器里。换电脑、清缓存或重装系统前，先导出 JSON 备份。</p>
      <div class="settings-actions"><button class="btn btn-ghost" data-action="export">导出 JSON</button><button class="btn btn-ghost" data-action="import">导入 JSON</button><button class="btn btn-ghost" data-action="paste-import">粘贴导入</button><button class="btn btn-danger-ghost" data-action="clear-data">清空所有数据</button></div>
    </div>`;
    openModal('设置', body, { mid: true });
    $('#templateForm').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const next = t.map((x, i) => ({ ...x, start: String(fd.get(`start_${i}`)), end: String(fd.get(`end_${i}`)), venue: String(fd.get(`venue_${i}`) || '').trim() }));
      for (const x of next) if (x.start >= x.end) { toast(`${x.label}的结束时间需要晚于开始时间`, 'warn'); return; }
      db.settings.template = next;
      save();
      if (CloudOn()) cloudFire(window.XGYCloud.push.template(next), null);
      closeModal(); renderDashboard(); renderAttendance(); renderSidebar();
      toast('训练模板已保存');
    };
  }

  function exportData() {
    // savedAt 只写进文件，不进库：导入弹窗用它显示「这份备份是哪天的」
    const blob = new Blob([JSON.stringify({ ...db, savedAt: Date.now() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `xgy-volleyball-${dateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('备份已导出');
  }

  function importData() { $('#importFile').click(); }

  /* ══════════ 训练卡：一次训练一张可转发的图 ══════════ */
  function nextSessionAfter(s) {
    const all = [];
    Object.values(db.weeks).forEach((arr) => { if (Array.isArray(arr)) all.push(...arr); });
    all.sort(sessionSort);
    const key = `${s.date}T${s.start || ''}`;
    return all.find((x) => x.status !== 'cancelled' && `${x.date}T${x.start || ''}` > key) || null;
  }

  /* 考勤页的「训练卡」按钮：出当前周最近一场（优先今天）的图 */
  function openWeekCard() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const list = (getSessions(state.weekMonday) || []).filter((s) => s && s.date && s.status !== 'cancelled');
    if (!list.length) { toast('这一周还没有训练，先加一次', 'warn'); return; }
    list.sort(sessionSort);
    const today = dateKey(new Date());
    const target = list.find((s) => s.date === today)
      || [...list].reverse().find((s) => s.date <= today)
      || list[0];
    openTrainingCard(target);
  }

  async function openTrainingCard(s) {
    if (!s) return;
    const card = await window.XGYCard.render({
      team: '信工院排球队',
      session: s,
      players: db.players,
      logs: db.skillLogs.filter((l) => l.date === s.date),
      next: nextSessionAfter(s)
    });
    openModal('训练卡', `<div class="card-wrap">
      <p class="share-hint">保存后直接发到队群。图片<b>在你自己手机上生成</b>，不经过任何服务器；手机上也可以长按图片保存。</p>
      <img class="card-preview" src="${card.dataURL}" alt="训练卡预览">
      <div class="share-foot"><button type="button" class="btn btn-primary" id="cardSave">保存图片</button><button type="button" class="btn btn-ghost" id="cardClose">关闭</button></div>
    </div>`, { mid: true });
    $('#cardClose').onclick = closeModal;
    $('#cardSave').onclick = () => {
      const url = URL.createObjectURL(card.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `训练卡-${s.date}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已保存到下载目录，去微信里发给大家吧');
    };
  }

  /* ══════════ 赛季卡：一学期一张的总结图 ══════════ */
  function seasonPayload() {
    const keys = Object.keys(db.weeks).filter((k) => Array.isArray(db.weeks[k]) && db.weeks[k].length).sort();
    let attSum = 0, attMarked = 0, activeTotal = 0, logCount = 0;
    const weeks = keys.map((k) => {
      const monday = parseKey(k);
      const active = db.weeks[k].filter((s) => s.status !== 'cancelled');
      let on = 0, marked = 0;
      const camePos = new Set();
      active.forEach((s) => db.players.forEach((p) => {
        const st = (s.attendance || {})[p.id];
        if (!st) return;
        marked += 1;
        if (st === 'present' || st === 'late') { on += 1; camePos.add(p.position); }
      }));
      attSum += on; attMarked += marked; activeTotal += active.length;
      const d = parseKey(k);
      return {
        label: `${d.getMonth() + 1}.${d.getDate()}`,
        rate: marked ? Math.round((on / marked) * 100) : null,
        positions: POSITIONS.filter((x) => camePos.has(x))
      };
    });
    logCount = (db.skillLogs || []).length;
    // 全队六维：起点 = 每人每项最早记录的 before 的均值；现在 = 当前分均值
    const radar = { skills: SKILLS.map((sk) => {
      let s0 = 0, s1 = 0;
      db.players.forEach((p) => { s0 += skillStart(p, sk.key); s1 += Number(p.skills[sk.key] ?? 5); });
      const n = Math.max(1, db.players.length);
      return { label: sk.label, start: +(s0 / n).toFixed(1), now: +(s1 / n).toFixed(1) };
    }) };
    const range = weeks.length
      ? `${weeks[0].label} – ${parseKey(keys[keys.length - 1]).getMonth() + 1}.${parseKey(keys[keys.length - 1]).getDate()}`
      : '';
    return {
      team: '信工院排球队',
      range,
      totals: { sessions: activeTotal, rate: attMarked ? Math.round((attSum / attMarked) * 100) : null, players: db.players.length, logs: logCount },
      weeks,
      radar
    };
  }

  async function openSeasonCard() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    if (!hasAnyAttendance()) { toast('还没有登记过考勤，先记几周再来看总结', 'warn'); return; }
    const card = await window.XGYSeason.render(seasonPayload());
    openModal('赛季卡', `<div class="card-wrap">
      <p class="share-hint">一学期一张的总结图：每周出勤、位置完整度热力、全队六维进步。<b>在你自己设备上生成</b>，不经过任何服务器。</p>
      <img class="card-preview" src="${card.dataURL}" alt="赛季卡预览">
      <div class="share-foot"><button type="button" class="btn btn-primary" id="cardSave2">保存图片</button><button type="button" class="btn btn-ghost" id="cardClose2">关闭</button></div>
    </div>`, { mid: true });
    $('#cardClose2').onclick = closeModal;
    $('#cardSave2').onclick = () => {
      const url = URL.createObjectURL(card.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `赛季卡-${dateKey(new Date())}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('赛季卡已保存，学期末发群里正好');
    };
  }

  /* ══════════ 分享队伍动态（队员只读视图） ══════════ */
  // 每项技能的「起点分」：取该队员该项最早一条调整记录里的 before。
  // 从来没调过就当没变化（起点 = 现在），进步显示 0，不会凭空夸。
  function skillStart(p, key) {
    let first = null;
    (db.skillLogs || []).forEach((l) => {
      if (l.playerId !== p.id || l.skill !== key) return;
      if (!first || (l.at || 0) < (first.at || 0)) first = l;
    });
    return first ? Number(first.before) : Number(p.skills[key] ?? 5);
  }

  function attRate(att) {
    const marked = att.p + att.l + att.v + att.a;
    if (!marked) return null;
    return Math.round(((att.p + att.l) / marked) * 100);
  }

  // 全季考勤聚合：跳过取消的训练；只统计「已登记」的格子，未登记不算缺勤
  function sharePayload() {
    const players = db.players.map((p) => {
      const att = { p: 0, l: 0, v: 0, a: 0 };
      Object.values(db.weeks).forEach((arr) => (arr || []).forEach((s) => {
        if (s.status === 'cancelled') return;
        const st = (s.attendance || {})[p.id];
        if (st === 'present') att.p += 1;
        else if (st === 'late') att.l += 1;
        else if (st === 'leave') att.v += 1;
        else if (st === 'absent') att.a += 1;
      }));
      const sk = SKILLS.map((s) => Number(p.skills[s.key] ?? 5));
      const base = SKILLS.map((s) => skillStart(p, s.key));
      // note 只带 AI 写的那段：模板点评是纯规则算出来的，队员端用同样规则现场算，
      // 结果一模一样，但省掉整条链接一半的体积（中文文本压不动，最贵的就是它）
      const aiNote = (db.shareNotes && db.shareNotes[p.id]) || '';
      // nc：这段点评是不是 AI 写的（分享页据此标注来源，模板版不冒充 AI）
      return { id: p.id, n: p.name, pos: p.position, no: p.number || 0, att, sk, base, note: aiNote, nc: aiNote ? 1 : 0 };
    });
    const sessions = Object.values(db.weeks).flat()
      .filter((s) => s && s.status !== 'cancelled')
      .sort((a, b) => sessionSort(b, a))
      .slice(0, 8)
      .map((s) => {
        const c = sessionCounts(s);
        return { d: s.date || '', t: s.start || '', p: c.present, l: c.late, v: c.leave, a: c.absent, st: s.attendance || {} };
      })
      .reverse(); // 视图里按时间正序展示
    // 接下来几次还没结束的训练：队员要请假，得先知道「请哪一次」
    const now = Date.now();
    const next = [];
    const seen = new Set();
    for (let w = 0; w < 4 && next.length < 4; w++) {
      const monday = getMonday(addDays(new Date(), w * 7));
      getSessions(monday).forEach((s) => {
        if (s.status === 'cancelled') return;
        if (sessionEnd(s).getTime() <= now) return;
        const k = `${s.date}T${s.start}`;
        if (seen.has(k)) return;
        seen.add(k);
        next.push({ d: s.date, t: s.start });
      });
    }
    next.sort((a, b) => (`${a.d}T${a.t}` < `${b.d}T${b.t}` ? -1 : 1));
    return { v: 1, team: '信工院排球队', at: Date.now(), players, sessions, next: next.slice(0, 4) };
  }

  /** 用队长的 AI Key 一次性给全队写点评（存本机，生成过就不重复花钱） */
  async function generateShareNotes() {
    const cfg = aiCfg();
    if (!cfg.key) throw new Error('还没填 API Key');
    const data = sharePayload();
    const rows = data.players.map((pl, i) => {
      const skills = {}, start = {};
      SKILLS.forEach((sk, k) => { skills[sk.label] = +pl.sk[k].toFixed(1); start[sk.label] = +pl.base[k].toFixed(1); });
      return { i, 姓名: pl.n, 号码: pl.no, 位置: pl.pos, 出勤率: attRate(pl.att), 出勤: pl.att, 技能: skills, 起点: start };
    });
    const prompt = `你是这支大学院排球队的队长，也是队里技术最细的人。下面是队员的真实数据（起点 = 赛季初的分，技能 = 现在的分，出勤率按已登记的训练算）。\n\n${JSON.stringify(rows)}\n\n给每个人写一段点评，直接对本人说、用"你"，40-50 字（链接长度直接取决于这个，超过 50 字就算失败），必须包含三件事：\n1）具体夸一处：点名某项技能或出勤表现，带上数字对比；\n2）指出最该练的一项技能，配一个能自己练的动作或次数；\n3）一句落在实处的鼓励，不要空话、不要堆感叹号、不要"你是最棒的"。\n语气像认真但不肉麻的队长，不要出现"数据""统计""评分"这类词。\n只输出 JSON 数组，格式 [{"i":0,"t":"点评正文"}]，i 用给定编号，不要解释、不要代码块。`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    let res;
    try {
      res = await fetch(aiUrl(cfg.base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], stream: false, temperature: 0.8 }),
        signal: ctl.signal
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.code)) || j.message || ''; } catch (e) { /* ignore */ }
      throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}${res.status === 401 ? '（Key 不对）' : res.status === 402 ? '（余额不足）' : ''}`);
    }
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a < 0 || b < 0) throw new Error('模型没按格式返回');
    let arr;
    try { arr = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('返回内容解析失败'); }
    let n = 0;
    (Array.isArray(arr) ? arr : []).forEach((it) => {
      const pl = data.players[it && it.i];
      if (!pl || typeof it.t !== 'string' || !it.t.trim()) return;
      if (!db.shareNotes) db.shareNotes = {};
      db.shareNotes[pl.id] = it.t.trim().slice(0, 150); // 50 字中文 ≈ 150 字节，再长二维码就扫不动了
      n += 1;
    });
    if (!n) throw new Error('一条点评都没解析出来');
    save();
    return n;
  }

  async function openShareModal() {
    if (!db.players.length) { toast('还没有队员，先录入队员再分享', 'warn'); return; }
    const hasAi = !!aiCfg().key;
    const body = `<div class="share-wrap">
      <p class="share-hint">队员用<b>微信扫一扫</b>或长按识别下面的码，输入<b>姓名 + 球衣号码</b>，就能看到自己的出勤、进步、六维图和一段点评。数据全在码里，<b>不上传任何服务器</b>。</p>
      <div class="share-qr">
        <canvas id="shareQr" aria-label="队员端二维码"></canvas>
        <em id="shareQrTips" class="mono">生成中…</em>
        <button type="button" class="share-qr-save" id="shareQrSave">保存二维码图片</button>
      </div>
      ${hasAi
        ? `<div class="share-ai"><button type="button" class="btn btn-ghost" id="shareAi"><span>✦</span>用 AI 写点评</button><em id="shareAiSt">点一次，全队每人一段（约 10 秒）</em></div>`
        : `<div class="share-ai is-tip"><em>点评先用内置模板生成。到「AI 助手」填个 API Key，可以让 AI 写得更贴每个人的情况。</em></div>`}
      <details class="share-link-box">
        <summary>或者复制链接发到群里</summary>
        <textarea id="shareLink" class="share-link" rows="3" readonly placeholder="生成中…"></textarea>
        <div class="share-meta mono" id="shareMeta"></div>
      </details>
      <div class="share-note">
        <p>· 这是<b>数据快照</b>，之后改了考勤或技能，重新生成一次再发</p>
        <p>· 码里含队员姓名和出勤，只发队内，别贴公开群</p>
        <p>· 队员要请假，让他在页面底部点「请假」拿回执码，你在考勤页点「回执」登记</p>
      </div>
      <div class="share-foot"><button type="button" class="btn btn-primary" id="shareCopy">复制链接</button><button type="button" class="btn btn-ghost" id="shareClose">关闭</button></div>
    </div>`;
    openModal('分享队伍动态', body, { mid: true });
    $('#shareClose').onclick = closeModal;
    $('#shareLink').onclick = (e) => e.target.select();
    let url = '';

    // 把链接画成二维码：队员扫码进，不用看到那串长链接
    const paintQR = () => {
      const cv = $('#shareQr');
      const tips = $('#shareQrTips');
      if (!cv || !tips) return;
      if (!url) { tips.textContent = '链接还没生成好'; return; }
      if (!window.XGYQR) { cv.style.display = 'none'; tips.textContent = '二维码模块没加载'; return; }
      try {
        const info = window.XGYQR.toCanvas(cv, url, { size: 620, quiet: 2, fg: '#0c0e14', bg: '#ffffff' });
        // 版本越高模块越密：屏幕扫不动就靠存图发群、长按识别
        tips.textContent = info.version <= 16
          ? `V${info.version} · 当面扫或长按识别都行`
          : `V${info.version} · 偏密，建议存图发群里长按识别`;
        const save = $('#shareQrSave');
        if (save) save.onclick = () => {
          const name = `信工院排球队-队员码-${new Date().toISOString().slice(0, 10)}.png`;
          // 导出单独画一张 1240px 的：屏幕上 620 够用，存图发群/打印要更密更清晰
          let exportCv = cv;
          try {
            const big = document.createElement('canvas');
            window.XGYQR.toCanvas(big, url, { size: 1240, quiet: 3, fg: '#0c0e14', bg: '#ffffff' });
            exportCv = big;
          } catch (e) { /* 画不出大的就导出屏幕这张 */ }
          exportCv.toBlob((blob) => {
            if (!blob) { toast('导出失败，可以截图保存', 'warn'); return; }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            toast('二维码已保存，发到群里让队员长按识别');
          }, 'image/png');
        };
        cv.onclick = () => {
          const ov = document.createElement('div');
          ov.className = 'qr-full';
          const big = document.createElement('canvas');
          ov.appendChild(big);
          document.body.appendChild(ov);
          window.XGYQR.toCanvas(big, url, { size: Math.max(720, Math.min(screen.width, screen.height) * 2), quiet: 2, fg: '#0c0e14', bg: '#ffffff' });
          big.style.width = 'min(86vw, 86vh)';
          ov.onclick = () => ov.remove();
        };
      } catch (err) {
        cv.style.display = 'none';
        tips.textContent = '二维码没生成：' + (err && err.message ? err.message : '未知错误') + '（可复制链接发）';
      }
    };

    const rebuild = async () => {
      try {
        url = await window.XGYShare.buildURL(sharePayload());
        $('#shareLink').value = url;
        $('#shareMeta').textContent = `LINK · ${url.length} CHARS`;
        paintQR();
      } catch (err) {
        $('#shareLink').value = '';
        $('#shareMeta').textContent = '生成失败：' + (err && err.message ? err.message : '未知错误');
        const tips = $('#shareQrTips');
        if (tips) tips.textContent = '生成失败';
      }
    };
    await rebuild();
    $('#shareCopy').onclick = async () => {
      if (!url) { toast('链接还没生成好，稍等一下再点', 'warn'); return; }
      try {
        await navigator.clipboard.writeText(url);
      } catch (e) {
        const ta = $('#shareLink');
        ta.select();
        document.execCommand('copy');
      }
      toast('链接已复制，去微信里粘贴发给队员吧');
    };
    const aiBtn = $('#shareAi');
    if (aiBtn) aiBtn.onclick = async () => {
      aiBtn.disabled = true;
      const st = $('#shareAiSt');
      if (st) st.textContent = '正在写…（一个请求，全队一起生成）';
      try {
        const n = await generateShareNotes();
        if (st) st.textContent = `已为 ${n} 名队员写好点评，链接已更新，复制发出去就行`;
        toast('点评生成好了，重新复制一次链接');
      } catch (err) {
        if (st) st.textContent = '生成失败：' + (err && err.message ? err.message : '未知错误');
        toast('AI 没写成功，先用模板版也能发', 'warn');
      } finally {
        aiBtn.disabled = false;
        await rebuild();
      }
    };
  }

  /* ══════════ 请假回执：队员反向请假 ══════════
     链路：队员在分享页点请假 → 本机算出 12 位回执码 → 微信发给队长 →
     队长在这里粘贴（或点他发来的 #rcpt= 链接）→ 一键登记成请假。
     不需要服务器，也不新增任何持久化字段：登记结果直接写进考勤。 */
  function playersByFp(fp) {
    if (!window.XGYShare || !window.XGYShare.fpOf) return [];
    return db.players.filter((p) => window.XGYShare.fpOf(p.name, p.number) === fp);
  }

  function openReceiptModal(prefill) {
    if (!db.players.length) { toast('还没有队员，先录入队员再收回执', 'warn'); return; }
    const body = `<div class="rcpt-wrap">
      <p class="rcpt-hint">队员在分享页点「请假」会拿到一串 <b>12 位回执码</b>。把他发来的整段话粘进来（或直接开他发来的回执链接），核对无误后一键登记。</p>
      <textarea id="rcptInput" class="rcpt-input" rows="3" spellcheck="false" placeholder="粘贴回执码，例如 7Q3M-9PDK-2XAB"></textarea>
      <div class="rcpt-preview" id="rcptPreview"></div>
      <div class="share-foot"><button type="button" class="btn btn-primary" id="rcptApply" disabled>登记为请假</button><button type="button" class="btn btn-ghost" id="rcptCancel">关闭</button></div>
    </div>`;
    openModal('队员请假回执', body, { mid: true });
    $('#rcptCancel').onclick = closeModal;
    const input = $('#rcptInput');
    const prev = $('#rcptPreview');
    const applyBtn = $('#rcptApply');
    let rc = null;
    let cands = [];
    let cand = null;
    let target = null; // { monday, session }

    const card = (player, bad, inner) => {
      const [a, b] = positionStyle(player.position);
      return `<div class="rcpt-card${bad ? ' is-bad' : ''}">
        <div class="rcpt-who">
          <span class="u-avatar" style="--a:${a};--b:${b}">${esc((player.name || '?')[0])}</span>
          <strong>${esc(player.name)}</strong><em>${player.number ? '#' + player.number + ' · ' : ''}${esc(player.position)}</em>
        </div>
        <dl class="rcpt-facts">${inner}</dl>
      </div>`;
    };

    const syncApply = () => {
      let ok = !!(cand && rc && target && target.session);
      let why = '';
      if (cand && target && target.session) {
        if (target.session.status === 'cancelled') { ok = false; why = '那次已取消'; }
        else if (target.session.attendance[cand.id] === 'leave') { ok = false; why = '已经是请假'; }
      }
      applyBtn.disabled = !ok;
      applyBtn.textContent = why ? `无需登记（${why}）` : '登记为请假';
    };

    const showTarget = () => {
      if (!rc) return;
      target = (() => {
        const monday = getMonday(parseKey(rc.date));
        const hits = getSessions(monday).filter((s) => s.date === rc.date);
        return { monday, session: hits.find((s) => s.start === rc.start) || hits[0] || null };
      })();
      if (!cand) return;
      const s = target.session;
      let stateLine;
      if (!s) stateLine = `<dd class="warn">那天没有训练记录</dd>`;
      else if (s.status === 'cancelled') stateLine = `<dd class="warn">那次已取消</dd>`;
      else {
        const cur = s.attendance[cand.id] || '';
        stateLine = cur === 'leave' ? '<dd>已经是请假</dd>'
          : cur ? `<dd class="warn">现在是「${ATT_LABEL[cur]}」，会被改成请假</dd>`
            : '<dd>未登记</dd>';
      }
      prev.innerHTML = card(cand, false, `
        <div><dt>哪一次</dt><dd>${esc(fmtDateCN(parseKey(rc.date)))} ${esc(rc.start)}</dd></div>
        <div><dt>原因</dt><dd>${esc(rc.reasonText)}</dd></div>
        <div><dt>当前</dt>${stateLine}</div>`);
      syncApply();
    };

    const parse = () => {
      rc = null; cands = []; cand = null; target = null;
      prev.innerHTML = '';
      applyBtn.disabled = true;
      applyBtn.textContent = '登记为请假';
      const raw = String(input.value || '').trim();
      if (!raw) return;
      try {
        rc = window.XGYShare.decodeReceipt(raw);
      } catch (err) {
        prev.innerHTML = `<div class="rcpt-card is-bad"><b>${esc(err.message)}</b><p>回执码是 12 位，形如 <span class="mono">7Q3M-9PDK-2XAB</span>。整段消息一起粘也行。</p></div>`;
        return;
      }
      cands = playersByFp(rc.fp);
      if (!cands.length) {
        prev.innerHTML = `<div class="rcpt-card is-bad"><b>队里对不上这个人</b><p>可能改过名字或号码，也可能这条回执不是发给咱们队的。让对方重新生成一次，或者你手动登记。</p><p class="mono">${esc(rc.date)} ${esc(rc.start)} · ${esc(rc.reasonText)}</p></div>`;
        return;
      }
      if (cands.length === 1) {
        cand = cands[0];
        showTarget();
        return;
      }
      // 同名同号（数据重复录了两次）：让人自己点一下
      prev.innerHTML = card(cands[0], false, `
        <div><dt>哪一次</dt><dd>${esc(fmtDateCN(parseKey(rc.date)))} ${esc(rc.start)}</dd></div>
        <div><dt>原因</dt><dd>${esc(rc.reasonText)}</dd></div>
        <div><dt>注意</dt><dd class="warn">队里有 ${cands.length} 人同名同号，点一下是谁</dd></div>`)
        + `<div class="rcpt-pick">${cands.map((p, i) => `<button type="button" data-pick="${i}">${esc(p.name)} · ${esc(p.position)}</button>`).join('')}</div>`;
      prev.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          cand = cands[Number(btn.dataset.pick)];
          prev.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b === btn));
          showTarget();
        };
      });
    };

    applyBtn.onclick = async () => {
      if (!cand || !rc || !target || !target.session) return;
      applyBtn.disabled = true;
      applyBtn.textContent = '登记中…';
      const monday = getMonday(parseKey(rc.date));
      // 云端模式：本周可能是懒加载的，先把服务器那份拉下来，别拿模板里的临时 id 去写
      if (CloudOn() && !Array.isArray(db.weeks[weekKey(monday)])) {
        try { await window.XGYCloud.syncWeek(weekKey(monday), true); } catch (e) { /* 拉不到就按本地写 */ }
      }
      const sessions = ensureWeek(monday);
      const hits = (sessions || []).filter((s) => s.date === rc.date);
      const s = hits.find((x) => x.start === rc.start) || hits[0];
      if (!s) { toast('那天没有训练安排，可能被删掉了', 'warn'); applyBtn.disabled = false; applyBtn.textContent = '登记为请假'; return; }
      if (s.status === 'cancelled') { toast('那次训练已取消，不用请假', 'warn'); applyBtn.disabled = false; applyBtn.textContent = '登记为请假'; return; }
      s.attendance[cand.id] = 'leave';
      s.updatedAt = Date.now();
      save();
      if (CloudOn()) cloudFire(window.XGYCloud.push.attSet(s.id, cand.id, 'leave'), () => window.XGYCloud.syncWeek(weekKey(monday), true).then(renderAttendance));
      state.weekMonday = monday;
      closeModal();
      go('attendance');
      toast(`${cand.name} · ${fmtMD(parseKey(s.date))} 已登记为请假`);
    };

    input.addEventListener('input', parse);
    if (prefill) { input.value = prefill; parse(); } else { setTimeout(() => input.focus(), 80); }
  }

  /* ══════════ 导入备份：按队员合并 / 完全覆盖 ══════════
   * 为什么要有「合并」：电脑录数据、平板登记考勤是常态。
   * 完全覆盖会把平板新增的考勤抹掉；合并按「姓名+号码」认人，
   * 同一个人用备份覆盖，备份里没有的人保留、备份里多的人补上。
   * 号码一方可能没录（0），所以号码没对上时，只有「两边这个名字都唯一」才按姓名认。 */
  function mergeBackup(incoming) {
    const inc = normalizeDB(incoming);
    const noKey = (p) => `${String(p.name).trim()}::${Number(p.number) || 0}`;
    const nmKey = (p) => String(p.name).trim();
    const countName = (list) => list.reduce((m, p) => m.set(nmKey(p), (m.get(nmKey(p)) || 0) + 1), new Map());
    const curNameCount = countName(db.players);
    const incNameCount = countName(inc.players);
    const curByNo = new Map(db.players.map((p) => [noKey(p), p]));

    const idMap = new Map();          // 备份里的队员 id → 本机 id
    const matched = [];
    const added = [];
    const usedIds = new Set(db.players.map((p) => p.id));

    inc.players.forEach((p) => {
      let hit = curByNo.get(noKey(p));
      if (!hit) {
        const nm = nmKey(p);
        if (curNameCount.get(nm) === 1 && incNameCount.get(nm) === 1) {
          hit = db.players.find((x) => nmKey(x) === nm);
        }
      }
      if (hit) {
        idMap.set(p.id, hit.id);
        matched.push({ cur: hit, inc: p });
      } else {
        const nid = p.id && !usedIds.has(p.id) ? p.id : uid('p');
        usedIds.add(nid);
        idMap.set(p.id, nid);
        added.push({ ...p, id: nid });
      }
    });

    const out = clone(db);
    /* 1) 队员：匹配上的用备份覆盖技能/位置/年级/身高；本机独有的原样保留 */
    out.players = db.players.map((p) => {
      const pair = matched.find((m) => m.cur.id === p.id);
      if (!pair) return p;
      return {
        ...p,
        position: pair.inc.position,
        grade: pair.inc.grade,
        height: pair.inc.height,
        skills: pair.inc.skills,
        updatedAt: Math.max(Number(p.updatedAt) || 0, Number(pair.inc.updatedAt) || 0)
      };
    }).concat(added);

    /* 2) 训练：按「日期 + 开始时间」认定同一场，同场用备份的考勤整格覆盖。
          考勤里的队员 id 必须过一遍 idMap，否则两边 id 不同会写出孤儿数据。 */
    let sOver = 0, sAdd = 0;
    const weeks = {};
    const weekKeys = new Set([...Object.keys(db.weeks || {}), ...Object.keys(inc.weeks || {})]);
    [...weekKeys].sort().forEach((k) => {
      const cur = Array.isArray(db.weeks[k]) ? db.weeks[k] : [];
      const incW = Array.isArray(inc.weeks[k]) ? inc.weeks[k] : [];
      const merged = cur.map((s) => ({ ...s, attendance: { ...(s.attendance || {}) } }));
      incW.forEach((is) => {
        const att = {};
        Object.keys(is.attendance || {}).forEach((pid) => {
          const nid = idMap.get(pid);
          if (nid) att[nid] = is.attendance[pid];
        });
        const same = merged.find((s) => s.date === is.date && s.start === is.start);
        if (same) {
          same.end = is.end;
          same.venue = is.venue;
          same.status = is.status;
          same.cancelReason = is.cancelReason;
          same.attendance = att;
          same.updatedAt = Math.max(Number(same.updatedAt) || 0, Number(is.updatedAt) || 0);
          sOver += 1;
        } else {
          merged.push({ ...is, id: merged.some((s) => s.id === is.id) ? uid('s') : is.id, attendance: att });
          sAdd += 1;
        }
      });
      merged.sort(sessionSort);
      if (merged.length) weeks[k] = merged;
    });
    out.weeks = weeks;

    /* 3) 技能记录：只追加不覆盖，按「人+项+日期+前后分」去重 */
    const seen = new Set(db.skillLogs.map((l) => `${l.playerId}|${l.skill}|${l.date}|${l.before}|${l.after}`));
    const logs = db.skillLogs.slice();
    let lAdd = 0;
    inc.skillLogs.forEach((l) => {
      const pid = idMap.get(l.playerId);
      if (!pid) return;
      const key = `${pid}|${l.skill}|${l.date}|${l.before}|${l.after}`;
      if (seen.has(key)) return;
      seen.add(key);
      logs.push({ ...l, playerId: pid, id: logs.some((x) => x.id === l.id) ? uid('log') : l.id });
      lAdd += 1;
    });
    logs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.at) || 0) - (Number(b.at) || 0));
    out.skillLogs = logs;

    /* 4) AI 点评：有新的就换成新的 */
    const notes = { ...(db.shareNotes || {}) };
    Object.keys(inc.shareNotes || {}).forEach((pid) => {
      const nid = idMap.get(pid);
      if (nid && inc.shareNotes[pid]) notes[nid] = inc.shareNotes[pid];
    });
    out.shareNotes = notes;

    /* 训练模板 / 主题 / 阵型库属于这台设备自己的偏好，合并时不动 */
    return {
      db: out,
      stats: {
        matched: matched.length,
        added: added.length,
        kept: db.players.length - matched.length,
        sOver, sAdd, lAdd,
        incPlayers: inc.players.length,
        incSessions: Object.values(inc.weeks || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0),
        incLogs: inc.skillLogs.length
      }
    };
  }

  /* 打开「导入」弹窗：选模式 → 看预览 → 落库。选文件 / 粘贴 / 剪贴板三个入口共用 */
  function openImportDialog(incoming, label) {
    if (!incoming || typeof incoming !== 'object') { toast('备份内容读不出来', 'warn'); return; }
    if (incoming.version !== SCHEMA) { toast(`备份版本是 ${String(incoming.version)}，当前需要 ${SCHEMA}`, 'warn'); return; }
    const merged = mergeBackup(incoming);
    const st = merged.stats;
    const sum = (mode) => mode === 'merge'
      ? `<div class="imp-row"><span>队员</span><b>匹配 ${st.matched} · 新增 ${st.added} · 本机保留 ${st.kept}</b></div>
         <div class="imp-row"><span>训练</span><b>覆盖 ${st.sOver} 场 · 新增 ${st.sAdd} 场</b></div>
         <div class="imp-row"><span>技能记录</span><b>追加 ${st.lAdd} 条</b></div>
         <div class="imp-row imp-mut"><span>不动</span><b>训练模板、主题、阵型库</b></div>`
      : `<div class="imp-row"><span>结果</span><b>${st.incPlayers} 名队员 · ${st.incSessions} 次训练 · ${st.incLogs} 条技能记录</b></div>
         <div class="imp-row imp-mut"><span>代价</span><b>本机现有数据全部清掉</b></div>`;

    const savedTxt = (() => {
      const v = incoming.savedAt;
      if (!v) return '';
      const n = Number(v);
      if (Number.isFinite(n) && n > 1e11) { const d = new Date(n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
      return String(v).slice(0, 10);
    })();

    openModal('导入备份', `<div class="imp-wrap">
      <p class="imp-lead">来源：<b>${esc(label)}</b>${savedTxt ? `，导出于 ${esc(savedTxt)}` : ''}。</p>
      <label class="imp-opt"><input type="radio" name="impMode" value="merge" checked><span><strong>按队员合并</strong><em>同姓名同号码的人用备份覆盖；备份里的新队员补上；本机独有的保留。</em></span></label>
      <label class="imp-opt"><input type="radio" name="impMode" value="replace"><span><strong>完全覆盖</strong><em>清空本机全部数据，变成备份的样子。</em></span></label>
      <div class="imp-preview" id="impPreview">${sum('merge')}</div>
      <div class="form-foot"><button type="button" class="btn btn-primary" id="impGo">导入</button><button type="button" class="btn btn-ghost" id="impCancel">取消</button></div>
    </div>`, { mid: true });

    const modeOf = () => (document.querySelector('input[name="impMode"]:checked') || {}).value || 'merge';
    document.querySelectorAll('input[name="impMode"]').forEach((r) => {
      r.onchange = () => { $('#impPreview').innerHTML = sum(modeOf()); };
    });
    $('#impCancel').onclick = closeModal;
    $('#impGo').onclick = async () => {
      if (modeOf() === 'replace') {
        const ok = await confirmDialog({
          title: '完全覆盖？',
          message: `本机现有的 ${db.players.length} 名队员、全部考勤和技能记录会被删掉，换成备份的内容。`,
          ok: '覆盖'
        });
        if (!ok) return;
        db = normalizeDB(incoming);
      } else {
        db = merged.db;
      }
      save();
      location.reload();
    };
  }

  /* 平板友好：文件选择器认不出 .json 时，粘贴整段内容也能导入 */
  function openImportChooser() {
    openModal('导入备份', `<div class="imp-wrap">
      <p class="imp-lead">备份在「文件」App 里就直接选；如果在微信/QQ 里收到，先「用其他应用打开 → 存储到文件」，或者在这里粘贴内容。</p>
      <div class="imp-choice">
        <button type="button" class="btn btn-primary" id="impPickFile">选择备份文件</button>
        <button type="button" class="btn btn-ghost" id="impPickPaste">粘贴备份内容</button>
      </div>
      <p class="imp-note">两种入口后面都会让你选「按队员合并」还是「完全覆盖」，不会一按就覆盖。</p>
    </div>`, { mid: true });
    // 先触发文件选择（保留用户手势），再关弹窗：iOS 上晚一步调 click() 会没反应
    $('#impPickFile').onclick = () => { $('#importFile').click(); closeModal(); };
    $('#impPickPaste').onclick = () => openPasteImport();
  }

  function openPasteImport() {
    openModal('粘贴备份导入', `<div class="imp-wrap">
      <p class="imp-lead">把备份文件用文本方式打开、全选复制，粘到这里。iPad 上文件选择器常常不让选 .json，这是绕过去的办法。</p>
      <textarea class="imp-ta" id="impText" rows="8" placeholder='{"version":2,"players":[...]}'></textarea>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="impClip">读剪贴板</button>
        <button type="button" class="btn btn-primary" id="impParse">解析</button>
        <button type="button" class="btn btn-ghost" id="impPasteCancel">取消</button>
      </div>
    </div>`, { mid: true });
    const ta = $('#impText');
    $('#impPasteCancel').onclick = closeModal;
    $('#impClip').onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('剪贴板是空的', 'warn'); return; }
        ta.value = t;
        toast('已从剪贴板读入');
      } catch (e) {
        toast('读不了剪贴板，长按输入框手动粘贴', 'warn');
      }
    };
    $('#impParse').onclick = () => {
      const t = String(ta.value || '').trim().replace(/^\uFEFF/, '');
      if (!t) { toast('先把备份内容粘进来', 'warn'); return; }
      let raw;
      try { raw = JSON.parse(t); } catch (e) { toast('这不是有效的 JSON，检查有没有粘漏', 'warn'); return; }
      openImportDialog(raw, '粘贴的内容');
    };
  }

  function readFileText(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  async function handleImportFile(file) {
    if (!file) return;
    try {
      const text = (await readFileText(file)).replace(/^\uFEFF/, '');
      const raw = JSON.parse(text);
      openImportDialog(raw, file.name || '备份文件');
    } catch (e) {
      toast('导入失败：文件不是有效的 JSON', 'warn');
    } finally {
      $('#importFile').value = '';
    }
  }

  async function clearAllData() {
    const ok = await confirmDialog({ title: '清空所有数据？', message: '队员、训练、考勤、技能记录都会被删除，无法恢复。建议先导出备份。', ok: '清空所有数据' });
    if (!ok) return;
    try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  function openHelp() {
    openModal('使用说明', `<div class="help-body">
      <p><b>1. 先设模板。</b> 默认周二 16:30–18:30、周五 16:30–18:30、周日 08:30–11:30。地点在设置里补一次即可。</p>
      <p><b>2. 再加队员。</b> 只填姓名、号码、位置、年级、身高，以及 6 项技能的初始分（默认 5.0）。</p>
      <p><b>3. 每周自动生成训练。</b> 改时间、改地点、取消、加练都只影响那一周。下雨就用「因雨取消」，不计入出勤率。</p>
      <p><b>4. 考勤按次登记。</b> 每个格子循环切换：未登记 → 出勤 → 迟到 → 请假 → 缺席。未登记的格子不参与出勤率计算。</p>
      <p><b>5. 训练后调技能。</b> 成长页点格子单项调整，或用「训练后调整」按当次参训名单批量加减。0–10 分，步进 0.5。</p>
      <p><b>6. 阵型板摆站位。</b> 进入阵型页，手指（或鼠标）把 6 个角色拖到防守位置，松手按 0.25m 吸附并自动保存；摆好后点「存当前」起个名字存进阵型库，点列表随时套用。双击或方向键可微调。</p>
      <p><b>7. 定期备份。</b> 设置或头像菜单里导出 JSON。换电脑前先导出。</p>
      <p><b>8. 队员请假。</b> 队员在分享页底部点「请假」，选一次训练和原因，会拿到一串 12 位回执码；他把码（或整段消息）发给你，你在考勤页点「回执」粘进去，那次就登记成请假。他要是点了「复制回执链接」，你直接点开链接也会自动弹确认。</p>
    </div>`, { mid: true });
  }

  /* ══════════ 阵型板 ══════════ */
  const fxEls = {};
  let fxReady = false;
  let fxDrag = null;

  function mountTactics() {
    if (fxReady) return;
    const court = $('#fxCourt');
    if (!court) return;

    FX_ROLES.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'fx-token';
      el.dataset.role = r.id;
      el.style.setProperty('--role', r.color);
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${r.name}，拖动调整站位，方向键微调`);
      el.innerHTML = `<span>${r.name}</span>`;
      court.appendChild(el);
      fxEls[r.id] = el;
      bindFxPointer(el, r);
      bindFxKeys(el, r);
    });

    $('#fxRoles').innerHTML = FX_ROLES.map((r) =>
      `<li class="fx-role" style="--role:${r.color}"><i class="fx-role-dot"></i><span class="fx-role-name">${r.name}</span><span class="fx-role-pos" data-pos="${r.id}">—</span></li>`
    ).join('');

    $('#fxSaveBtn').addEventListener('click', () => toggleFxSaveRow());
    $('#fxSaveCancel').addEventListener('click', () => toggleFxSaveRow(false));
    const saveName = $('#fxSaveName');
    saveName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = saveName.value.trim();
        if (!name) { toast('先给阵型起个名字', 'warn'); return; }
        saveFxCurrent(name);
        toggleFxSaveRow(false);
      }
    });
    $('#fxSaveOk').addEventListener('click', () => {
      const name = saveName.value.trim();
      if (!name) { toast('先给阵型起个名字', 'warn'); return; }
      saveFxCurrent(name);
      toggleFxSaveRow(false);
    });
    $('#fxSaves').addEventListener('click', (e) => {
      const apply = e.target.closest('[data-apply]');
      if (apply) { applyFxSaved(apply.dataset.apply); return; }
      const del = e.target.closest('[data-del]');
      if (del) { deleteFxSaved(del.dataset.del); return; }
      const rnBtn = e.target.closest('[data-rename-btn]');
      if (rnBtn) { fxRenameId = rnBtn.dataset.renameBtn; paintFxSaves(); return; }
      const rnOk = e.target.closest('[data-rename-ok]');
      if (rnOk) {
        const inp = $('#fxSaves').querySelector(`[data-rename="${rnOk.dataset.renameOk}"]`);
        fxRenameId = '';
        renameFxSaved(rnOk.dataset.renameOk, inp ? inp.value : '');
        return;
      }
      const upd = e.target.closest('[data-update]');
      if (upd) updateFxSaved(upd.dataset.update);
    });
    $('#fxSaves').addEventListener('keydown', (e) => {
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        fxRenameId = '';
        renameFxSaved(inp.dataset.rename, inp.value);
      } else if (e.key === 'Escape') {
        fxRenameId = '';
        paintFxSaves();
      }
    });
    // 点 ✓ 时先压住默认行为，避免输入框失焦导致改名行被重建、click 落空
    $('#fxSaves').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-rename-ok]')) e.preventDefault();
    });
    $('#fxSaves').addEventListener('focusout', (e) => {
      const inp = e.target.closest('[data-rename]');
      if (!inp || fxRenameId !== inp.dataset.rename) return;
      fxRenameId = '';
      paintFxSaves();
    });

    $('#fxReset').addEventListener('click', () => applyFxPreset('base'));
    $('#fxFull').addEventListener('click', toggleFxFull);
    $('#fxExit').addEventListener('click', exitFxFull);
    $('#fxExitTop').addEventListener('click', exitFxFull);

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('fx-immersive')) {
        document.body.classList.remove('fx-immersive');
        renderTactics();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('fx-immersive') && !document.fullscreenElement) exitFxFull();
    });

    document.addEventListener('pointerdown', fsWake, true);
    document.addEventListener('keydown', fsWake, true);

    fxReady = true;
  }

  function renderTactics() {
    mountTactics();
    const f = db.formation;
    FX_ROLES.forEach((r) => {
      const el = fxEls[r.id];
      if (!el) return;
      const p = f.pos[r.id];
      el.style.left = (p.x / FX_SIZE * 100) + '%';
      el.style.top = (p.y / FX_SIZE * 100) + '%';
    });
    paintFxPresets();
    paintFxSaves();
    paintFxRoles();
  }

  function paintFxPresets() {
    // 出厂预设已移除，只同步状态标签：base = 默认站位，其余一律算自定义
    const label = db.formation.preset === 'base' ? '默认站位' : '自定义';
    const tag = $('#fxState');
    if (tag) tag.textContent = label;
    const fsName = $('#fxFsName');
    if (fsName) fsName.textContent = label;
  }

  let fsIdleTimer = 0;
  function fsWake() {
    const bar = $('#fxFsBar');
    const top = $('#fxExitTop');
    if (bar) bar.classList.remove('idle');
    if (top) top.classList.remove('idle');
    clearTimeout(fsIdleTimer);
    if (!document.body.classList.contains('fx-immersive')) return;
    fsIdleTimer = setTimeout(() => {
      if (!document.body.classList.contains('fx-immersive')) return;
      if (bar) bar.classList.add('idle');
      if (top) top.classList.add('idle');
    }, 3000);
  }

  function enterFxFull() {
    document.body.classList.add('fx-immersive');
    renderTactics();
    fsWake();
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => { /* 不支持就用沉浸层兜底 */ });
    }
  }

  function exitFxFull() {
    document.body.classList.remove('fx-immersive');
    clearTimeout(fsIdleTimer);
    const bar = $('#fxFsBar');
    if (bar) bar.classList.remove('idle');
    const top = $('#fxExitTop');
    if (top) top.classList.remove('idle');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    renderTactics();
  }

  function toggleFxFull() {
    if (document.body.classList.contains('fx-immersive')) exitFxFull();
    else enterFxFull();
  }

  function paintFxRoles() {
    FX_ROLES.forEach((r) => {
      const el = $(`#fxRoles [data-pos="${r.id}"]`);
      if (!el) return;
      const p = db.formation.pos[r.id];
      el.textContent = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)}`;
    });
  }

  function applyFxPreset(k) {
    const preset = fxPreset(k);
    if (!preset) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: preset.pos[r.id].x, y: preset.pos[r.id].y }; });
    db.formation = { version: 1, preset: k, pos };
    save();
    cloudPushFormation();
    renderTactics();
    toast(`已套用「${preset.label}」`);
  }

  /* ── 自定义阵型库：把当前站位存成命名阵型 ── */
  function fxPreset(k) {
    const p = FX_PRESETS[k];
    return p ? { label: p.label, pos: p.pos } : null;
  }

  function sameFxPos(a, b) {
    return FX_ROLES.every((r) => Math.abs(a[r.id].x - b[r.id].x) < 0.01 && Math.abs(a[r.id].y - b[r.id].y) < 0.01);
  }

  function saveFxCurrent(name) {
    if (!Array.isArray(db.formations)) db.formations = [];
    if (db.formations.length >= 30) { toast('自定义阵型最多存 30 套，先删掉几个', 'warn'); return; }
    const dup = db.formations.find((f) => f.name === name);
    if (dup) { toast(`已经有叫「${name}」的阵型了`, 'warn'); return; }
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: db.formation.pos[r.id].x, y: db.formation.pos[r.id].y }; });
    db.formations.push({ id: uid('f'), name, pos, at: Date.now() });
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`已保存「${name}」，在下方列表随时套用`);
  }

  function applyFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: f.pos[r.id].x, y: f.pos[r.id].y }; });
    db.formation = { version: 1, preset: 'custom', pos };
    save();
    cloudPushFormation();
    renderTactics();
    toast(`已套用「${f.name}」`);
  }

  async function deleteFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const ok = await confirmDialog({ title: `删除「${f.name}」？`, message: '只删这套保存的阵型，不影响当前站位。这个操作无法撤销。', ok: '确认删除' });
    if (!ok) return;
    db.formations = db.formations.filter((x) => x.id !== id);
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast('阵型已删除');
  }

  function renameFxSaved(id, name) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    name = String(name || '').trim().slice(0, 12);
    if (!name) { toast('名字不能为空', 'warn'); return; }
    if (db.formations.some((x) => x.id !== id && x.name === name)) { toast(`已经有叫「${name}」的阵型了`, 'warn'); return; }
    f.name = name;
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`已改名为「${name}」`);
  }

  function updateFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: db.formation.pos[r.id].x, y: db.formation.pos[r.id].y }; });
    if (sameFxPos(pos, f.pos)) { toast(`「${f.name}」已经是这个站位了`); return; }
    f.pos = pos;
    f.at = Date.now();
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`「${f.name}」已更新为当前站位`);
  }

  let fxRenameId = '';
  function paintFxSaves() {
    const box = $('#fxSaves');
    if (!box) return;
    const list = Array.isArray(db.formations) ? db.formations : [];
    box.innerHTML = list.map((f) => {
      const on = db.formation.preset === 'custom' && sameFxPos(db.formation.pos, f.pos);
      if (fxRenameId === f.id) {
        return `<div class="fx-save on" data-id="${f.id}">
          <input class="fx-rename-input" data-rename="${f.id}" maxlength="12" value="${esc(f.name)}">
          <button type="button" class="fx-act ok" data-rename-ok="${f.id}" aria-label="确认改名">✓</button>
        </div>`;
      }
      return `<div class="fx-save${on ? ' on' : ''}">
        <button type="button" class="fx-save-name" data-apply="${f.id}" title="套用「${esc(f.name)}」">${esc(f.name)}</button>
        <button type="button" class="fx-act" data-rename-btn="${f.id}" title="重命名" aria-label="重命名">✎</button>
        <button type="button" class="fx-act" data-update="${f.id}" title="用当前站位覆盖这套" aria-label="更新站位">⟳</button>
        <button type="button" class="fx-act danger" data-del="${f.id}" title="删除" aria-label="删除 ${esc(f.name)}">×</button>
      </div>`;
    }).join('') || '<div class="fx-save-empty">还没有保存的阵型。摆好站位后点「存当前」。</div>';
    if (fxRenameId) {
      const inp = box.querySelector(`[data-rename="${fxRenameId}"]`);
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function toggleFxSaveRow(show) {
    const row = $('#fxSaveRow');
    if (!row) return;
    const open = show === undefined ? !row.classList.contains('open') : show;
    row.classList.toggle('open', open);
    if (open) { $('#fxSaveName').value = ''; $('#fxSaveName').focus(); }
  }

  function fxMeters(e) {
    const r = $('#fxCourt').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * FX_SIZE, y: (e.clientY - r.top) / r.height * FX_SIZE };
  }

  function fxShowCoord(p) {
    const coord = $('#fxCoord');
    if (!coord) return;
    coord.classList.add('on');
    coord.style.left = (p.x / FX_SIZE * 100) + '%';
    coord.style.top = (p.y / FX_SIZE * 100) + '%';
    coord.textContent = `x ${p.x.toFixed(2)}m · 距网 ${p.y.toFixed(2)}m`;
  }

  function bindFxPointer(el, role) {
    el.addEventListener('pointerdown', (e) => {
      if (fxDrag) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const m = fxMeters(e);
      const p = db.formation.pos[role.id];
      fxDrag = { id: role.id, pid: e.pointerId, dx: m.x - p.x, dy: m.y - p.y, moved: false };
      el.classList.add('dragging');
      fxShowCoord(p);
    });

    el.addEventListener('pointermove', (e) => {
      if (!fxDrag || fxDrag.pid !== e.pointerId || fxDrag.id !== role.id) return;
      e.preventDefault();
      const m = fxMeters(e);
      const x = fxClamp(m.x - fxDrag.dx);
      const y = fxClamp(m.y - fxDrag.dy);
      fxDrag.moved = true;
      db.formation.pos[role.id] = { x, y };
      el.style.left = (x / FX_SIZE * 100) + '%';
      el.style.top = (y / FX_SIZE * 100) + '%';
      fxShowCoord({ x, y });
    });

    const end = (e) => {
      if (!fxDrag || fxDrag.pid !== e.pointerId || fxDrag.id !== role.id) return;
      const moved = fxDrag.moved;
      fxDrag = null;
      el.classList.remove('dragging');
      const coord = $('#fxCoord');
      if (coord) coord.classList.remove('on');
      if (!moved) return;
      const p = db.formation.pos[role.id];
      db.formation.pos[role.id] = { x: fxSnap(p.x), y: fxSnap(p.y) };
      db.formation.preset = 'custom';
      save();
      cloudPushFormation();
      renderTactics();
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', (e) => { if (fxDrag) end(e); });
  }

  function bindFxKeys(el, role) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    el.addEventListener('keydown', (e) => {
      const d = step[e.key];
      if (!d) return;
      e.preventDefault();
      const p = db.formation.pos[role.id];
      db.formation.pos[role.id] = { x: fxClamp(p.x + d[0] * FX_SNAP), y: fxClamp(p.y + d[1] * FX_SNAP) };
      db.formation.preset = 'custom';
      save();
      cloudPushFormation();
      renderTactics();
      fxShowCoord(db.formation.pos[role.id]);
      setTimeout(() => { const c = $('#fxCoord'); if (c) c.classList.remove('on'); }, 900);
    });
  }

  /* ══════════ 页面切换 ══════════ */
  function go(page) {
    if (!PAGES[page]) return;
    if (page !== 'tactics' && document.body.classList.contains('fx-immersive')) exitFxFull();
    state.page = page;
    $$('.page').forEach((el) => el.classList.toggle('active', el.id === 'page-' + page));
    $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
    $('#pageTitle').textContent = PAGES[page].title;
    $('#pageKicker').textContent = PAGES[page].kicker;
    closePopovers(); closeDrawer(); closeModal(); closePalette(); closeSidebar();
    if (page === 'dashboard') renderDashboard();
    if (page === 'roster') renderRoster();
    if (page === 'attendance') renderAttendance();
    if (page === 'tactics') renderTactics();
    if (page === 'growth') renderGrowth();
    if (page === 'ai') renderAiPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    refreshReveals();
    setTimeout(refreshReveals, 140);
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
  }

  function renderAllCurrent() {
    renderSidebar();
    renderActivity();
    if (state.page === 'dashboard') renderDashboard();
    if (state.page === 'roster') renderRoster();
    if (state.page === 'attendance') renderAttendance();
    if (state.page === 'tactics') renderTactics();
    if (state.page === 'growth') renderGrowth();
  }

  /* ══════════ 命令面板 ══════════ */
  function paletteItems() {
    return [
      ...Object.keys(PAGES).map((k) => ({ kind: '页面', icon: '▦', title: PAGES[k].title, sub: PAGES[k].kicker, run: () => go(k) })),
      { kind: '操作', icon: '＋', title: '添加队员', sub: '姓名、号码、位置、6 项初始技能', run: () => openPlayerForm() },
      { kind: '操作', icon: '＋', title: '添加加练', sub: '在指定周加一次训练', run: () => openSessionModal(null, state.weekMonday, { isNew: true }) },
      { kind: '操作', icon: '✓', title: '训练后调整', sub: '按参训名单批量加减技能点', run: openBatchAdjust },
      { kind: '操作', icon: '⚙', title: '训练模板', sub: '修改固定训练时间与地点', run: openSettings },
      { kind: '设置', icon: '◐', title: '主题色', sub: '极光 / 深海 / 松林 / 落日 / 樱粉 / 石墨', run: openTheme },
      { kind: '操作', icon: '⤓', title: '导出备份', sub: '下载 JSON 数据文件', run: exportData },
      ...db.players.map((p) => ({ kind: '队员', icon: String(p.number), title: p.name, sub: `${p.position} · ${p.grade} · ${p.height}cm`, run: () => openPlayer(p.id) }))
    ];
  }

  function openPalette() {
    closePopovers();
    $('#paletteScrim').classList.add('show');
    syncLock();
    const input = $('#paletteInput');
    input.value = '';
    renderPalette('');
    setTimeout(() => input.focus(), 80);
  }

  function renderPalette(q) {
    const query = q.trim().toLowerCase();
    state.palette = paletteItems().filter((it) => !query || (it.title + it.sub + it.kind).toLowerCase().includes(query));
    state.paletteIndex = 0;
    const list = $('#paletteList');
    list.innerHTML = state.palette.length ? state.palette.map((it, i) => `
      <button class="pal-item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="pal-ico">${esc(it.icon)}</span><span class="pal-txt"><strong>${esc(it.title)}</strong><span>${esc(it.sub)}</span></span><span class="pal-kind">${it.kind}</span></button>`).join('') : '<div class="pal-empty">没有找到匹配项。</div>';
    $('#paletteCount').textContent = state.palette.length;
    $$('#paletteList .pal-item').forEach((el) => {
      el.onclick = () => { const it = state.palette[Number(el.dataset.i)]; closePalette(); it.run(); };
    });
  }

  function movePalette(dir) {
    if (!state.palette.length) return;
    state.paletteIndex = (state.paletteIndex + dir + state.palette.length) % state.palette.length;
    $$('#paletteList .pal-item').forEach((el, i) => el.classList.toggle('active', i === state.paletteIndex));
    const active = $('#paletteList .pal-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  /* ══════════ 事件绑定 ══════════ */
  function bind() {
    $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.page)));
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) {
        e.preventDefault();
        if (g.dataset.goto === 'attendance' && state.page === 'dashboard') state.weekMonday = getMonday(new Date());
        go(g.dataset.goto);
        return;
      }
      const t = e.target.closest('[data-toast]');
      if (t) toast(t.dataset.toast);
      if (e.target.closest('[data-close-modal]')) closeModal();
      const a = e.target.closest('[data-action]');
      if (a) {
        const action = a.dataset.action;
        const targetMonday = state.page === 'dashboard' ? getMonday(new Date()) : state.weekMonday;
        if (action === 'add-player') openPlayerForm(null, { position: a.dataset.position });
        else if (action === 'bulk-import') openBulkImport();
        else if (action === 'add-session') openSessionModal(null, targetMonday, { isNew: true });
        else if (action === 'reset-week') resetWeek(targetMonday);
        else if (action === 'export') exportData();
        else if (action === 'import') openImportChooser();
        else if (action === 'paste-import') openPasteImport();
        else if (action === 'clear-data') clearAllData();
        else if (action === 'template') openSettings();
        else if (action === 'help') openHelp();
        else if (action === 'edit-player') openPlayerForm(a.dataset.player);
        else if (action === 'delete-player') deletePlayer(a.dataset.player);
        else if (action === 'clear-filter') { state.rosterFilter = '全部'; state.rosterSearch = ''; $('#rosterSearch').value = ''; renderRoster(); }
      }
    });

    $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
    $('#scrim').onclick = closeSidebar;

    const togglePop = (btnId, popId) => {
      const btn = $(btnId);
      const pop = $(popId);
      btn.onclick = (e) => {
        e.stopPropagation();
        const open = pop.classList.contains('open');
        closePopovers();
        if (!open) pop.classList.add('open');
      };
    };
    togglePop('#activityBtn', '#activityPop');
    togglePop('#avatarBtn', '#userPop');
    $('#themeBtn').onclick = () => { closePopovers(); openTheme(); };
    $('#userChip').onclick = () => openSettings();
    $$('.popover').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
    document.addEventListener('click', () => closePopovers());

    $('#activityList').addEventListener('click', (e) => {
      const item = e.target.closest('[data-activity]');
      if (!item) return;
      closePopovers();
      if (item.dataset.player) openPlayer(item.dataset.player);
      else if (item.dataset.week) { state.weekMonday = getMonday(parseKey(item.dataset.week)); go('attendance'); }
    });

    $('#menuTemplate').onclick = () => { closePopovers(); openSettings(); };
    $('#menuTheme').onclick = () => { closePopovers(); openTheme(); };
    $('#menuShare').onclick = () => { closePopovers(); openShareModal(); };
    $('#menuExport').onclick = () => { closePopovers(); exportData(); };
    $('#menuImport').onclick = () => { closePopovers(); openImportChooser(); };
    $('#menuClear').onclick = () => { closePopovers(); clearAllData(); };
    $('#menuAbout').onclick = () => { closePopovers(); openHelp(); };

    $('#searchTrigger').onclick = openPalette;
    $('#paletteScrim').onclick = (e) => { if (e.target === $('#paletteScrim')) closePalette(); };
    const pInput = $('#paletteInput');
    pInput.addEventListener('input', () => renderPalette(pInput.value));
    pInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = state.palette[state.paletteIndex]; if (it) { closePalette(); it.run(); } }
      else if (e.key === 'Escape') closePalette();
    });

    window.addEventListener('scroll', () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      $('#scrollBar').style.transform = `scaleX(${max > 0 ? doc.scrollTop / max : 0})`;
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#paletteScrim').classList.contains('show') ? closePalette() : openPalette();
      }
      if (e.key === 'Escape') {
        if (state.confirmResolver) { resolveConfirm(false); return; }
        closePalette(); closeModal(); closeDrawer(); closePopovers(); closeSidebar();
      }
    });

    $('#aiSettingsPageBtn').onclick = renderAiSettings;

    $('#drawerClose').onclick = closeDrawer;
    $('#drawerScrim').onclick = closeDrawer;
    $('#modalClose').onclick = closeModal;
    $('#modalScrim').onclick = (e) => { if (e.target === $('#modalScrim')) closeModal(); };
    $('#confirmCancel').onclick = () => resolveConfirm(false);
    $('#confirmOk').onclick = () => resolveConfirm(true);
    $('#confirmScrim').onclick = (e) => { if (e.target === $('#confirmScrim')) resolveConfirm(false); };

    $('#roleFilters').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.rosterFilter = chip.dataset.role;
      renderRoster();
    });
    $('#rosterSearch').addEventListener('input', (e) => { state.rosterSearch = e.target.value; renderRoster(); });
    $('#addPlayerBtn').onclick = () => openPlayerForm();
    $('#bulkImportBtn').onclick = () => openBulkImport();
    $('#rosterGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.player-card');
      if (card) openPlayer(card.dataset.id);
    });

    $('#courtPlayers').addEventListener('click', (e) => {
      const pos = e.target.closest('.pos');
      if (!pos) return;
      if (pos.dataset.player) openPlayer(pos.dataset.player);
      else openPlayerForm(null, { position: pos.dataset.role });
    });

    $('#stackToggle').onclick = () => {
      state.stackOpen = !state.stackOpen;
      const stack = $('#stack');
      const count = Number(stack.dataset.count || 0);
      stack.classList.toggle('open', state.stackOpen);
      stack.style.height = state.stackOpen ? `${Math.max(96, count * 96)}px` : '96px';
      const btn = $('#stackToggle');
      btn.classList.toggle('on', state.stackOpen);
      btn.querySelector('span').textContent = state.stackOpen ? '收起' : '展开';
    };
    $('#stack').addEventListener('click', (e) => {
      const card = e.target.closest('.stack-card');
      if (card) openPlayer(card.dataset.player);
    });
    $('#onboardSteps').addEventListener('click', (e) => {
      const step = e.target.closest('.onboard-step');
      if (!step) return;
      const s = step.dataset.step;
      if (s === 'template') openSettings();
      if (s === 'player') openPlayerForm();
      if (s === 'attendance') { state.weekMonday = getMonday(new Date()); go('attendance'); }
      if (s === 'growth') go('growth');
    });

    $('#weekPrev').onclick = () => { state.weekMonday = addDays(state.weekMonday, -7); renderAttendance(); };
    $('#weekNext').onclick = () => { state.weekMonday = addDays(state.weekMonday, 7); renderAttendance(); };
    $('#weekToday').onclick = () => { state.weekMonday = getMonday(new Date()); renderAttendance(); };
    $('#attAddBtn').onclick = () => openSessionModal(null, getMonday(new Date()), { isNew: true });
    $('#attAddBtnPage').onclick = () => openSessionModal(null, state.weekMonday, { isNew: true });
    $('#allPresent').onclick = setAllPresent;
    $('#attCardBtn').onclick = openWeekCard;
    $('#attSeasonBtn').onclick = openSeasonCard;
    $('#attRcptBtn').onclick = () => openReceiptModal();
    $('#attGrid').addEventListener('click', (e) => {
      const head = e.target.closest('.att-session-head');
      if (head) {
        const s = getSessions(state.weekMonday).find((x) => x.id === head.dataset.session);
        if (s) openSessionModal(s.id, state.weekMonday);
        return;
      }
      const cell = e.target.closest('.att-cell');
      if (cell) onAttCellClick(cell);
    });
    $('#sessionList').addEventListener('click', (e) => {
      const btn = e.target.closest('.session-mini');
      if (btn) openSessionModal(btn.dataset.session, state.weekMonday);
    });

    $('#batchBtn').onclick = openBatchAdjust;
    $('#manualBtn').onclick = () => openAdjustModal();
    $('#skillMatrix').addEventListener('click', (e) => {
      const open = e.target.closest('[data-open-player]');
      if (open) { openPlayer(open.dataset.openPlayer); return; }
      const cell = e.target.closest('.m-cell');
      if (cell) openAdjustModal(cell.dataset.player, cell.dataset.skill);
    });
    $('#recentLogs').addEventListener('click', (e) => {
      const row = e.target.closest('[data-open-player]');
      if (row) openPlayer(row.dataset.openPlayer);
    });

    $('#importFile').addEventListener('change', (e) => handleImportFile(e.target.files[0]));

    $$('.card-spot').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
    document.addEventListener('pointermove', (e) => {
      const btn = e.target.closest('.magnetic');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) / r.width * 8;
      const y = (e.clientY - r.top - r.height / 2) / r.height * 8;
      btn.style.transform = `translate(${x.toFixed(1)}px, ${(y - 2).toFixed(1)}px)`;
    });
    document.addEventListener('pointerout', (e) => {
      const btn = e.target.closest('.magnetic');
      if (btn) btn.style.transform = '';
    });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const sp = document.createElement('span');
      sp.className = 'ripple';
      sp.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      btn.appendChild(sp);
      setTimeout(() => sp.remove(), 700);
    });
  }

  /* ══════════ 云端桥接（双模式：不登录则全部走本地，不触发这里） ══════════ */
  const CloudOn = () => !!(window.XGYCloud && window.XGYCloud.enabled());

  /** 云端模式下确保某周训练已从服务器拉过；拉到后重渲染当前页 */
  function cloudEnsureWeek(monday) {
    if (!CloudOn()) return;
    const key = weekKey(monday);
    window.XGYCloud.syncWeek(key).then((ok) => { if (ok) renderAllCurrent(); });
  }

  function applyServerState(payload) {
    db.players = (payload.players || []).map(normalizePlayer).filter((p) => p.name);
    db.skillLogs = (payload.skillLogs || []).map(normalizeLog).filter(Boolean);
    if (Array.isArray(payload.template)) {
      db.settings.template = payload.template.map((t, i) => ({
        id: t.id || uid('t'),
        day: Number.isFinite(Number(t.day)) ? Number(t.day) : [2, 5, 0][i] || 2,
        label: t.label || WEEK_CN[Number(t.day)] || '',
        start: t.start || '16:30',
        end: t.end || '18:30',
        venue: String(t.venue || '')
      }));
    }
    if (payload.theme && isTheme(payload.theme)) {
      db.settings.theme = payload.theme;
      applyTheme(payload.theme);
    }
    if (payload.formation && payload.formation.pos) {
      db.formation = normalizeFormation({ version: 1, preset: payload.formation.preset, pos: payload.formation.pos });
    }
    // 云端阵型库以服务器为准（本地同名字段直接覆盖）
    if (Array.isArray(payload.formations)) {
      db.formations = payload.formations.slice(0, 30).map((f) => {
        if (!f || typeof f !== 'object') return null;
        const pos = normalizeFormation({ version: 1, preset: 'custom', pos: f.pos }).pos;
        return { id: f.id || uid('f'), name: String(f.name || '未命名').slice(0, 16), pos, at: Number(f.at) || Date.now() };
      }).filter(Boolean);
    }
    save();
  }

  function applyWeek(key, sessions) {
    db.weeks[key] = (sessions || []).map(normalizeSession).filter(Boolean).sort(sessionSort);
    save();
  }

  /** 高频写后台推送；失败时回拉对应数据，以服务器为准 */
  function cloudFire(promise, resync) {
    window.XGYCloud.fireAndSync(promise, resync || (() => cloudResyncAll()));
  }

  function cloudResyncAll() {
    window.XGYCloud.pullCore().then(() => renderAllCurrent()).catch(() => {});
  }

  /** 阵型高频拖动：防抖 600ms 后推送 */
  let fxPushTimer = null;
  function cloudPushFormation() {
    if (!CloudOn()) return;
    clearTimeout(fxPushTimer);
    fxPushTimer = setTimeout(() => {
      cloudFire(window.XGYCloud.push.formation(db.formation), null);
    }, 600);
  }

  /** 阵型库增删改后整库推送（低频操作，直接推；失败回拉全量） */
  function cloudPushFxLibrary() {
    if (!CloudOn() || !Array.isArray(db.formations)) return;
    cloudFire(window.XGYCloud.push.formationLibrary(db.formations), null);
  }

  /* ══════════ AI 助手（BYOK 直连，OpenAI 兼容接口） ══════════ */
  const AI_PRESETS = [
    { label: 'DeepSeek（推荐，便宜）', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { label: 'Kimi 月之暗面', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { label: '自定义（OpenAI 兼容）', base: '', model: '' }
  ];

  function aiCfg() {
    if (!db.settings.ai) db.settings.ai = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
    return db.settings.ai;
  }

  function aiUrl(base) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    return /chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
  }

  /** 组装喂给模型的全队上下文（只带必要字段，控制体积） */
  function aiContext() {
    const monday = state.page === 'dashboard' ? getMonday(new Date()) : state.weekMonday;
    const stats = weekStats(monday);
    const players = db.players.map((p) => {
      const att = stats.perPlayer.get(p.id) || {};
      return {
        姓名: p.name, 号码: p.number, 位置: p.position, 年级: p.grade, 身高cm: p.height,
        技能: SKILLS.reduce((o, s) => { o[s.label] = Number(p.skills[s.key]); return o; }, {}),
        本周: { 出勤: att.present || 0, 迟到: att.late || 0, 请假: att.leave || 0, 缺席: att.absent || 0 }
      };
    });
    const sessions = (db.weeks[weekKey(monday)] || []).map((s) => ({
      日期: s.date, 时间: `${s.start}-${s.end}`, 状态: s.status, 说明: s.cancelReason || s.venue || ''
    }));
    const logs = db.skillLogs.slice(-30).map((l) => {
      const pl = db.players.find((p) => p.id === l.playerId);
      const sk = SKILLS.find((s) => s.key === l.skill);
      return `${pl ? pl.name : '?'}：${sk ? sk.label : l.skill} ${l.before}→${l.after}（${l.date}）`;
    });
    return `# 球员（${players.length} 人）\n${JSON.stringify(players)}\n\n# 本周训练安排\n${JSON.stringify(sessions)}\n\n# 最近技能调整\n${logs.join('\n') || '（无）'}`;
  }

  const AI_SYSTEM = () => `你是一所高校院系排球队的助理教练。用户是队长。根据下面提供的真实数据回答问题、完成任务。
要求：用简体中文；语气自然、接地气，适合直接复制发到队群；只用数据里出现的信息，不要编造；人数、姓名、数字要和数据一致；回答尽量精炼。

${aiContext()}`;

  const AI_TASKS = [
    { id: 'week', icon: '📋', label: '本周小结', desc: '谁全勤、谁要提醒，一段话直接发群里', prompt: '根据本周训练安排和每个人的出勤数据，生成本周训练小结：谁全勤、谁迟到或缺席要点名提醒，再带一句下周鼓励。控制在 200 字以内，适合直接发群里。' },
    { id: 'lineup', icon: '🏐', label: '阵容建议', desc: '按身高和六项技能排 6 人首发站位', prompt: '根据队员的身高、位置和六项技能，给出一套周六友谊赛的 6 人首发站位建议（主攻×2、副攻、接应、二传、自由人各一），说明每条选择的理由；哪个位置缺人就直说，并给替补方案。' },
    { id: 'praise', icon: '⭐', label: '队员点评', desc: '选一名队员，生成鼓励式成长点评', prompt: '__PLAYER__' }
  ];

  function aiMsgHTML(role, text) {
    return `<div class="ai-msg ${role === 'user' ? 'me' : 'bot'}"><div class="ai-bubble">${text}</div></div>`;
  }

  function aiRender(text) {
    // 极简 markdown：转义后支持 **粗体**、`代码`、换行
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function aiQuickHTML() {
    return AI_TASKS.map((t) => `<button type="button" class="ai-task" data-task="${t.id}"><span>${t.icon}</span>${t.label}</button>`).join('') +
      `<button type="button" class="ai-task ai-clear" data-clear="1"><span>🧹</span>清空对话</button>`;
  }

  function bindTasks() {
    $$('#aiPageBody .ai-task[data-task]').forEach((btn) => {
      btn.onclick = () => {
        const t = AI_TASKS.find((x) => x.id === btn.dataset.task);
        if (t.id === 'praise') { renderAiPraisePicker(); return; }
        aiRun(t.prompt, t.label);
      };
    });
    const clr = $('#aiPageBody [data-clear]');
    if (clr) clr.onclick = () => {
      if (!state.ai.messages.length) return;
      state.ai.messages = [];
      db.aiChat = [];
      save();
      renderAiPage();
      toast('对话已清空');
    };
  }

  /** 聊天记录镜像进 db（localStorage 持久化），最多留 100 条 */
  function aiRemember() {
    db.aiChat = state.ai.messages.slice(-100);
    save();
  }

  /** 首条消息发出后把欢迎页换成精简任务条 */
  function mountQuick() {
    const shell = $('#aiShell');
    if (!shell || $('#aiTop')) return $('#aiTop');
    shell.querySelector('.ai-log').insertAdjacentHTML('afterend', `<div class="ai-quick" id="aiTop">${aiQuickHTML()}</div>`);
    bindTasks();
    return $('#aiTop');
  }

  function renderAiPage() {
    const cfg = aiCfg();
    if (!state.ai) state.ai = { messages: (db.aiChat || []).slice(), busy: false, abort: null };
    const body = $('#aiPageBody');
    if (!body) return;
    $('#aiSub').textContent = cfg.key
      ? '带着全队的真实数据回答：小结、阵容、点评，随口问也行。'
      : '先填一个 API Key（只存本机），一分钟就能用。';
    if (!cfg.key) { renderAiSettings(); return; }
    const hasMsg = state.ai.messages.length > 0;
    const hero = `
      <div class="ai-hero">
        <div class="ai-hero-ico">✦</div>
        <h3>你的助理教练已就位</h3>
        <p>它读得到全队名单、本周考勤和技能记录，<br>挑一个开始，或直接在下面提问：</p>
        <div class="ai-cards">
          ${AI_TASKS.map((t) => `<button type="button" class="ai-card" data-task="${t.id}"><span class="ai-card-ico">${t.icon}</span><b>${t.label}</b><i>${t.desc}</i></button>`).join('')}
        </div>
      </div>`;
    body.innerHTML = `
      <div class="ai-panel reveal">
        <div class="ai-shell" id="aiShell">
          <div class="ai-log" id="aiLog">${hasMsg ? state.ai.messages.map((m) => aiMsgHTML(m.role, aiRender(m.content))).join('') : hero}</div>
          ${hasMsg ? `<div class="ai-quick" id="aiTop">${aiQuickHTML()}</div>` : ''}
          <form class="ai-input" id="aiForm">
            <textarea id="aiText" rows="1" placeholder="输入问题，Enter 发送，Shift+Enter 换行"></textarea>
            <button type="submit" class="ai-send" id="aiSend" data-tip="发送">${state.ai.busy ? '■' : '↑'}</button>
          </form>
        </div>
      </div>`;
    bindTasks();
    wireAiChat();
    // 重渲染后必须刷新入场动画，否则 .reveal 元素一直 opacity:0（面板隐形）
    refreshReveals();
  }

  function aiSettingsHTML() {
    const cfg = aiCfg();
    const presetIdx = AI_PRESETS.findIndex((p) => p.base && p.base === cfg.base);
    return `<div class="ai-panel reveal"><div class="ai-settings">
      <div class="form-note" style="margin:2px 0 14px">自带钥匙（BYOK）：API Key 只存在你这台设备的浏览器里，请求由浏览器直连你选的服务商，不经过任何中间服务器。</div>
      <div class="field"><label>服务商</label><select id="aiPreset">${AI_PRESETS.map((p, i) => `<option value="${i}" ${i === (presetIdx < 0 ? AI_PRESETS.length - 1 : presetIdx) ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div class="field"><label>接口地址（Base URL）</label><input id="aiBase" value="${esc(cfg.base)}" placeholder="https://api.deepseek.com"></div>
      <div class="field"><label>模型</label><input id="aiModel" value="${esc(cfg.model)}" placeholder="deepseek-chat"></div>
      <div class="field"><label>API Key</label><input id="aiKey" type="password" value="${esc(cfg.key)}" placeholder="sk-..." autocomplete="off"></div>
      <div class="form-note">DeepSeek 的 Key 在 platform.deepseek.com 充几块钱就够用一学期。</div>
      <div class="form-foot"><button type="button" class="btn btn-primary" id="aiSave">保存并开始</button></div>
    </div></div>`;
  }

  function renderAiSettings() {
    $('#aiPageBody').innerHTML = aiSettingsHTML();
    wireAiSettings();
    refreshReveals();
  }

  function wireAiSettings() {
    const sel = $('#aiPreset');
    sel.onchange = () => {
      const p = AI_PRESETS[Number(sel.value)];
      if (p.base) { $('#aiBase').value = p.base; $('#aiModel').value = p.model; }
    };
    $('#aiSave').onclick = () => {
      const cfg = aiCfg();
      cfg.base = $('#aiBase').value.trim() || 'https://api.deepseek.com';
      cfg.model = $('#aiModel').value.trim() || 'deepseek-chat';
      cfg.key = $('#aiKey').value.trim();
      if (!cfg.key) { toast('API Key 还没填', 'warn'); return; }
      db.aiChat = [];
      save();
      state.ai = { messages: [], busy: false, abort: null };
      toast('AI 助手已就绪');
      renderAiPage();
    };
  }

  function wireAiChat() {
    const form = $('#aiForm');
    const ta = $('#aiText');
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (state.ai.busy) { if (state.ai.abort) state.ai.abort.abort(); return; }
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      ta.style.height = 'auto';
      aiRun(text);
      ta.focus();
    };
    const log = $('#aiLog');
    log.scrollTop = log.scrollHeight;
  }

  function renderAiPraisePicker() {
    const top = mountQuick() || $('#aiPageBody');
    if (!top || $('#aiPicker')) return;
    top.insertAdjacentHTML('beforeend', `<div class="ai-picker" id="aiPicker"><b>点评谁？</b><div>${db.players.map((p) => `<button type="button" data-id="${p.id}">${esc(p.name)}</button>`).join('') || '<span class="ip-tag warn">先添加队员</span>'}<button type="button" class="x" data-x="1">取消</button></div></div>`);
    const picker = $('#aiPicker');
    picker.querySelectorAll('button[data-id]').forEach((b) => {
      b.onclick = () => {
        const p = getPlayer(b.dataset.id);
        picker.remove();
        if (!p) return;
        aiRun(`给 ${p.name}（${p.position}，${p.grade}）写一段 60 字以内的鼓励式点评：先夸他最突出的一项技能和近期出勤，再点出最值得练的一项，语气像队长说话，最后加一个具体可行的小目标。`, `点评 · ${p.name}`);
      };
    });
    picker.querySelector('button[data-x]').onclick = () => picker.remove();
  }

  async function aiRun(prompt, label) {
    const cfg = aiCfg();
    if (!cfg.key) { renderAiSettings(); return; }
    if (state.ai.busy) return;
    state.ai.messages.push({ role: 'user', content: label ? `【${label}】${prompt}` : prompt });
    aiRemember();
    state.ai.busy = true;
    // 页面可能被切走，每次都现查节点，避免引用已销毁的 DOM
    const $log = () => $('#aiLog');
    const log = $log();
    if (log) {
      log.querySelector('.ai-hero') && (log.innerHTML = '');
      mountQuick();
      log.insertAdjacentHTML('beforeend', aiMsgHTML('user', aiRender(state.ai.messages[state.ai.messages.length - 1].content)));
      log.insertAdjacentHTML('beforeend', `<div class="ai-msg bot" id="aiStreaming"><div class="ai-bubble"><span class="ai-dot"></span></div></div>`);
      log.scrollTop = log.scrollHeight;
    }
    const send = $('#aiSend');
    if (send) { send.textContent = '■'; send.dataset.tip = '停止'; }

    const messages = [
      { role: 'system', content: AI_SYSTEM() },
      ...state.ai.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
    ];
    state.ai.abort = new AbortController();
    let full = '';
    try {
      const res = await fetch(aiUrl(cfg.base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.7 }),
        signal: state.ai.abort.signal
      });
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = j.error && (j.error.message || j.error.code) || j.message || ''; } catch (err) { /* ignore */ }
        throw new Error(`HTTP ${res.status}${detail ? `：${detail}` : ''}${res.status === 401 ? '（Key 不对或已过期）' : res.status === 402 ? '（余额不足）' : ''}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) full += delta;
          } catch (err) { /* 忽略不完整行 */ }
        }
        const node = $('#aiStreaming .ai-bubble');
        if (node && full) node.innerHTML = aiRender(full);
        const lg = $log();
        if (lg) lg.scrollTop = lg.scrollHeight;
      }
      state.ai.messages.push({ role: 'assistant', content: full || '（空回复）' });
    } catch (err) {
      const aborted = err.name === 'AbortError';
      if (aborted && full) {
        state.ai.messages.push({ role: 'assistant', content: full });
      } else {
        const msg = aborted ? '已停止生成。' : `请求失败：${err.message}。检查接口地址 / Key / 余额；浏览器直连被拦时换 Chrome 或 Edge 试试。`;
        state.ai.messages.push({ role: 'assistant', content: msg });
      }
    } finally {
      state.ai.busy = false;
      state.ai.abort = null;
      aiRemember();
      const streamNode = $('#aiStreaming');
      if (streamNode) {
        const wrap = document.createElement('div');
        wrap.innerHTML = aiMsgHTML('assistant', aiRender(state.ai.messages[state.ai.messages.length - 1].content));
        streamNode.replaceWith(wrap.firstElementChild);
      }
      const sd = $('#aiSend');
      if (sd) { sd.textContent = '↑'; sd.dataset.tip = '发送'; }
      const lg = $log();
      if (lg) lg.scrollTop = lg.scrollHeight;
    }
  }

  /* ══════════ 启动 ══════════ */
  function init() {
    state.weekMonday = getMonday(new Date());
    applyTheme(db.settings.theme);
    const fm = $('.footer-meta');
    if (fm) fm.textContent += ` · ${BUILD}`;
    $('#pageTitle').textContent = PAGES.dashboard.title;
    $('#pageKicker').textContent = PAGES.dashboard.kicker;
    renderSidebar();
    renderDashboard();
    renderActivity();
    bind();
    refreshReveals();
    setTimeout(refreshReveals, 400);
    // 队员发来的回执链接（#rcpt=…）：直接弹确认框；hash 先清掉，免得刷新又弹一次
    const rc = location.hash.match(/^#rcpt=(.+)$/);
    if (rc) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      setTimeout(() => openReceiptModal(decodeURIComponent(rc[1])), 260);
    }
    if (window.XGYCloud) {
      window.XGYCloud.attach({
        toast,
        openModal,
        closeModal,
        getDB: () => db,
        save,
        renderAll: renderAllCurrent,
        applyServerState,
        applyWeek,
        currentMondayKey: () => weekKey(state.weekMonday)
      });
      cloudEnsureWeek(state.weekMonday);
    }
    initPWA();
  }

  /* ══════════ PWA：Service Worker 注册 + 安装引导 ══════════ */
  function initPWA() {
    // file://（单文件分发）下 SW 不可用，直接跳过；线上（https）和本地调试（http）才注册
    if (!/^https?:$/.test(location.protocol)) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 注册失败不影响使用 */ });
    }

    const DISMISS_KEY = 'xgy_pwa_install_dismiss';
    const alreadyStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (alreadyStandalone) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    let installEvent = null;
    const banner = document.createElement('div');
    banner.className = 'pwa-install';
    banner.hidden = true;
    banner.innerHTML = `
      <img src="assets/icon-192.png" alt="" width="34" height="34">
      <div class="pwa-install-txt"><b>安装到桌面</b><i>离线也能打开，像原生 App 一样</i></div>
      <button type="button" class="pwa-install-go">安装</button>
      <button type="button" class="pwa-install-x" aria-label="不再提示">×</button>`;
    document.body.appendChild(banner);
    const show = () => { banner.hidden = false; requestAnimationFrame(() => banner.classList.add('show')); };
    const dismiss = () => {
      banner.classList.remove('show');
      localStorage.setItem(DISMISS_KEY, '1');
      setTimeout(() => banner.remove(), 400);
    };
    banner.querySelector('.pwa-install-x').addEventListener('click', dismiss);
    banner.querySelector('.pwa-install-go').addEventListener('click', async () => {
      if (installEvent) {
        installEvent.prompt();
        try {
          const { outcome } = await installEvent.userChoice;
          if (outcome === 'accepted') dismiss();
        } catch (err) { /* 用户关掉了系统弹窗 */ }
        installEvent = null;
      } else {
        // iOS Safari 没有 beforeinstallprompt：引导手动「添加到主屏幕」
        dismiss();
      }
    });

    // Android / 桌面 Chrome/Edge：原生安装流
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installEvent = e;
      setTimeout(show, 2500); // 进页面先玩 2.5 秒再提示，别一上来就拦
    });
    // iOS Safari：没有安装 API，展示「分享 → 添加到主屏幕」引导
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !/crios|fxios|edgiOS/i.test(navigator.userAgent)) {
      banner.querySelector('.pwa-install-txt i').textContent = 'Safari 分享菜单 → 添加到主屏幕';
      banner.querySelector('.pwa-install-go').textContent = '知道了';
      setTimeout(show, 3500);
    }
    window.addEventListener('appinstalled', () => dismiss());
  }

  init();
})();
