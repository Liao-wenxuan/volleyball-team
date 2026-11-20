/* ============================================================
 * settings —— 设置 / 数据 / 导入链接：把备份压进 URL 的 #backup=，跨设备搬数据不用选文件
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 设置 / 数据 ══════════ */
  // 主动改主题/模板后的保护期：跨境链路下 PUT 可能几十秒后才落定，
  // 期间 15s 同步轮询会把「上一主题的旧值」当别人的改动拉回来盖掉本地
  // （实测：点薄荷 → 跳松林 → 跳暖砂，其实是自己的请求在排队）。
  // 保护期内 applyServerState 不应用服务器带来的这两项，等自己的 PUT 落定后两边自然一致。
  const SETTINGS_GRACE = 60 * 1000;
  let themeLocalAt = 0;
  let templateLocalAt = 0;

  function applyTheme(id) {
    const t = isTheme(id) ? id : 'court';
    const meta = THEMES.find((x) => x.id === t) || THEMES[0];
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.mode = meta.mode || 'dark';
    if (db.settings) db.settings.theme = t;
  }

  /** v55 一次性迁移：历史默认主题「极光」（紫）和登录门禁的奶油暖棕撞脸。
      只跑一次（本地标记），且仅当库仍停在历史默认时迁到「排球」；
      用户之后手动选回极光不会再被动。云端模式下必须在 applyServerState
      之后调用——否则刚改完就被 pullCore 拉回来的旧值盖回去。 */
  function migrateThemeOnce() {
    try {
      if (localStorage.getItem(THEME_MIGRATION_KEY)) return;
      // 没迁就不置位：登录前本地还是新库默认（court），这时候判定没有意义，
      // 置了标记反而让服务器真正数据（aurora）合并回来时再也没机会迁。
      if (db.settings.theme !== 'aurora') return;
      applyTheme('court');
      save();
      localStorage.setItem(THEME_MIGRATION_KEY, '1');
      if (CloudOn()) { themeLocalAt = Date.now(); cloudFire(window.XGYCloud.push.theme('court'), null); }
    } catch (e) { /* 隐私模式 localStorage 会抛：当作已迁移，不折腾 */ }
  }

  function setTheme(id) {
    if (!isTheme(id)) return;
    applyTheme(id);
    save();
    if (CloudOn()) { themeLocalAt = Date.now(); cloudFire(window.XGYCloud.push.theme(id), null); }
    paintThemeCards();
    const t = THEMES.find((x) => x.id === id);
    toast(`已换上「${t.name}」球衣`);
  }

  function paintThemeCards() {
    $$('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.themeId === db.settings.theme));
  }

  /** 球衣卡：主场（court）单独置顶，其余九套 3×3，避免十张卡掉单 */
  function themeCardHTML(t, featured = false) {
    return `<button type="button" class="theme-card${featured ? ' featured' : ''}" data-theme-id="${t.id}" data-mode="${t.mode || 'dark'}"
        style="--p1:${t.p};--p2:${t.s};--base:${t.base};--ink:${t.ink}" aria-label="切换到${t.name}配色">
      <span class="jersey">
        <span class="jersey-num">${t.no}</span>
        <span class="jersey-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.4l3 3 6-6.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </span>
      <span class="tc-meta">
        <span class="tc-name">${t.name}${t.mode === 'light' ? '<i class="tc-tag">浅</i>' : ''}</span>
        <span class="tc-sub">${t.sub}</span>
      </span>
    </button>`;
  }

  function openTheme() {
    const featured = THEMES[0];
    const body = `<p class="theme-hint">每套配色对应一个球场语境。切换只改界面颜色，出勤绿、缺席红、提醒琥珀三个状态色始终不变。</p>
      <div class="theme-featured">${themeCardHTML(featured, true)}</div>
      <p class="theme-divider"><span>其他球队</span></p>
      <div class="theme-grid">${THEMES.slice(1).map((t) => themeCardHTML(t)).join('')}</div>`;
    openModal('球队配色', body, { mid: true, cls: 'theme-modal' });
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
      <div class="settings-actions"><button class="btn btn-ghost" data-action="export">导出 JSON</button><button class="btn btn-ghost" data-action="link-export">导出为链接</button><button class="btn btn-ghost" data-action="import">导入备份</button><button class="btn btn-ghost" data-action="paste-import">粘贴导入</button><button class="btn btn-danger-ghost" data-action="clear-data">清空所有数据</button></div>
    </div>`;
    openModal('设置', body, { mid: true });
    $('#templateForm').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const next = t.map((x, i) => ({ ...x, start: String(fd.get(`start_${i}`)), end: String(fd.get(`end_${i}`)), venue: String(fd.get(`venue_${i}`) || '').trim() }));
      for (const x of next) if (x.start >= x.end) { toast(`${x.label}的结束时间需要晚于开始时间`, 'warn'); return; }
      db.settings.template = next;
      save();
      if (CloudOn()) { templateLocalAt = Date.now(); cloudFire(window.XGYCloud.push.template(next), null); }
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

  function importData() { openImportChooser(); }

  /* ══════════ 导入链接：把备份压进 URL 的 #backup=，跨设备搬数据不用选文件 ══════════
     安卓的 PWA 独立窗口对 <input type=file> 支持很不稳定，而且从微信里拿到的文件
     还得先存到「文件」App 再翻半天。一条链接点开就能导入，两头都得救。 */
  function b64FromBytes(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const bin = atob(b64 + pad);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  // z = deflate-raw 压缩，p = 明文（老浏览器没有 CompressionStream 时兜底）
  async function packBackup(obj) {
    const text = JSON.stringify(obj);
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      return 'z' + b64FromBytes(new Uint8Array(buf));
    }
    return 'p' + b64FromBytes(new TextEncoder().encode(text));
  }
  async function unpackBackup(payload) {
    const tag = String(payload || '')[0];
    const bytes = bytesFromB64(String(payload).slice(1));
    let text;
    if (tag === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('这台设备解不了压缩数据');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      text = await new Response(stream).text();
    } else if (tag === 'p') {
      text = new TextDecoder().decode(bytes);
    } else {
      throw new Error('链接格式不认识');
    }
    return JSON.parse(text);
  }

  async function openLinkExport() {
    toast('正在生成链接…');
    try {
      const payload = await packBackup({ ...db, savedAt: Date.now() });
      const link = location.href.split('#')[0] + '#backup=' + payload;
      const long = link.length > 8000;
      openModal('发给另一台设备', `<div class="imp-wrap">
        <p class="imp-lead">这条链接里已经带着全部数据，对方<b>不用再要文件</b>。</p>
        <textarea class="imp-ta imp-ta-link" id="lnkOut" rows="4" readonly>${esc(link)}</textarea>
        <p class="imp-note">${link.length} 字符${long ? ' · <b>偏长了</b>，聊天软件可能截断，建议改用「导出备份」传文件' : ''}</p>
        <div class="imp-steps">
          <p><b>1.</b> 复制这条链接，发到自己的微信「文件传输助手」。</p>
          <p><b>2.</b> 在另一台设备上<b>长按这条链接 → 复制</b>。<b>不要直接点开</b>——点开会跑进微信自带的浏览器，数据进不了这个 App。</p>
          <p><b>3.</b> 打开这个 App → 头像 → 导入备份 → <b>用链接导入</b> → 粘贴 → 解析。</p>
        </div>
        <div class="form-foot">
          <button type="button" class="btn btn-primary" id="lnkCopy">复制链接</button>
          <button type="button" class="btn btn-ghost" id="lnkClose">关闭</button>
        </div>
      </div>`, { mid: true });
      $('#lnkClose').onclick = closeModal;
      $('#lnkCopy').onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast('链接已复制，发到微信文件传输助手');
        } catch (e) {
          const t = $('#lnkOut');
          t.focus(); t.select();
          toast('自动复制失败，已帮你选中，长按复制', 'warn');
        }
      };
    } catch (e) {
      toast(`生成链接失败：${e && e.message ? e.message : '未知错误'}`, 'warn');
    }
  }

  function openLinkImport() {
    openModal('用链接导入', `<div class="imp-wrap">
      <p class="imp-lead">把对方发来的<b>导入链接</b>粘到这里。链接里已经带着数据，不用再要文件。</p>
      <textarea class="imp-ta" id="lnkIn" rows="4" placeholder="https://liao-wenxuan.github.io/volleyball-team/#backup=..."></textarea>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="lnkClip">读剪贴板</button>
        <button type="button" class="btn btn-primary" id="lnkGo">解析并导入</button>
        <button type="button" class="btn btn-ghost" id="lnkCancel">取消</button>
      </div>
    </div>`, { mid: true });
    const ta = $('#lnkIn');
    $('#lnkCancel').onclick = closeModal;
    $('#lnkClip').onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('剪贴板是空的', 'warn'); return; }
        ta.value = t;
        toast('已从剪贴板读入');
      } catch (e) {
        toast('读不了剪贴板，长按输入框手动粘贴', 'warn');
      }
    };
    $('#lnkGo').onclick = () => doLinkImport(ta.value);
  }

  async function doLinkImport(text) {
    const m = String(text || '').match(/[#&?]backup=([A-Za-z0-9\-_]+)/);
    if (!m) { toast('这段内容里没找到备份数据', 'warn'); return; }
    toast('正在解析…');
    try {
      const obj = await unpackBackup(m[1]);
      openImportDialog(obj, '导入链接');
    } catch (e) {
      toast('链接读不出来，转发时可能被截断了', 'warn');
    }
  }

  // 页面带着 #backup= 打开时，直接进导入流程
  async function bootBackupHash() {
    const m = location.hash.match(/^#backup=(.+)$/);
    if (!m) return;
    // 先清 hash：确认导入后要 reload，不清掉会反复弹窗
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// 下可能失败 */ }
    await doLinkImport('#backup=' + m[1]);
  }
