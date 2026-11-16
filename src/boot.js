/* ============================================================
 * boot —— 启动 / PWA：Service Worker 更新提示 / PWA：Service Worker 注册 + 安装引导
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 启动 ══════════ */
  // 首屏加载动画：页面可见即开始播，这里等主界面渲染完再摘（最短展示 1.2s，能看完一帧切换）。
  // 兜底在 head 内联脚本里（6s 强摘），脚本挂了也不会卡死在开机画面。
  function dismissLoader() {
    const el = document.getElementById('bootLoader');
    if (!el || el.classList.contains('done')) return;
    setTimeout(() => {
      el.classList.add('done');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    }, 1600);
  }

  function init() {
    state.weekMonday = getMonday(new Date());
    if (!CloudOn()) migrateThemeOnce();
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
        confirm: confirmDialog,
        getDB: () => db,
        save,
        // 退出云端后把内存切回本机数据：否则内存里还是上一个队的名单，
        // 用户在「仅在本机使用」里一编辑就把云端数据写进了本机那份，或者
        // 换号登录时被当成「本机原有名单」搬到新队去（串队事故）。
        // 退出云端回本地模式：内存切回本机那份，配色也要跟着切回去
        // （不然界面还挂着刚退出那个队的主题，而 db 已经是本机的）
        reloadLocal: () => { db = loadDB(); applyTheme(db.settings.theme); renderAllCurrent(); },
        // 主题/模板的保护期只针对「同一队内自己刚改过」。换队、换号登录必须清零，
        // 否则上一队的时间戳会把新队的服务器设置挡在门外，造成跨队串主题。
        resetSettingsGrace: () => { themeLocalAt = 0; templateLocalAt = 0; },
        // 换队 / 换号：内存 db 是单例，只有 logout 会 reloadLocal() 换成本机那份。
        // 不先重建骨架，applyServerState 里带 if 守卫的字段就会沿用上一份库的值。
        resetForTeam: () => {
          if (state.ai && state.ai.abort) { try { state.ai.abort.abort(); } catch (_) { /* ignore */ } }
          state.ai = { messages: [], busy: false, abort: null }; // AI 面板读 state.ai，光清 db.aiChat 不够
          clearTimeout(fxPushTimer); fxPushTimer = null;          // 别把 A 队的阵型防抖推送落到 B 队
          db = blankDB();
        },
        // 「本机原有数据」＝本地模式那份（不带球队后缀）。登录时用它判断要不要提示搬迁，
        // 不能拿内存里的 db —— 那可能是上一个云端队的名单，搬过去就是串队。
        localDB: () => {
          try {
            const raw = localStorage.getItem(DB_KEY);
            return raw ? JSON.parse(raw) : null;
          } catch (e) { return null; }
        },
        renderAll: renderAllCurrent,
        applyServerState,
        applyWeek,
        currentMondayKey: () => weekKey(state.weekMonday)
      });
      cloudEnsureWeek(state.weekMonday);
    }
    initPWA();
    dismissLoader();
  }

  /* ══════════ PWA：Service Worker 更新提示 ══════════ */
  /* sw.js 里 skipWaiting() + clients.claim() 会让新 SW 立刻接管，但已经打开的页面
   * 仍跑旧 HTML/JS，以前只能 F12 → 注销 Service Worker → 硬刷新。这里补上可见提示。
   * 只在「已有 controller」时才提示（首次安装是 controller 从无到有，不算更新）；
   * 也绝不自动 reload —— 用户可能正填考勤或摆阵型，刷新会打断没保存的操作。 */
  function watchSwUpdate(reg) {
    let offered = false;
    let reloading = false;
    const offer = () => {
      if (offered || !navigator.serviceWorker.controller || document.querySelector('.sw-update')) return;
      offered = true;
      const bar = document.createElement('div');
      bar.className = 'pwa-install sw-update';
      bar.innerHTML = `
        <div class="pwa-install-txt"><b>发现新版本</b><i>当前还是旧界面，重载后生效</i></div>
        <button type="button" class="pwa-install-go">立即重载</button>
        <button type="button" class="pwa-install-x" aria-label="稍后再说">×</button>`;
      document.body.appendChild(bar);
      requestAnimationFrame(() => bar.classList.add('show'));
      const close = () => { bar.classList.remove('show'); setTimeout(() => bar.remove(), 400); };
      bar.querySelector('.pwa-install-x').addEventListener('click', close);
      bar.querySelector('.pwa-install-go').addEventListener('click', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    };
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer();
      });
      // 页面刚加载时，新 SW 可能已经装完停在 waiting
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer();
    };
    reg.addEventListener('updatefound', () => watch(reg.installing));
    if (reg.waiting) watch(reg.waiting);
    // 浏览器自己通常 24h 才查一次；页面可见时主动查一次，不轮询打扰
    if (document.visibilityState === 'visible') reg.update().catch(() => { /* 断网就等下次 */ });
  }

  /* ══════════ PWA：Service Worker 注册 + 安装引导 ══════════ */
  function initPWA() {
    // file://（单文件分发）下 SW 不可用，直接跳过；线上（https）和本地调试（http）才注册
    if (!/^https?:$/.test(location.protocol)) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(watchSwUpdate)
        .catch(() => { /* 注册失败不影响使用 */ });
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

  // 带 #backup= 打开链接时直接进导入流程（要在 init 之后，db 已经读进来了）。
  // 浏览器里没有 CommonJS 的 module，照常启动；Node 下用 vm 加载时跳过启动（没有 DOM）。
  if (typeof module === 'undefined') {
    init();
    bootBackupHash();
  }

  /* 测试钩子：浏览器里 typeof module 恒为 'undefined'，这整段是死代码。
   * tests/load-app.mjs 用 vm 在 Node 里加载本文件，跳过后只导出不依赖 DOM 的纯函数，
   * 让 node:test 直接跑生产源码本身——不是复制出来的副本，也不必为了可测性引入打包链
   * 或多维护一份函数。新增纯函数时记得同步加进这个列表。 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      clamp, roundHalf, esc, pad2, startOfDay, addDays, getMonday, dateKey, parseKey,
      isSameDay, fmtMD, fmtRange, fmtDateCN, fxClamp, fxSnap, blankFormation, normalizeFormation,
      normalizeSkills, normalizePlayer, normalizeSession, normalizeLog, overall, splitRow,
      normalizeImportPosition, normalizeImportGrade, normalizeImportNumber, normalizeImportHeight
    };
  }