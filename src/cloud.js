/* ============================================================
 * cloud —— 云端桥接（双模式：不登录则全部走本地，不触发这里）
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
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
    // r30：点评以服务器为准重建镜像（分享链接 / AI 上下文都读 shareNotes）
    db.shareNotes = {};
    db.players.forEach((p) => { if (p.note) db.shareNotes[p.id] = p.note; });
    // AI 配置跟随球队（换设备免重填 Key）。服务器没配时必须显式清成空配置，
    // 不能沿用上一份库的值：以前只在 payload.ai 是对象时赋值，而 getSettings()
    // 在球队没配过 AI 时返回 ai:null，A 队的「已配置」状态就会残留到 B 队。
    db.settings.ai = payload.ai && typeof payload.ai === 'object'
      ? {
          base: String(payload.ai.base || 'https://api.deepseek.com'),
          model: String(payload.ai.model || 'deepseek-chat'),
          key: String(payload.ai.key || '')
        }
      : { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
    if (Array.isArray(payload.template) && Date.now() - templateLocalAt > SETTINGS_GRACE) {
      db.settings.template = payload.template.map((t, i) => ({
        id: t.id || uid('t'),
        day: Number.isFinite(Number(t.day)) ? Number(t.day) : [2, 5, 0][i] || 2,
        label: t.label || WEEK_CN[Number(t.day)] || '',
        start: t.start || '16:30',
        end: t.end || '18:30',
        venue: String(t.venue || '')
      }));
    }
    // 保护期的语义：同一队内「用户刚改过、自己的 PUT 还在排队」，别让轮询带回的旧值盖掉。
    // 换队 / 重新登录时 cloud.js 会调 resetSettingsGrace() 清零 —— 新队的服务器值是唯一权威。
    if (payload.theme && isTheme(payload.theme) && Date.now() - themeLocalAt > SETTINGS_GRACE) {
      db.settings.theme = payload.theme;
    }
    // 无论有没有采用服务器值，DOM 都要跟最终 db 对齐。登录是 SPA 不刷新页面，
    // init() 里的 applyTheme 不会再跑；以前只在「采用服务器值」时刷 DOM，
    // 保护期内就留下上一队的配色，弹窗选中态（读 db）显示 A、真实配色（读 dataset）还是 B。
    applyTheme(db.settings.theme);
    if (payload.formation && payload.formation.pos) {
      db.formation = normalizeFormation({ version: 1, preset: payload.formation.preset, name: payload.formation.name, pos: payload.formation.pos });
    }
    // 云端阵型库以服务器为准（本地同名字段直接覆盖）
    if (Array.isArray(payload.formations)) {
      db.formations = payload.formations.slice(0, 30).map((f) => {
        if (!f || typeof f !== 'object') return null;
        const pos = normalizeFormation({ version: 1, preset: 'custom', pos: f.pos }).pos;
        return { id: f.id || uid('f'), name: String(f.name || '未命名').slice(0, 16), pos, at: Number(f.at) || Date.now() };
      }).filter(Boolean);
    }
    // 全量周数据：登录时一次拉齐所有历史周，赛季统计不再只算「翻过的周」。
    // /api/weeks/all 是「这支队」的全量，所以整份重建而不是逐 key 覆盖：
    // 以前只覆盖服务器返回的 key，上一队/本机库独有的周会留在 db.weeks 里，
    // 赛季统计遍历 Object.keys(db.weeks) 就把别队训练算进来了，save() 还会写脏缓存。
    db.weeks = {};
    if (payload.weeks && typeof payload.weeks === 'object') {
      Object.keys(payload.weeks).forEach((k) => {
        const arr = payload.weeks[k];
        if (Array.isArray(arr) && arr.length) {
          db.weeks[k] = arr.map(normalizeSession).filter(Boolean).sort(sessionSort);
        }
      });
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
