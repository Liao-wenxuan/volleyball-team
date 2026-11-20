/* ============================================================
 * ui —— UI 基础 / 侧边栏 / 最近动态 / 雷达图 / 总览
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
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
    $('#modal').className = `modal${o.wide ? ' wide' : o.mid ? ' mid' : ''}${o.cls ? ' ' + o.cls : ''}`;
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
      <defs><radialGradient id="${gid}" cx="50%" cy="50%" r="65%"><stop offset="0%" style="stop-color:rgba(var(--violet-rgb),.5)"/><stop offset="100%" style="stop-color:rgba(var(--violet-rgb),.12)"/></radialGradient></defs>
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
    btn.hidden = logs.length <= 3; // 不超过 3 条时全都能看到，展开按钮没意义
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
    if (rate >= 75) return 'rgba(var(--violet-rgb),.55)';
    if (rate >= 50) return 'rgba(var(--violet-rgb),.35)';
    return 'rgba(var(--violet-rgb),.2)';
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
