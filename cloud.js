/* ═══════════════════════════════════════════════════════════════
 * 云端同步模块（双模式之一：本地版不动，这里是「云端版」）
 *
 * 设计：本地优先 + 在线同步
 * - 不登录 = 纯本地版，localStorage，一切照旧。
 * - 登录后 = 云端版：账号数据以服务器为准。进入时全量拉一次
 *   （队员/技能记录/模板/主题/阵型），训练按周懒加载。
 * - 写操作分两类：
 *   · 增删改（队员、加练、删训练）→ 先等服务器成功再落本地，
 *     用服务器返回的 id，避免本地临时 id 和服务器对不上。
 *   · 高频操作（考勤格子、拖阵型）→ 本地先变（界面不卡），
 *     后台推送；失败则重新拉这一周/阵型，以服务器为准。
 * - token 存 localStorage（Bearer 方案，不依赖 cookie，
 *   所以 GitHub Pages / file:// 都能连）。
 *
 * 角色体系（2026-11 用户管理）：
 * - owner 队长 / editor 管理员：可编辑；viewer 队员：只读。
 * - 只读的执行点有两层：前端 push 前拦截（体验），后端 requireRole（真相）。
 * - 邀请码：管理员生成 6 位码 → 队员注册时填码入队（只读），或登录后凭码加队。
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LS = {
    base: 'xgy_api_base',
    token: 'xgy_api_token',
    user: 'xgy_api_user',
    team: 'xgy_api_team',
    role: 'xgy_api_role',
    skip: 'xgy_api_skip' // 用户选过「不登录，仅在本机使用」
  };
  const DEFAULT_BASE = 'http://localhost:8787';

  /* 默认服务器地址：页面本身跑在 http(s) 上时（vb.bscjs.top / 局域网部署），
   * 同源就是最合理的默认值 —— 新设备登录不用手动展开「服务器地址」也能直接登录。
   * 写死 localhost:8787 的坑：生产站新访客的登录请求会打到自己电脑上，
   * 报一个浏览器控制台里的 Failed to fetch，界面上只有一句「Failed to fetch」。 */
  function defaultBase() {
    if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      return location.origin;
    }
    return DEFAULT_BASE;
  }

  /* ── 会话存储：按标签页隔离 ──
   * localStorage 是按「域名」共享的，不是按标签页。原先把登录态存那里，
   * 同浏览器开两个标签登两个队时，后登录的会盖掉前一个：刷新一下整页变成别人的队；
   * 更糟的是前一个标签的写操作其实已经打在后登录那个队上了（token() 每次实时读 storage）。
   *
   * 现在：登录态（token/user/team/role）优先读写 sessionStorage —— 每标签一份、刷新保留，
   * localStorage 只留一份「新开标签时的默认身份」。
   * 设备级偏好（服务器地址、跳过登录标记）仍走 localStorage。
   * 注意：四个 key 必须整组取自同一层，不能混读（否则 user 是 A、token 是 B）。 */
  function readSessionRaw() {
    let inSession = false;
    try { inSession = sessionStorage.getItem(LS.token) !== null; } catch (_) { /* 隐私模式 */ }
    const get = (k) => {
      if (inSession) {
        try { return sessionStorage.getItem(k); } catch (_) { return null; }
      }
      return localStorage.getItem(k);
    };
    return { token: get(LS.token) || '', user: get(LS.user), team: get(LS.team), role: get(LS.role) };
  }
  function sessSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* ignore */ }
    localStorage.setItem(key, value);
  }
  function sessDel(key) {
    try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ }
    localStorage.removeItem(key);
  }

  let hooks = null; // app.js 注入：toast/openModal/closeModal/confirm/getDB/save/renderAll/applyServerState/applyWeek/currentMondayKey
  let user = null;  // { id, email, name }
  let team = null;  // { id, name }
  let role = null;  // 'admin' 管理 | 'coach' 教练 | 'player' 队员
  let syncingWeeks = new Set();
  let lastViewerWarn = 0;

  const ROLE_LABEL = { admin: '管理员', coach: '教练', player: '队员' };

  function base() {
    return (localStorage.getItem(LS.base) || defaultBase()).replace(/\/+$/, '');
  }

  /* 一次性迁移：老版本把 localhost:8787 当默认值存进了 localStorage，
   * 在生产站上这会让登录永远打到自己电脑上。检测到就清掉，回落到 defaultBase()。 */
  function migrateBase() {
    if (localStorage.getItem(LS.base) === DEFAULT_BASE && defaultBase() !== DEFAULT_BASE) {
      localStorage.removeItem(LS.base);
    }
  }
  function token() {
    // 每次实时读：写操作要拿到当前标签页自己的 token，不能缓存
    try {
      const s = sessionStorage.getItem(LS.token);
      if (s !== null) return s;
    } catch (_) { /* 隐私模式退回 localStorage */ }
    return localStorage.getItem(LS.token) || '';
  }
  function enabled() {
    return !!token() && !!user;
  }
  function isViewer() {
    return enabled() && role === 'player';
  }
  function canManage() {
    return enabled() && (role === 'admin' || role === 'coach');
  }

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(base() + path, {
      method: o.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
        ...(o.teamId ? { 'X-Team-Id': o.teamId } : {})
      },
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const msg = (data && data.message) || `请求失败（${res.status}）`;
      const err = new Error(msg);
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  /* ── 会话恢复 ── */
  function restoreSession() {
    const raw = readSessionRaw();
    try {
      user = raw.user ? JSON.parse(raw.user) : null;
      team = raw.team ? JSON.parse(raw.team) : null;
      role = raw.role || null;
    } catch (e) {
      user = null; team = null; role = null;
    }
    if (!raw.token) { user = null; team = null; role = null; }
    // 角色枚举换过代（owner/editor/viewer → admin/coach/player）：
    // 本地存着旧值的浏览器先按无权限处理，attach 里的 pullCore 会用服务器返回的值纠正
    if (role && !['admin', 'coach', 'player'].includes(role)) role = null;
  }

  function saveSession(payload) {
    sessSet(LS.token, payload.token);
    sessSet(LS.user, JSON.stringify(payload.user));
    sessSet(LS.team, JSON.stringify(payload.team));
    sessSet(LS.role, payload.role || 'player');
    user = payload.user;
    team = payload.team;
    role = payload.role || 'player';
    paintBodyClass();
  }

  /** 本机数据缓存的分桶后缀：云端模式按球队分开存，避免两个标签互相覆盖。
   *  未登录（本地模式）返回空串，沿用原来的 key。app.js 在 loadDB 时调用。 */
  function dbScope() {
    const raw = readSessionRaw();
    if (!raw.token || !raw.team) return '';
    try {
      const t = JSON.parse(raw.team);
      return t && t.id ? '::' + t.id : '';
    } catch (e) {
      return '';
    }
  }

  /** 切换球队：/me 带 X-Team-Id，服务器返回新队的角色和设置 */
  async function switchTeam(teamId) {
    const data = await api('/api/auth/me', { teamId });
    team = data.team;
    role = data.role;
    sessSet(LS.team, JSON.stringify(team));
    sessSet(LS.role, role);
    paintBodyClass();
    await pullCore();
    await syncWeek(currentMondayKey(), true);
    hooks.renderAll();
    hooks.toast(`已切换到 ${team.name}`);
  }

  function paintBodyClass() {
    document.body.classList.toggle('cloud-viewer', isViewer());
  }

  function logout(opts) {
    const quiet = !!(opts && opts.quiet); // token 过期时由调用方自己给提示，别叠两条 toast
    sessDel(LS.token);
    sessDel(LS.user);
    sessDel(LS.team);
    sessDel(LS.role);
    localStorage.removeItem(LS.skip); // 主动退出 = 想换账号，下次必须重新登录
    user = null; team = null; role = null;
    lastTouch = 0; // 换队登录后轮询要重新定基线，不然旧队的时间戳会误触发刷新
    paintBodyClass();
    paintCloudUI();
    // 内存里的 db 还是刚退出那个队的名单，切回本机那份
    // （否则回到本地模式后的编辑会写脏本机数据，换号登录还会被当成「本机原有名单」搬走）
    hooks && hooks.reloadLocal && hooks.reloadLocal();
    hooks && hooks.closeModal && hooks.closeModal();
    if (quiet) return;
    showGate();
    hooks && hooks.toast('已退出云端账号，数据保留在本机', 'ok');
  }

  /* ── 拉取 ── */
  async function pullCore() {
    const [players, logs, formation, lib, me, allWeeks] = await Promise.all([
      api('/api/players'),
      api('/api/skills/logs?limit=500'),
      api('/api/formation'),
      api('/api/formation/library'),
      api('/api/auth/me'),
      // 全量周数据一次拉齐：周数据之前只懒加载当前周，新设备的赛季统计会缺历史周
      api('/api/weeks/all')
    ]);
    // 角色以服务器为准（比如被队长改过角色）
    role = me.role || role;
    sessSet(LS.role, role);
    paintBodyClass();
    hooks.applyServerState({
      players: players.players,
      skillLogs: logs.logs,
      formation: formation.formation,
      formations: Array.isArray(lib.formations) ? lib.formations : [],
      template: me.settings.template,
      theme: me.settings.theme,
      ai: me.settings.ai,
      weeks: allWeeks.weeks
    });
  }

  /** 云端模式下按周拉训练（服务端会按模板自动生成）。force=true 强制重拉 */
  async function syncWeek(mondayKey, force) {
    if (!enabled()) return false;
    if (syncingWeeks.has(mondayKey)) return false;
    const dbc = hooks.getDB();
    if (!force && Array.isArray(dbc.weeks[mondayKey])) return false;
    syncingWeeks.add(mondayKey);
    try {
      const data = await api(`/api/weeks/${mondayKey}`);
      hooks.applyWeek(data.weekKey, data.sessions);
      return true;
    } catch (e) {
      hooks.toast(`同步本周训练失败：${e.message}`, 'warn');
      return false;
    } finally {
      syncingWeeks.delete(mondayKey);
    }
  }

  /* ── 弹窗通用 ── */
  function field(label, inner) {
    return `<div class="field full"><label>${label}</label>${inner}</div>`;
  }

  /* ── 登录门禁（公网进站第一屏） ──
   * 单文件双击打开（file:）和 GitHub Pages 静态演示站没有后端，不能挡；
   * 只要是通过 http(s) 访问的"服务"，进来就得先登录。 */
  function gateNeeded() {
    if (location.protocol === 'file:') return false;
    if (/\.github\.io$/i.test(location.hostname)) return false;
    return true;
  }

  function showGate(msg) {
    if (!gateNeeded()) return;
    const g = document.getElementById('authGate');
    if (!g) return;
    document.documentElement.classList.remove('gate-pass');
    g.hidden = false;
    const err = document.getElementById('gateErr');
    if (err) {
      err.hidden = !msg;
      if (msg) err.textContent = msg;
    }
  }

  function hideGate() {
    const g = document.getElementById('authGate');
    if (!g) return;
    g.hidden = true;
    document.documentElement.classList.add('gate-pass');
  }

  /* 登录的唯一实现：门禁页和顶栏弹窗都调这里，避免两套逻辑走偏。
     没有注册 —— 账号由管理端发放，新人拿到的是初始密码。 */
  async function runAuth(vals) {
    const b = String(vals.base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(b)) throw new Error('服务器地址需要以 http(s):// 开头');
    localStorage.setItem(LS.base, b);

    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { username: vals.username, password: vals.password }
    });
    saveSession(data);
    localStorage.removeItem(LS.skip);
    paintBodyClass();
    paintCloudUI();
    // 首登必须先改密：数据等密码换成自己的再拉
    if (data.mustChangePassword) return data;
    await finishLogin();
    return data;
  }

  async function finishLogin() {
    const snap = localSnapshot();
    await pullCore();
    await syncWeek(currentMondayKey(), true);
    paintCloudUI();
    hideGate();
    hooks.renderAll();
    startSyncLoop();
    await offerImport(snap);
  }

  /* ── 首次登录：把本机数据搬到云端 ──
   * 场景：用户先在本机模式里录了一队人，之后才开云端账号。
   * pullCore 会用服务器数据整份覆盖本机（服务器空 → 本机名单当场清空），所以：
   * 1) 覆盖之前先快照并另存一份到 localStorage，最坏情况也找得回来；
   * 2) 服务器是空的、本机有名单时，问一句要不要搬。 */
  const LS_SNAP = 'xgy_local_snapshot';

  function localSnapshot() {
    try {
      // 「本机数据」只认本地模式那份（无球队后缀），不认内存 —— 内存里可能是别的队的名单
      const cur = hooks.localDB ? hooks.localDB() : (hooks.getDB ? hooks.getDB() : null);
      if (!cur) return null;
      const snap = {
        players: JSON.parse(JSON.stringify(cur.players || [])),
        skillLogs: JSON.parse(JSON.stringify(cur.skillLogs || [])),
        template: JSON.parse(JSON.stringify((cur.settings && cur.settings.template) || [])),
        formation: JSON.parse(JSON.stringify(cur.formation || {})),
        at: Date.now()
      };
      if (snap.players.length) {
        try { localStorage.setItem(LS_SNAP, JSON.stringify(snap)); } catch (_) { /* 配额满了就算了，弹窗还在 */ }
      }
      return snap;
    } catch (_) {
      return null;
    }
  }

  async function offerImport(snap) {
    const mine = (snap && snap.players) || [];
    if (!mine.length) return;
    if (!(role === 'admin' || role === 'coach')) return; // 队员没写权限，搬也搬不上去
    const cur = hooks.getDB ? hooks.getDB() : null;
    if (cur && (cur.players || []).length > 0) return; // 服务器已有名单，不是第一次，不打扰
    const n = mine.length;
    const body = `<div class="cloud-account">
      <p class="form-note" style="margin-top:0">这台设备上原本有 <b>${n}</b> 名队员，服务器上的球队还是空的。搬到云端之后，平板和手机看到的才是同一份名单。</p>
      <p class="form-note">会搬：队员（号码 / 位置 / 年级 / 身高 / 性别 / 6 项技能）+ 训练模板 + 防守站位。<br>不搬：历史考勤和技能调整记录，这些仍留在本机。</p>
      <p class="gate-err" id="impErr" hidden></p>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="impSkip">不用，保留在本机</button>
        <button type="button" class="btn btn-primary" id="impDo">搬到云端</button>
      </div>
    </div>`;
    hooks.openModal('把本机数据搬到云端？', body, { mid: true });

    document.getElementById('impSkip').onclick = () => {
      hooks.closeModal();
      hooks.toast('已跳过搬迁，本机原有数据留在浏览器备份里', 'warn');
    };

    const btn = document.getElementById('impDo');
    btn.onclick = async () => {
      const err = document.getElementById('impErr');
      btn.disabled = true;
      err.hidden = true;
      let done = 0;
      const failed = [];
      for (const p of mine) {
        btn.textContent = `上传中 ${done + 1}/${n}`;
        try {
          await rawPush.playerCreate({
            name: p.name,
            number: Number(p.number) || 0,
            position: p.position || '主攻',
            grade: p.grade || '大一',
            height: Number(p.height) || 0,
            gender: p.gender || '',
            skills: p.skills || {}
          });
          done += 1;
        } catch (err2) {
          // 性别为空时号码可能撞车（服务端只在同性别内查重），撞了就带空性别重试一次
          failed.push(p.name);
        }
      }
      try {
        if ((snap.template || []).length) await rawPush.template(snap.template);
        if (snap.formation && snap.formation.pos) await rawPush.formation(snap.formation);
      } catch (_) { /* 模板/站位失败不影响名单，下次改设置会再推 */ }

      await pullCore();
      hooks.renderAll();
      hooks.closeModal();
      if (failed.length) {
        hooks.toast(`已搬 ${done} 名队员，${failed.length} 人失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`, 'warn');
      } else {
        hooks.toast(`已把 ${done} 名队员同步到云端`, 'ok');
      }
    };
  }

  /* ── 首登强制改密：直接在门禁卡片里换屏，没有「稍后再说」 ── */
  let pendingPassword = '';

  function showForcePassword(password) {
    pendingPassword = password;
    const login = document.getElementById('gateLoginPane');
    const pw = document.getElementById('gatePwPane');
    if (!login || !pw) return;
    login.hidden = true;
    pw.hidden = false;
    const sub = document.getElementById('gateSub');
    if (sub) sub.textContent = '第一次登录，先设个自己的密码';
    const inp = document.querySelector('#pwGateForm [name=newPassword]');
    if (inp) inp.focus();
  }

  function bindForcePassword() {
    const form = document.getElementById('pwGateForm');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const err = document.getElementById('pwGateErr');
      const btn = document.getElementById('pwGateSubmit');
      const np = String(fd.get('newPassword') || '');
      if (np !== String(fd.get('again') || '')) {
        err.hidden = false;
        err.textContent = '两次输入的新密码不一样';
        return;
      }
      btn.disabled = true;
      btn.textContent = '保存中…';
      err.hidden = true;
      try {
        await api('/api/auth/password', {
          method: 'POST',
          body: { oldPassword: pendingPassword, newPassword: np }
        });
        pendingPassword = '';
        await finishLogin();
        hooks.toast('密码已设置，欢迎回来');
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = '保存并进入';
      }
    };
  }

  function bindGate() {
    const g = document.getElementById('authGate');
    const form = document.getElementById('gateForm');
    if (!g || !form) return;

    const baseInput = form.querySelector('[name=base]');
    if (baseInput) baseInput.value = base();

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = document.getElementById('gateSubmit');
      const err = document.getElementById('gateErr');
      btn.disabled = true;
      btn.textContent = '登录中…';
      err.hidden = true;
      try {
        const password = String(fd.get('password') || '');
        const data = await runAuth({
          base: fd.get('base'),
          username: String(fd.get('username') || '').trim().toLowerCase(),
          password
        });
        btn.disabled = false;
        btn.textContent = '登录';
        if (data.mustChangePassword) {
          showForcePassword(password);
          return;
        }
        hideGate();
        hooks.toast(`已登录：${data.team.name}（${ROLE_LABEL[data.role] || data.role}）`);
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = '登录';
      }
    };

    bindForcePassword();

    const skip = document.getElementById('gateSkip');
    if (skip) {
      skip.onclick = () => {
        localStorage.setItem(LS.skip, '1');
        hideGate();
        paintCloudUI();
        hooks && hooks.toast('本机模式：数据只存在这台设备', 'ok');
      };
    }
  }

  /* ── 登录弹窗（本机模式下想连云端时用） ── */
  function openLogin() {
    if (!hooks) return;
    if (enabled()) {
      openAccount();
      return;
    }

    const body = `<div class="cloud-auth">
      <form id="cloudForm"><div class="form-grid">
        ${field('服务器', `<input name="base" value="${escHtml(base())}" placeholder="https://vb.bscjs.top" required>`)}
        ${field('用户名', '<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="学号或姓名拼音">')}
        ${field('密码', '<input name="password" type="password" required autocomplete="current-password">')}
      </div>
      <p class="form-note">账号由球队管理员发放。还没有账号？找管理员要一个。</p>
      <div class="form-foot"><button type="submit" class="btn btn-primary" id="cloudSubmit">登录并同步</button></div>
      </form>
    </div>`;
    hooks.openModal('登录云端', body, { mid: true });

    const form = document.getElementById('cloudForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = document.getElementById('cloudSubmit');
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        const password = String(fd.get('password') || '');
        const data = await runAuth({
          base: fd.get('base'),
          username: String(fd.get('username') || '').trim().toLowerCase(),
          password
        });
        hooks.closeModal();
        if (data.mustChangePassword) {
          showGate();
          showForcePassword(password);
          return;
        }
        hideGate();
        hooks.renderAll();
        hooks.toast(`已登录：${data.team.name}（${ROLE_LABEL[data.role] || data.role}）`);
      } catch (err) {
        hooks.toast(err.message, 'warn');
        btn.disabled = false;
        btn.textContent = '登录并同步';
      }
    };
  }

  /* ── 账号弹窗（已登录） ── */
  function openAccount() {
    const roleBadge = `<span class="cloud-role-badge r-${role}">${ROLE_LABEL[role] || role}</span>`;
    const manageBtn = canManage()
      ? '<button type="button" class="btn btn-ghost" id="cloudAccounts">账号管理</button>'
      : '';
    const initial = (user.name || user.username || '?').slice(0, 1);
    const body = `<div class="cloud-account">
      <div class="cloud-id">
        <span class="u-avatar xl" style="--a:var(--cyan);--b:var(--violet)">${escHtml(initial)}</span>
        <div><h3>${escHtml(user.name)} ${roleBadge}</h3><p>@${escHtml(user.username || '')} · ${escHtml(team ? team.name : '')}</p></div>
      </div>
      <p class="form-note">当前为云端模式：数据实时同步到 ${escHtml(base())}。${isViewer() ? '你是队员身份（只读），只能看自己的数据。' : ''}退出登录后回到本机数据（本机数据不会被删除）。</p>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="cloudTeams">切换球队</button>
        <button type="button" class="btn btn-ghost" id="cloudPassword">修改密码</button>
      </div>
      <div class="form-foot">
        ${manageBtn}
        <button type="button" class="btn btn-ghost" id="cloudResync">重新同步</button>
        <button type="button" class="btn btn-danger-ghost" id="cloudLogout">退出登录</button>
      </div>
    </div>`;
    hooks.openModal('账号', body, { mid: true });
    document.getElementById('cloudLogout').onclick = () => { hooks.closeModal(); logout(); hooks.renderAll(); };
    document.getElementById('cloudResync').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await pullCore();
        await syncWeek(currentMondayKey(), true);
        hooks.toast('已重新同步');
        hooks.closeModal();
        hooks.renderAll();
      } catch (err) {
        hooks.toast(err.message, 'warn');
        e.target.disabled = false;
      }
    };
    document.getElementById('cloudPassword').onclick = openPassword;
    document.getElementById('cloudTeams').onclick = openTeams;
    const m = document.getElementById('cloudAccounts');
    if (m) m.onclick = openAccounts;
  }

  /* ── 切换球队 ── */
  async function openTeams() {
    let teams = [];
    try {
      teams = (await api('/api/auth/teams')).teams;
    } catch (e) {
      hooks.toast(e.message, 'warn');
      return;
    }
    const rows = teams.map((t) => `
      <div class="member-row ${team && t.id === team.id ? 'on' : ''}">
        <div class="m-main"><b>${escHtml(t.name)}</b><small>${ROLE_LABEL[t.role] || t.role}</small></div>
        ${team && t.id === team.id
          ? '<span class="m-cur">当前</span>'
          : `<button type="button" class="btn btn-ghost btn-sm" data-switch="${t.id}">进入</button>`}
      </div>`).join('');
    const body = `<div class="cloud-account">
      <div class="cloud-section">我加入的球队</div>
      ${rows || '<p class="form-note">还没有加入任何球队。</p>'}
      <p class="form-note">需要加入别的球队？找那边管理员要一个账号，用那个账号登录即可。</p>
      <div class="form-foot"><button type="button" class="btn btn-ghost" id="teamsBack">返回</button></div>
    </div>`;
    hooks.openModal('切换球队', body, { mid: true });
    document.getElementById('teamsBack').onclick = openAccount;
    document.querySelectorAll('[data-switch]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await switchTeam(btn.dataset.switch);
          hooks.closeModal();
          openAccount();
        } catch (e) {
          hooks.toast(e.message, 'warn');
          btn.disabled = false;
        }
      };
    });
  }

  /* ── 修改密码 ── */
  function openPassword() {
    const body = `<div class="cloud-auth">
      <form id="pwForm"><div class="form-grid">
        ${field('当前密码', '<input name="oldPassword" type="password" required autocomplete="current-password">')}
        ${field('新密码', '<input name="newPassword" type="password" required minlength="6" placeholder="至少 6 位" autocomplete="new-password">')}
        ${field('确认新密码', '<input name="again" type="password" required minlength="6" autocomplete="new-password">')}
      </div>
      <div class="form-foot"><button type="submit" class="btn btn-primary">保存新密码</button></div>
      </form>
    </div>`;
    hooks.openModal('修改密码', body, { mid: true });
    const form = document.getElementById('pwForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newPassword = String(fd.get('newPassword') || '');
      if (newPassword !== String(fd.get('again') || '')) {
        hooks.toast('两次输入的新密码不一样', 'warn');
        return;
      }
      try {
        await api('/api/auth/password', {
          method: 'POST',
          body: { oldPassword: String(fd.get('oldPassword') || ''), newPassword }
        });
        hooks.toast('密码已修改');
        openAccount();
      } catch (err) {
        hooks.toast(err.message, 'warn');
      }
    };
  }

  /* ── 账号管理（admin 全部 / coach 只管队员） ──
   * 没有注册，所以这里是新人进入系统的唯一通道：
   * 建号 → 一次性展示初始密码 → 对方首登强制改密。 */
  function showSecret(title, username, pwd) {
    const body = `<div class="cloud-account">
      <p class="form-note">把下面这组账号密码发给对方（微信直接粘）。密码只显示这一次，关掉就查不到了，忘了只能重置。</p>
      <div class="secret-box">
        <div><small>用户名</small><b>${escHtml(username)}</b></div>
        <div><small>初始密码</small><b class="mono">${escHtml(pwd)}</b></div>
      </div>
      <div class="form-foot">
        <button type="button" class="btn btn-primary" id="copySecret">复制账号密码</button>
        <button type="button" class="btn btn-ghost" id="secretDone">完成</button>
      </div>
    </div>`;
    hooks.openModal(title, body, { mid: true });
    document.getElementById('copySecret').onclick = async () => {
      const text = `【排球队管理】\n用户名：${username}\n初始密码：${pwd}\n登录地址：${location.origin}\n首次登录会让你改密码。`;
      try {
        await navigator.clipboard.writeText(text);
        hooks.toast('已复制，直接粘到微信里');
      } catch (e) {
        hooks.toast('复制失败，请手动记下', 'warn');
      }
    };
    document.getElementById('secretDone').onclick = openAccounts;
  }

  async function openAccounts() {
    if (!canManage()) return;
    let accounts = [];
    let freePlayers = [];
    try {
      const [a, p] = await Promise.all([api('/api/accounts'), api('/api/accounts/candidates')]);
      accounts = a.accounts;
      freePlayers = p.players || [];
    } catch (e) {
      hooks.toast(e.message, 'warn');
      return;
    }

    const amAdmin = role === 'admin';
    const rows = accounts.map((m) => {
      const isSelf = m.id === user.id;
      const ops = [];
      if (amAdmin && !isSelf && m.role !== 'admin') {
        ops.push(`<select class="role-sel" data-uid="${m.id}">
          <option value="coach" ${m.role === 'coach' ? 'selected' : ''}>教练</option>
          <option value="player" ${m.role === 'player' ? 'selected' : ''}>队员</option>
        </select>`);
      }
      const canTouch = amAdmin || m.role === 'player';
      if (!isSelf && canTouch) {
        ops.push(`<button type="button" class="btn btn-ghost btn-sm" data-reset="${m.id}" data-name="${escHtml(m.name)}">重置密码</button>`);
        ops.push(`<button type="button" class="btn btn-danger-ghost btn-sm" data-toggle="${m.id}" data-status="${m.status}" data-name="${escHtml(m.name)}">${m.status === 'disabled' ? '启用' : '停用'}</button>`);
      }
      const sub = [
        '@' + m.username,
        m.role === 'player' && m.playerName ? `球员：${m.playerName}${m.playerNumber ? ' · ' + m.playerNumber + ' 号' : ''}` : '',
        m.status === 'disabled' ? '已停用' : '',
        m.mustChangePassword ? '待首次改密' : ''
      ].filter(Boolean).map(escHtml).join(' · ');
      return `<div class="member-row ${m.status === 'disabled' ? 'row-off' : ''}">
        <div class="m-main"><b>${escHtml(m.name)}${isSelf ? '<small>（我）</small>' : ''}</b><small>${sub}</small></div>
        <div class="m-ops">
          <span class="cloud-role-badge r-${m.role}">${ROLE_LABEL[m.role] || m.role}</span>
          ${ops.join('')}
        </div>
      </div>`;
    }).join('');

    const roleOpts = amAdmin
      ? '<option value="coach">教练 · 平板全读写</option><option value="player">队员 · 手机只读</option>'
      : '<option value="player">队员 · 手机只读</option>';

    const body = `<div class="cloud-account">
      <div class="cloud-section">账号（${accounts.length}）</div>
      ${rows || '<p class="form-note">还没有其他账号。</p>'}
      <div class="cloud-section">发放新账号</div>
      <p class="form-note">队员看数据<b>不用发账号</b>了：去「分享队伍动态」点「下载档案文件」发给队员就行。下面的「队员」身份只留给老账号场景。</p>
      <form id="accForm"><div class="form-grid">
        ${field('用户名', '<input name="username" required autocapitalize="none" spellcheck="false" placeholder="学号或姓名拼音">')}
        ${field('姓名', '<input name="name" required maxlength="20" placeholder="张辰">')}
        <div class="field full"><label>身份</label><select name="role">${roleOpts}</select></div>
        <div class="field full"><label>对应球员 <small>（队员必选，队员端靠它知道「我是谁」）</small></label>
          <select name="playerId"><option value="">选择球员…</option>
          ${freePlayers.map((p) => `<option value="${p.id}">${escHtml(p.name)}${p.number ? ' · ' + p.number + ' 号' : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="gate-err" id="accErr" hidden></p>
      <div class="form-foot"><button type="submit" class="btn btn-primary" id="accCreate">生成账号</button></div>
      </form>
      <div class="form-foot"><button type="button" class="btn btn-ghost" id="accountsBack">返回</button></div>
    </div>`;
    hooks.openModal('账号管理', body, { mid: true });
    document.getElementById('accountsBack').onclick = openAccount;

    // 只有队员才需要选球员
    const roleSel = document.querySelector('#accForm [name=role]');
    const playerWrap = document.querySelector('#accForm [name=playerId]').closest('.field');
    const syncPlayerField = () => { playerWrap.hidden = roleSel.value !== 'player'; };
    roleSel.onchange = syncPlayerField;
    syncPlayerField();

    const form = document.getElementById('accForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const err = document.getElementById('accErr');
      const btn = document.getElementById('accCreate');
      const payload = {
        username: String(fd.get('username') || '').trim().toLowerCase(),
        name: String(fd.get('name') || '').trim(),
        role: String(fd.get('role') || 'player')
      };
      if (payload.role === 'player') payload.playerId = String(fd.get('playerId') || '');
      btn.disabled = true;
      btn.textContent = '生成中…';
      err.hidden = true;
      try {
        const r = await api('/api/accounts', { method: 'POST', body: payload });
        showSecret('账号已生成', r.account.username, r.initialPassword);
        if (payload.role === 'player' && payload.playerId && hooks.renderAll) hooks.renderAll();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = '生成账号';
      }
    };

    document.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await hooks.confirm({
          title: '重置密码',
          message: `给「${btn.dataset.name}」生成一个新的初始密码？旧密码立即失效，对方下次登录要重新设密码。`,
          ok: '重置'
        });
        if (!ok) return;
        try {
          const r = await api(`/api/accounts/${btn.dataset.reset}/reset-password`, { method: 'POST' });
          showSecret('新密码已生成', accounts.find((a) => a.id === btn.dataset.reset).username, r.initialPassword);
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
      };
    });

    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.onclick = async () => {
        const to = btn.dataset.status === 'disabled' ? 'active' : 'disabled';
        const ok = await hooks.confirm({
          title: to === 'disabled' ? '停用账号' : '启用账号',
          message: to === 'disabled'
            ? `停用后「${btn.dataset.name}」将无法登录，历史考勤数据保留。`
            : `重新允许「${btn.dataset.name}」登录？`,
          ok: to === 'disabled' ? '停用' : '启用'
        });
        if (!ok) return;
        try {
          await api(`/api/accounts/${btn.dataset.toggle}`, { method: 'PATCH', body: { status: to } });
          hooks.toast(to === 'disabled' ? '已停用' : '已启用');
          openAccounts();
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
      };
    });

    document.querySelectorAll('.role-sel').forEach((sel) => {
      sel.onchange = async () => {
        try {
          await api(`/api/accounts/${sel.dataset.uid}`, { method: 'PATCH', body: { role: sel.value } });
          hooks.toast('身份已更新');
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
        openAccounts();
      };
    });
  }

  /* ── 推送（写操作） ──
   * viewer（队员只读）在发请求前就拦下：不合法的操作不必等服务器 403。
   * 高频操作本地已经先变了，fireAndSync 的回拉会把界面恢复成服务器状态。 */
  function guardWrite(fn) {
    return function (...args) {
      if (isViewer()) {
        const t = Date.now();
        if (t - lastViewerWarn > 4000) {
          lastViewerWarn = t;
          hooks && hooks.toast('队员身份只有查看权限，如需编辑请联系管理员', 'warn');
        }
        return Promise.reject(new Error('forbidden'));
      }
      return fn.apply(null, args);
    };
  }

  const rawPush = {
    playerCreate: (p) => api('/api/players', { method: 'POST', body: p }),
    playerUpdate: (id, p) => api(`/api/players/${id}`, { method: 'PATCH', body: p }),
    playerDelete: (id) => api(`/api/players/${id}`, { method: 'DELETE' }),

    sessionCreate: (s) => api('/api/sessions', { method: 'POST', body: s }),
    sessionUpdate: (id, s) => api(`/api/sessions/${id}`, { method: 'PATCH', body: s }),
    sessionDelete: (id) => api(`/api/sessions/${id}`, { method: 'DELETE' }),

    attSet: (sessionId, playerId, state) =>
      api(`/api/sessions/${sessionId}/attendance/${playerId}`, { method: 'PUT', body: { state } }),
    attClear: (sessionId, playerId) =>
      api(`/api/sessions/${sessionId}/attendance/${playerId}`, { method: 'DELETE' }),

    skillBatch: (changes, source, date) =>
      api('/api/skills/batch', { method: 'POST', body: { changes, source, date } }),

    formation: (f) => api('/api/formation', { method: 'PUT', body: { preset: f.preset, pos: f.pos, name: f.name || '' } }),
    formationLibrary: (list) => api('/api/formation/library', { method: 'PUT', body: { formations: list } }),
    template: (t) => api('/api/settings/template', { method: 'PUT', body: { template: t } }),
    theme: (themeId) => api('/api/settings/theme', { method: 'PUT', body: { theme: themeId } }),
    settingsAi: (ai) => api('/api/settings/ai', { method: 'PUT', body: { ai } })
  };

  const push = {};
  Object.keys(rawPush).forEach((k) => { push[k] = guardWrite(rawPush[k]); });

  /** 高频写（考勤、阵型）：后台推送，失败提示并回拉 */
  function fireAndSync(promise, resync) {
    promise.catch((e) => {
      if (e && e.message === 'forbidden') return; // viewer 拦截已经提示过了
      hooks && hooks.toast(`云端同步失败：${e.message}`, 'warn');
      if (resync) resync();
    });
  }

  /* ── 顶栏按钮状态 ── */
  function paintCloudUI() {
    const btn = document.getElementById('cloudBtn');
    const on = enabled();
    document.body.classList.toggle('cloud-on', on); // [data-cloud-only] 的显隐靠这条
    if (btn) {
      btn.classList.toggle('cloud-on', on);
      btn.setAttribute('data-tip', on ? `云端：${team ? team.name : user.name}` : '连接云端');
    }

    // 头像菜单的身份区 + 退出按钮：云端显示真实身份，本机显示默认文案
    const letter = on && user ? (user.name || user.username || '管').charAt(0) : '管';
    document.querySelectorAll('#avatarBtn .u-avatar, #upAvatar, #chipAvatar').forEach((el) => { el.textContent = letter; });
    const brandMode = document.getElementById('brandMode');
    if (brandMode) brandMode.textContent = on ? 'VOLLEYBALL · CLOUD' : 'VOLLEYBALL · LOCAL';
    // 品牌名跟队走：云端显示登录账号所属球队，本机回落默认名（多球队后写死会串队）
    const teamName = on && team ? team.name : '信工院排球队';
    const brandTeam = document.getElementById('brandTeam');
    if (brandTeam) brandTeam.textContent = teamName;
    const footerTeam = document.getElementById('footerTeam');
    if (footerTeam) footerTeam.textContent = teamName;
    document.title = `${teamName} · 球队管理`;
    const nameEl = document.getElementById('upName');
    if (nameEl) {
      nameEl.textContent = on && user ? user.name : '管理员';
    }
    const subEl = document.getElementById('upSub');
    if (subEl) {
      if (on && team) {
        subEl.textContent = `${team.name} · ${ROLE_LABEL[role] || role || ''}`;
      } else {
        subEl.textContent = '本地账号 · 一个人维护全队数据';
      }
    }
    const chipName = document.getElementById('chipName');
    if (chipName) chipName.textContent = on && user ? user.name : '管理员';
    const chipSub = document.getElementById('chipSub');
    if (chipSub) chipSub.textContent = on ? (ROLE_LABEL[role] || '已登录') : '本地账号';
    const lo = document.getElementById('menuLogout');
    if (lo) lo.hidden = !on;
  }

  function currentMondayKey() {
    return hooks && hooks.currentMondayKey ? hooks.currentMondayKey() : '';
  }

  /* ── 多端准实时同步（r34）──
   * 每 15 秒问一次服务器「这队的数据最后改动时刻」，比自己上次看到的晚了就整份拉回。
   * 只在页面可见、没有任何弹窗/抽屉打开时刷（body.lock 是现成的信号），
   * 避免把用户正在填的表单冲掉。WebSocket/SSE 对这个写入频率是杀鸡用牛刀。 */
  let lastTouch = 0;
  let syncTimer = null;

  async function syncPoll() {
    if (!enabled() || document.hidden) return;
    if (document.body.classList.contains('lock')) return; // 弹窗/抽屉开着：这次跳过
    try {
      const r = await api('/api/sync/check');
      if (lastTouch === 0) { lastTouch = r.t || 0; return; } // 首轮只定基线
      if ((r.t || 0) <= lastTouch) return;
      lastTouch = r.t || 0;
      await pullCore();
      await syncWeek(currentMondayKey(), true);
      hooks.renderAll();
      hooks.toast('已同步其他设备的最新改动');
    } catch (e) {
      if (e && (e.code === 'token_expired' || e.code === 'unauthorized')) {
        logout({ quiet: true });
        showGate('登录已过期，请重新登录');
      }
      // 其他错误（断网等）静默，下轮再试
    }
  }

  function startSyncLoop() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(syncPoll, 15000);
    document.addEventListener('visibilitychange', () => {
      // 从后台切回来立刻查一次，不用等下一个周期
      if (!document.hidden && enabled()) syncPoll();
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ── 对外接口 ── */
  window.XGYCloud = {
    attach(h) {
      hooks = h;
      migrateBase();
      restoreSession();
      bindGate();
      paintBodyClass();
      paintCloudUI();
      const btn = document.getElementById('cloudBtn');
      if (btn) btn.onclick = openLogin;

      // 进站先过门禁：没有登录态（且不是本机/静态演示）就停在登录页
      if (enabled() || !gateNeeded() || localStorage.getItem(LS.skip) === '1') hideGate();
      else showGate();

      if (enabled()) {
        // 静默校验 token 并拉最新数据；失败（过期）则退回本地模式
        pullCore()
          .then(() => { paintCloudUI(); hooks.renderAll(); return syncWeek(currentMondayKey(), true); })
          .then((ok) => { if (ok) hooks.renderAll(); })
          .catch((e) => {
            if (e.code === 'token_expired' || e.code === 'unauthorized') {
              logout({ quiet: true });
              showGate('登录已过期，请重新登录');
            } else {
              hooks.toast(`云端暂时不可用：${e.message}（先用本机数据）`, 'warn');
            }
          })
          .then(() => startSyncLoop());
      }
    },
    enabled,
    user: () => user,
    team: () => team,
    role: () => role,
    dbScope,
    isViewer,
    openLogin,
    logout,
    syncWeek,
    pullCore,
    push,
    fireAndSync,
    // 备份导入：云端模式下必须走服务端一个事务写库（本地模式不调这里）。
    // 以前导入只写 localStorage，reload 时被 pullCore 整份覆盖 —— 导入等于白做。
    importBackup: guardWrite((mode, data) => api('/api/import', { method: 'POST', body: { mode, data } })),
    // AI 服务端代理（r34）：Key 只存服务器，浏览器只发 messages，SSE 流原样透传。
    // 返回原始 Response，前端沿用现有流式解析。本地模式不调这个（浏览器直连）。
    aiChat: (body, signal) =>
      fetch(base() + '/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(body),
        signal
      })
  };
})();
