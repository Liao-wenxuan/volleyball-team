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
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LS = {
    base: 'xgy_api_base',
    token: 'xgy_api_token',
    user: 'xgy_api_user',
    team: 'xgy_api_team'
  };
  const DEFAULT_BASE = 'http://localhost:8787';

  let hooks = null; // app.js 注入：toast/openModal/closeModal/getDB/save/renderAll/applyServerState
  let user = null;  // { id, email, name }
  let team = null;  // { id, name }
  let syncingWeeks = new Set();

  function base() {
    return (localStorage.getItem(LS.base) || DEFAULT_BASE).replace(/\/+$/, '');
  }
  function token() {
    return localStorage.getItem(LS.token) || '';
  }
  function enabled() {
    return !!token() && !!user;
  }

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(base() + path, {
      method: o.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {})
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
    } catch (e) {
      user = null; team = null;
    }
    if (!token()) { user = null; team = null; }
  }

  function saveSession(payload) {
    localStorage.setItem(LS.token, payload.token);
    localStorage.setItem(LS.user, JSON.stringify(payload.user));
    localStorage.setItem(LS.team, JSON.stringify(payload.team));
    user = payload.user;
    team = payload.team;
  }

  function logout() {
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.user);
    localStorage.removeItem(LS.team);
    user = null; team = null;
    paintCloudUI();
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

  /* ── 登录 / 注册弹窗 ── */
  function field(label, inner) {
    return `<div class="field full"><label>${label}</label>${inner}</div>`;
  }

  function openLogin() {
    if (!hooks) return;
    if (enabled()) {
      const body = `<div class="cloud-account">
        <div class="cloud-id">
          <span class="u-avatar xl" style="--a:var(--cyan);--b:var(--violet)">${(user.name || user.email)[0] || '云'}</span>
          <div><h3>${escHtml(user.name)}</h3><p>${escHtml(user.email)} · ${escHtml(team ? team.name : '')}</p></div>
        </div>
        <p class="form-note">当前为云端模式：数据实时同步到 ${escHtml(base())}。退出登录后回到本机数据（本机数据不会被删除）。</p>
        <div class="form-foot">
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
      return;
    }

    const body = `<div class="cloud-auth">
      <div class="cloud-tabs">
        <button type="button" class="cloud-tab on" data-tab="login">登录</button>
        <button type="button" class="cloud-tab" data-tab="register">注册</button>
      </div>
      <form id="cloudForm"><div class="form-grid">
        ${field('服务器', `<input name="base" value="${escHtml(base())}" placeholder="https://your-app.up.railway.app" required>`)}
        <div class="field full cloud-reg" hidden><label>你的名字</label><input name="name" maxlength="20" placeholder="教练"></div>
        <div class="field full cloud-reg" hidden><label>球队名</label><input name="teamName" maxlength="30" placeholder="信工院排球队"></div>
        ${field('邮箱', '<input name="email" type="email" required placeholder="you@example.com">')}
        ${field('密码', '<input name="password" type="password" required minlength="6" placeholder="至少 6 位">')}
      </div>
      <p class="form-note">云端模式会把队员、考勤、技能、阵型同步到服务器，多台设备（电脑/平板）都能看到同一份数据。不登录则仍是本机模式。</p>
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
      const b = String(fd.get('base') || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(b)) { hooks.toast('服务器地址需要以 http(s):// 开头', 'warn'); return; }
      localStorage.setItem(LS.base, b);
      const payload = {
        email: String(fd.get('email') || '').trim(),
        password: String(fd.get('password') || '')
      };
      if (mode === 'register') {
        payload.name = String(fd.get('name') || '').trim() || '教练';
        payload.teamName = String(fd.get('teamName') || '').trim() || '我的排球队';
      }
      const btn = document.getElementById('cloudSubmit');
      btn.disabled = true;
      btn.textContent = '连接中…';
      try {
        const data = await api(`/api/auth/${mode}`, { method: 'POST', body: payload });
        saveSession(data);
        await pullCore();
        await syncWeek(currentMondayKey(), true);
        hooks.closeModal();
        paintCloudUI();
        hooks.renderAll();
        hooks.toast(`已连接云端：${data.team.name}`);
      } catch (err) {
        hooks.toast(err.message, 'warn');
        btn.disabled = false;
        btn.textContent = mode === 'register' ? '注册并同步' : '登录并同步';
      }
    };
  }

  /* ── 推送（写操作） ── */
  const push = {
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

  /** 高频写（考勤、阵型）：后台推送，失败提示并回拉 */
  function fireAndSync(promise, resync) {
    promise.catch((e) => {
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
      paintCloudUI();
      const btn = document.getElementById('cloudBtn');
      if (btn) btn.onclick = openLogin;
      if (enabled()) {
        // 静默校验 token 并拉最新数据；失败（过期）则退回本地模式
        pullCore()
          .then(() => { paintCloudUI(); hooks.renderAll(); return syncWeek(currentMondayKey(), true); })
          .then((ok) => { if (ok) hooks.renderAll(); })
          .catch((e) => {
            if (e.code === 'token_expired' || e.code === 'unauthorized') {
              logout();
              hooks.toast('云端登录已过期，已回到本机模式', 'warn');
            } else {
              hooks.toast(`云端暂时不可用：${e.message}（先用本机数据）`, 'warn');
            }
          });
      }
    },
    enabled,
    user: () => user,
    team: () => team,
    openLogin,
    logout,
    syncWeek,
    pullCore,
    push,
    fireAndSync
  };
})();
