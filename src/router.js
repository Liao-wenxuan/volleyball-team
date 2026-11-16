/* ============================================================
 * router —— 页面切换 / 命令面板 / 事件绑定
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
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
      ...db.players.map((p) => ({ kind: '队员', icon: String(p.number), title: p.name, sub: `${p.position} · ${p.grade} · ${p.height ? p.height + "cm" : "身高—"}${p.gender ? " · " + p.gender : ""}`, run: () => openPlayer(p.id) }))
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
        else if (action === 'sheet-import') openSheetImport();
        else if (action === 'add-session') openSessionModal(null, targetMonday, { isNew: true });
        else if (action === 'reset-week') resetWeek(targetMonday);
        else if (action === 'export') exportData();
        else if (action === 'link-export') openLinkExport();
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

    // 侧边栏身份卡：指针聚光 + 微倾视差。纯装饰，不绑定任何点击。
    const chip = $('#userChip');
    if (chip) {
      let raf = 0, px = 0.5, py = 0.5;
      const paint = () => {
        raf = 0;
        chip.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        chip.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        chip.style.setProperty('--ry', ((px - 0.5) * 9).toFixed(2) + 'deg');
        chip.style.setProperty('--rx', ((0.5 - py) * 7).toFixed(2) + 'deg');
      };
      chip.addEventListener('pointermove', (e) => {
        const r = chip.getBoundingClientRect();
        px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        if (!raf) raf = requestAnimationFrame(paint);
      });
      chip.addEventListener('pointerleave', () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        chip.style.setProperty('--mx', '50%');
        chip.style.setProperty('--my', '50%');
        chip.style.setProperty('--rx', '0deg');
        chip.style.setProperty('--ry', '0deg');
      });
    }

    $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
    $('#scrim').onclick = closeSidebar;
    // 跨越 900px 断点时清残留：拉宽回常驻布局时，把还开着的抽屉和遮罩一并收掉；
    // 缩窄无需处理（常驻侧边栏由媒体查询自然接管为抽屉态）
    const narrowMQ = window.matchMedia('(max-width: 900px)');
    const onNarrowChange = (mq) => { if (!mq.matches) closeSidebar(); };
    narrowMQ.addEventListener ? narrowMQ.addEventListener('change', onNarrowChange) : narrowMQ.addListener(onNarrowChange);

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
    // 左下角用户卡只是展示「当前登录人」，不挂任何点击行为（2026-11-04 用户明确要求）
    // 训练模板/数据管理统一走：右上角头像菜单 → 训练模板，或页脚 dock
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
    $('#menuLinkShare').onclick = () => { closePopovers(); openLinkExport(); };
    $('#menuImport').onclick = () => { closePopovers(); openImportChooser(); };
    $('#menuClear').onclick = () => { closePopovers(); clearAllData(); };
    $('#menuAbout').onclick = () => { closePopovers(); openHelp(); };
    $('#menuLogout').onclick = () => { closePopovers(); window.XGYCloud.logout(); renderAllCurrent(); };

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
      stack.classList.toggle('open', state.stackOpen);
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
