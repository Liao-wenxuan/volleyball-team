/* ============================================================
 * core-2 —— 日期 / 数据 / 基础数据操作
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
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
    return { version: SCHEMA, settings: { template: clone(DEFAULT_TEMPLATE), theme: 'court' }, players: [], weeks: {}, skillLogs: [], formation: blankFormation(), formations: [], aiChat: [], shareNotes: {} };
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
      gender: p.gender === '男' || p.gender === '女' ? p.gender : '',
      height: Number.isFinite(Number(p.height)) ? Number(p.height) : 0,
      skills: normalizeSkills(p.skills),
      note: String(p.note || '').trim().slice(0, 300),
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
    base.settings.theme = raw.settings && isTheme(raw.settings.theme) ? raw.settings.theme : 'court';
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
      const raw = localStorage.getItem(dbKey());
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
      localStorage.setItem(dbKey(), JSON.stringify(db));
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
