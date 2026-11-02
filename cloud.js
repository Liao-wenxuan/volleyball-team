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

  let hooks = null; // app.js 注入：toast/openModal/closeModal/confirm/getDB/save/renderAll/applyServerState/applyWeek/currentMondayKey
  let user = null;  // { id, email, name }
  let team = null;  // { id, name }
  let role = null;  // 'owner' | 'editor' | 'viewer'
  let syncingWeeks = new Set();
  let lastViewerWarn = 0;

  const ROLE_LABEL = { owner: '队长', editor: '管理员', viewer: '队员' };

  function base() {
    return (localStorage.getItem(LS.base) || DEFAULT_BASE).replace(/\/+$/, '');
  }
  function token() {
    return localStorage.getItem(LS.token) || '';
  }
  function enabled() {
    return !!token() && !!user;
  }
  function isViewer() {
    return enabled() && role === 'viewer';
  }
  function canManage() {
    return enabled() && (role === 'owner' || role === 'editor');
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
    try {
      const u = localStorage.getItem(LS.user);
      const t = localStorage.getItem(LS.team);
      user = u ? JSON.parse(u) : null;
      team = t ? JSON.parse(t) : null;
      role = localStorage.getItem(LS.role) || null;
    } catch (e) {
      user = null; team = null; role = null;
    }
    if (!token()) { user = null; team = null; role = null; }
  }

  function saveSession(payload) {
    localStorage.setItem(LS.token, payload.token);
    localStorage.setItem(LS.user, JSON.stringify(payload.user));
    localStorage.setItem(LS.team, JSON.stringify(payload.team));
    localStorage.setItem(LS.role, payload.role || 'owner');
    user = payload.user;
    team = payload.team;
    role = payload.role || 'owner';
    paintBodyClass();
  }

  /** 切换球队：/me 带 X-Team-Id，服务器返回新队的角色和设置 */
  async function switchTeam(teamId) {
    const data = await api('/api/auth/me', { teamId });
    team = data.team;
    role = data.role;
    localStorage.setItem(LS.team, JSON.stringify(team));
    localStorage.setItem(LS.role, role);
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
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.user);
    localStorage.removeItem(LS.team);
    localStorage.removeItem(LS.role);
    localStorage.removeItem(LS.skip); // 主动退出 = 想换账号，下次必须重新登录
    user = null; team = null; role = null;
    paintBodyClass();
    paintCloudUI();
    hooks && hooks.closeModal && hooks.closeModal();
    if (quiet) return;
    showGate();
    hooks && hooks.toast('已退出云端账号，数据保留在本机', 'ok');
  }

  /* ── 拉取 ── */
  async function pullCore() {
    const [players, logs, formation, lib, me] = await Promise.all([
      api('/api/players'),
      api('/api/skills/logs?limit=500'),
      api('/api/formation'),
      api('/api/formation/library'),
      api('/api/auth/me')
    ]);
    // 角色以服务器为准（比如被队长改过角色）
    role = me.role || role;
    localStorage.setItem(LS.role, role);
    paintBodyClass();
    hooks.applyServerState({
      players: players.players,
      skillLogs: logs.logs,
      formation: formation.formation,
      formations: Array.isArray(lib.formations) ? lib.formations : [],
      template: me.settings.template,
      theme: me.settings.theme
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

  /* 登录/注册的唯一实现：门禁页和顶栏弹窗都调这里，避免两套逻辑走偏 */
  async function runAuth(mode, vals) {
    const b = String(vals.base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(b)) throw new Error('服务器地址需要以 http(s):// 开头');
    localStorage.setItem(LS.base, b);

    const payload = { email: vals.email, password: vals.password };
    if (mode === 'register') {
      payload.name = vals.name || '教练';
      const invite = String(vals.inviteCode || '').trim().toUpperCase();
      if (invite) payload.inviteCode = invite;
      else payload.teamName = vals.teamName || '我的排球队';
    }

    const data = await api(`/api/auth/${mode}`, { method: 'POST', body: payload });
    saveSession(data);
    localStorage.removeItem(LS.skip);
    await pullCore();
    await syncWeek(currentMondayKey(), true);
    paintCloudUI();
    return data;
  }

  function bindGate() {
    const g = document.getElementById('authGate');
    const form = document.getElementById('gateForm');
    if (!g || !form) return;

    const baseInput = form.querySelector('[name=base]');
    if (baseInput) baseInput.value = base();

    let mode = 'login';
    g.querySelectorAll('[data-gate-tab]').forEach((tab) => {
      tab.onclick = () => {
        mode = tab.dataset.gateTab;
        g.querySelectorAll('[data-gate-tab]').forEach((t) => t.classList.toggle('on', t === tab));
        g.querySelectorAll('.gate-reg').forEach((el) => { el.hidden = mode !== 'register'; });
        document.getElementById('gateSubmit').textContent = mode === 'register' ? '注册并进入' : '登录';
        document.getElementById('gateErr').hidden = true;
        const pw = form.querySelector('[name=password]');
        if (pw) pw.setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
      };
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = document.getElementById('gateSubmit');
      const err = document.getElementById('gateErr');
      const idle = mode === 'register' ? '注册并进入' : '登录';
      btn.disabled = true;
      btn.textContent = '连接中…';
      err.hidden = true;
      try {
        const data = await runAuth(mode, {
          base: fd.get('base'),
          email: String(fd.get('email') || '').trim(),
          password: String(fd.get('password') || ''),
          name: String(fd.get('name') || '').trim(),
          teamName: String(fd.get('teamName') || '').trim(),
          inviteCode: String(fd.get('inviteCode') || '').trim()
        });
        hideGate();
        hooks.renderAll();
        hooks.toast(`已连接云端：${data.team.name}（${ROLE_LABEL[data.role] || data.role}）`);
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = idle;
      }
    };

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

  /* ── 登录 / 注册弹窗 ── */
  function openLogin() {
    if (!hooks) return;
    if (enabled()) {
      openAccount();
      return;
    }

    const body = `<div class="cloud-auth">
      <div class="cloud-tabs">
        <button type="button" class="cloud-tab on" data-tab="login">登录</button>
        <button type="button" class="cloud-tab" data-tab="register">注册</button>
      </div>
      <form id="cloudForm"><div class="form-grid">
        ${field('服务器', `<input name="base" value="${escHtml(base())}" placeholder="https://your-app.example.com" required>`)}
        <div class="field full cloud-reg" hidden><label>你的名字</label><input name="name" maxlength="20" placeholder="教练"></div>
        <div class="field full cloud-reg" hidden><label>球队名 <small>（有邀请码可不填）</small></label><input name="teamName" maxlength="30" placeholder="信工院排球队"></div>
        <div class="field full cloud-reg" hidden><label>邀请码 <small>（选填，队员凭码加入已有球队）</small></label><input name="inviteCode" maxlength="6" placeholder="6 位邀请码" style="text-transform:uppercase"></div>
        ${field('邮箱', '<input name="email" type="email" required placeholder="you@example.com">')}
        ${field('密码', '<input name="password" type="password" required minlength="6" placeholder="至少 6 位">')}
      </div>
      <p class="form-note">云端模式会把队员、考勤、技能、阵型同步到服务器，多台设备（电脑/平板）都能看到同一份数据。凭邀请码注册的队员是只读身份。不登录则仍是本机模式。</p>
      <div class="form-foot"><button type="submit" class="btn btn-primary" id="cloudSubmit">登录并同步</button></div>
      </form>
    </div>`;
    hooks.openModal('连接云端', body, { mid: true });

    let mode = 'login';
    const form = document.getElementById('cloudForm');
    document.querySelectorAll('.cloud-tab').forEach((tab) => {
      tab.onclick = () => {
        mode = tab.dataset.tab;
        document.querySelectorAll('.cloud-tab').forEach((t) => t.classList.toggle('on', t === tab));
        document.querySelectorAll('.cloud-reg').forEach((el) => { el.hidden = mode !== 'register'; });
        document.getElementById('cloudSubmit').textContent = mode === 'register' ? '注册并同步' : '登录并同步';
      };
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = document.getElementById('cloudSubmit');
      btn.disabled = true;
      btn.textContent = '连接中…';
      try {
        const data = await runAuth(mode, {
          base: fd.get('base'),
          email: String(fd.get('email') || '').trim(),
          password: String(fd.get('password') || ''),
          name: String(fd.get('name') || '').trim(),
          teamName: String(fd.get('teamName') || '').trim(),
          inviteCode: String(fd.get('inviteCode') || '').trim()
        });
        hooks.closeModal();
        hideGate();
        hooks.renderAll();
        hooks.toast(`已连接云端：${data.team.name}（${ROLE_LABEL[data.role] || data.role}）`);
      } catch (err) {
        hooks.toast(err.message, 'warn');
        btn.disabled = false;
        btn.textContent = mode === 'register' ? '注册并同步' : '登录并同步';
      }
    };
  }

  /* ── 账号弹窗（已登录） ── */
  function openAccount() {
    const roleBadge = `<span class="cloud-role-badge r-${role}">${ROLE_LABEL[role] || role}</span>`;
    const manageBtn = canManage() ? '<button type="button" class="btn btn-ghost" id="cloudMembers">成员管理</button>' : '';
    const body = `<div class="cloud-account">
      <div class="cloud-id">
        <span class="u-avatar xl" style="--a:var(--cyan);--b:var(--violet)">${(user.name || user.email)[0] || '云'}</span>
        <div><h3>${escHtml(user.name)} ${roleBadge}</h3><p>${escHtml(user.email)} · ${escHtml(team ? team.name : '')}</p></div>
      </div>
      <p class="form-note">当前为云端模式：数据实时同步到 ${escHtml(base())}。${isViewer() ? '你的身份是队员（只读），如需编辑请联系管理员。' : ''}退出登录后回到本机数据（本机数据不会被删除）。</p>
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
    hooks.openModal('云端同步', body, { mid: true });
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
    const m = document.getElementById('cloudMembers');
    if (m) m.onclick = openMembers;
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
      <div class="cloud-section">凭邀请码加入</div>
      <div class="join-row">
        <input name="joinCode" maxlength="6" placeholder="6 位邀请码" style="text-transform:uppercase">
        <button type="button" class="btn btn-primary btn-sm" id="joinBtn">加入</button>
      </div>
      <p class="form-note">向目标球队的管理员要一个邀请码，输入后立即加入（队员为只读身份）。</p>
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
    document.getElementById('joinBtn').onclick = async () => {
      const input = document.querySelector('.join-row input');
      const code = String(input.value || '').trim().toUpperCase();
      if (code.length !== 6) { hooks.toast('邀请码是 6 位', 'warn'); return; }
      const btn = document.getElementById('joinBtn');
      btn.disabled = true;
      try {
        const r = await api('/api/team/join', { method: 'POST', body: { code } });
        hooks.toast(`已加入 ${r.team.name}（${ROLE_LABEL[r.role] || r.role}）`);
        openTeams();
      } catch (e) {
        hooks.toast(e.message, 'warn');
        btn.disabled = false;
      }
    };
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

  /* ── 成员管理（owner / editor） ── */
  function fmtDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function openMembers() {
    if (!canManage()) return;
    let members = [];
    let invites = [];
    try {
      const [m, inv] = await Promise.all([api('/api/team/members'), api('/api/team/invites')]);
      members = m.members;
      invites = inv.invites || [];
    } catch (e) {
      hooks.toast(e.message, 'warn');
      return;
    }

    const amOwner = role === 'owner';
    const activeInvites = invites.filter((i) => !i.revoked && i.expiresAt > Date.now());

    const memberRows = members.map((m) => {
      const isSelf = m.id === user.id;
      const isOwner = m.role === 'owner';
      const controls = [];
      if (amOwner && !isSelf && !isOwner) {
        controls.push(`<select class="role-sel" data-uid="${m.id}">
          <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>队员（只读）</option>
          <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>管理员</option>
        </select>`);
        controls.push(`<button type="button" class="btn btn-danger-ghost btn-sm" data-kick="${m.id}" data-name="${escHtml(m.name)}">移除</button>`);
      } else if (isSelf && !isOwner) {
        controls.push(`<button type="button" class="btn btn-danger-ghost btn-sm" data-leave="1">退队</button>`);
      }
      return `<div class="member-row">
        <div class="m-main"><b>${escHtml(m.name)}${isSelf ? '<small>（我）</small>' : ''}</b><small>${escHtml(m.email)} · ${fmtDate(m.joinedAt)}加入</small></div>
        <div class="m-ops">
          <span class="cloud-role-badge r-${m.role}">${ROLE_LABEL[m.role]}</span>
          ${controls.join('')}
        </div>
      </div>`;
    }).join('');

    const inviteRows = activeInvites.map((i) => `
      <div class="member-row">
        <div class="m-main"><b class="invite-code">${i.code}</b><small>${fmtDate(i.expiresAt)} 过期</small></div>
        <div class="m-ops">
          <button type="button" class="btn btn-ghost btn-sm" data-copy="${i.code}">复制</button>
          <button type="button" class="btn btn-danger-ghost btn-sm" data-revoke="${i.code}">撤销</button>
        </div>
      </div>`).join('');

    const body = `<div class="cloud-account">
      <div class="cloud-section">球队成员（${members.length}）</div>
      ${memberRows}
      <div class="cloud-section">邀请码
        <button type="button" class="btn btn-primary btn-sm" id="genInvite">生成新邀请码</button>
      </div>
      ${inviteRows || '<p class="form-note">还没有有效邀请码。生成一个发给队员，注册时填码即可入队（只读身份）。</p>'}
      <p class="form-note">已登录的队员也可以凭码加入第二支球队（「切换球队」页有入口说明）。</p>
      <div class="form-foot"><button type="button" class="btn btn-ghost" id="membersBack">返回</button></div>
    </div>`;
    hooks.openModal('成员管理', body, { mid: true });
    document.getElementById('membersBack').onclick = openAccount;

    document.getElementById('genInvite').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('/api/team/invites', { method: 'POST' });
        hooks.toast(`已生成邀请码 ${r.code}，7 天内有效`);
        openMembers();
      } catch (err) {
        hooks.toast(err.message, 'warn');
        e.target.disabled = false;
      }
    };

    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          hooks.toast(`已复制 ${btn.dataset.copy}`);
        } catch (e) {
          hooks.toast('复制失败，请手动记下邀请码', 'warn');
        }
      };
    });

    document.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await hooks.confirm({ title: '撤销邀请码', message: `撤销后 ${btn.dataset.revoke} 将立即失效，已用它注册的成员不受影响。`, ok: '撤销' });
        if (!ok) return;
        try {
          await api(`/api/team/invites/${btn.dataset.revoke}`, { method: 'DELETE' });
          hooks.toast('已撤销');
          openMembers();
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
      };
    });

    document.querySelectorAll('.role-sel').forEach((sel) => {
      sel.onchange = async () => {
        try {
          await api(`/api/team/members/${sel.dataset.uid}`, { method: 'PATCH', body: { role: sel.value } });
          hooks.toast('角色已更新');
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
        openMembers();
      };
    });

    document.querySelectorAll('[data-kick]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await hooks.confirm({ title: '移除成员', message: `确定把「${btn.dataset.name}」移出球队？对方将无法再查看球队数据。`, ok: '移除' });
        if (!ok) return;
        try {
          await api(`/api/team/members/${btn.dataset.kick}`, { method: 'DELETE' });
          hooks.toast('已移除');
          openMembers();
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
      };
    });

    const leaveBtn = document.querySelector('[data-leave]');
    if (leaveBtn) {
      leaveBtn.onclick = async () => {
        const ok = await hooks.confirm({ title: '退出球队', message: `确定退出「${team ? team.name : ''}」？退出后不再同步这支球队的数据。`, ok: '退出' });
        if (!ok) return;
        try {
          await api(`/api/team/members/${user.id}`, { method: 'DELETE' });
          hooks.toast('已退出球队');
          openTeams();
        } catch (err) {
          hooks.toast(err.message, 'warn');
        }
      };
    }
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

    formation: (f) => api('/api/formation', { method: 'PUT', body: { preset: f.preset, pos: f.pos } }),
    formationLibrary: (list) => api('/api/formation/library', { method: 'PUT', body: { formations: list } }),
    template: (t) => api('/api/settings/template', { method: 'PUT', body: { template: t } }),
    theme: (themeId) => api('/api/settings/theme', { method: 'PUT', body: { theme: themeId } })
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
    if (!btn) return;
    btn.classList.toggle('cloud-on', enabled());
    btn.setAttribute('data-tip', enabled() ? `云端：${team ? team.name : user.name}` : '连接云端');
  }

  function currentMondayKey() {
    return hooks && hooks.currentMondayKey ? hooks.currentMondayKey() : '';
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
          });
      }
    },
    enabled,
    user: () => user,
    team: () => team,
    role: () => role,
    isViewer,
    openLogin,
    logout,
    syncWeek,
    pullCore,
    push,
    fireAndSync
  };
})();
