/* ═══════════════════════════════════════════════════════
   信工院排球队 · 本地球队管理
   队员 / 训练 / 考勤 / 技能点 · 纯原生 JS
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════ 工具 ══════════ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const roundHalf = (v) => Math.round(Number(v) * 2) / 2;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let uidSeq = 0;
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
    growth: { title: '成长计划', kicker: 'SKILLS / GROWTH' }
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

  const FX_PRESETS = {
    base: {
      label: '默认站位',
      hint: '前排 3 后排 3',
      pos: {
        s: { x: 6.30, y: 1.10 }, mb: { x: 4.50, y: 0.85 }, opp: { x: 2.60, y: 1.35 },
        oh1: { x: 1.80, y: 5.60 }, lib: { x: 4.50, y: 7.00 }, oh2: { x: 7.00, y: 5.90 }
      }
    },
    deep: {
      label: '退守',
      hint: '全员退到 3m 线后',
      pos: {
        s: { x: 6.80, y: 3.60 }, mb: { x: 4.50, y: 3.35 }, opp: { x: 2.20, y: 3.80 },
        oh1: { x: 1.40, y: 7.40 }, lib: { x: 4.50, y: 8.20 }, oh2: { x: 7.40, y: 7.40 }
      }
    },
    block: {
      label: '网前拦防',
      hint: '前排贴网，后排跟进',
      pos: {
        s: { x: 6.20, y: 0.60 }, mb: { x: 4.50, y: 0.40 }, opp: { x: 2.80, y: 0.55 },
        oh1: { x: 2.00, y: 3.40 }, lib: { x: 4.50, y: 3.60 }, oh2: { x: 7.00, y: 3.40 }
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
    return { version: SCHEMA, settings: { template: clone(DEFAULT_TEMPLATE), theme: 'aurora' }, players: [], weeks: {}, skillLogs: [], formation: blankFormation() };
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
    confirmResolver: null
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

  function renderAttSide(stats) {
    paintDonut(stats);
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
            return `<td><div class="batch-stepper" data-player="${p.id}" data-skill="${sk.key}" data-value="${v.toFixed(1)}" data-original="${v.toFixed(1)}"><button type="button" data-step="-0.5">−</button><b>${v.toFixed(1)}</b><button type="button" data-step="0.5">+</button></div></td>`;
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
      <div class="settings-actions"><button class="btn btn-ghost" data-action="export">导出 JSON</button><button class="btn btn-ghost" data-action="import">导入 JSON</button><button class="btn btn-danger-ghost" data-action="clear-data">清空所有数据</button></div>
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
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
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

  async function handleImportFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      if (!raw || raw.version !== SCHEMA) { toast('备份文件版本不匹配', 'warn'); return; }
      const next = normalizeDB(raw);
      const ok = await confirmDialog({ title: '导入备份？', message: `会覆盖当前所有数据，导入 ${next.players.length} 名队员、${next.skillLogs.length} 条技能记录。`, ok: '覆盖并导入' });
      if (!ok) return;
      db = next; save(); location.reload();
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
      <p><b>6. 阵型板摆站位。</b> 进入阵型页，手指（或鼠标）把 6 个角色拖到防守位置，松手按 0.25m 吸附并自动保存。三套预设可一键套用，双击或方向键可微调。</p>
      <p><b>7. 定期备份。</b> 设置或头像菜单里导出 JSON。换电脑前先导出。</p>
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

    $('#fxPresets').innerHTML = Object.keys(FX_PRESETS).map((k) =>
      `<button type="button" class="fx-preset" data-preset="${k}"><span>${FX_PRESETS[k].label}</span><em>${FX_PRESETS[k].hint}</em></button>`
    ).join('');

    $('#fxRoles').innerHTML = FX_ROLES.map((r) =>
      `<li class="fx-role" style="--role:${r.color}"><i class="fx-role-dot"></i><span class="fx-role-name">${r.name}</span><span class="fx-role-pos" data-pos="${r.id}">—</span></li>`
    ).join('');

    $('#fxPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (btn) applyFxPreset(btn.dataset.preset);
    });

    $('#fxReset').addEventListener('click', () => applyFxPreset('base'));
    $('#fxFull').addEventListener('click', toggleFxFull);
    $('#fxExit').addEventListener('click', exitFxFull);
    $('#fxExitTop').addEventListener('click', exitFxFull);
    $('#fxFsBar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fs-preset]');
      if (btn) applyFxPreset(btn.dataset.fsPreset);
    });

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
    paintFxRoles();
  }

  function paintFxPresets() {
    $$('#fxPresets [data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === db.formation.preset));
    $$('#fxFsBar [data-fs-preset]').forEach((b) => b.classList.toggle('on', b.dataset.fsPreset === db.formation.preset));
    const label = FX_PRESETS[db.formation.preset] ? FX_PRESETS[db.formation.preset].label : '自定义';
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
    const preset = FX_PRESETS[k];
    if (!preset) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: preset.pos[r.id].x, y: preset.pos[r.id].y }; });
    db.formation = { version: 1, preset: k, pos };
    save();
    cloudPushFormation();
    renderTactics();
    toast(`已套用「${preset.label}」`);
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
        else if (action === 'import') importData();
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
    $('#menuExport').onclick = () => { closePopovers(); exportData(); };
    $('#menuImport').onclick = () => { closePopovers(); importData(); };
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

  /* ══════════ 启动 ══════════ */
  function init() {
    state.weekMonday = getMonday(new Date());
    applyTheme(db.settings.theme);
    $('#pageTitle').textContent = PAGES.dashboard.title;
    $('#pageKicker').textContent = PAGES.dashboard.kicker;
    renderSidebar();
    renderDashboard();
    renderActivity();
    bind();
    refreshReveals();
    setTimeout(refreshReveals, 400);
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
  }

  init();
})();
