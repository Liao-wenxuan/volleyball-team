/* ============================================================
 * attendance —— 考勤 / 阵容完整度：排球特有的领域指标 / 训练弹窗
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
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

  /* ══════════ 阵容完整度：排球特有的领域指标 ══════════
   * 出勤率回答「来了多少人」，这个回答「缺谁、还能练什么」。
   * 判据：本周至少到过一次（出勤/迟到）就算在；请假/缺席/未登记不算。 */
  const POS_CONSEQ = {
    '主攻': '四号位强攻和一传反轮练不了',
    '副攻': '拦网配合和三号位快攻练不了',
    '二传': '进攻组织整个跑不起来',
    '接应': '二号位进攻和右路防守练不了',
    '自由人': '防守轮转和垫球串联练不了'
  };

  function lineupIntegrity(monday) {
    const active = getSessions(monday).filter((s) => s.status !== 'cancelled');
    const came = new Set();
    active.forEach((s) => db.players.forEach((p) => {
      const st = s.attendance[p.id];
      if (st === 'present' || st === 'late') came.add(p.position);
    }));
    return {
      sessions: active.length,
      on: POSITIONS.filter((x) => came.has(x)),
      missing: POSITIONS.filter((x) => !came.has(x))
    };
  }

  function renderLineup(li) {
    const grid = $('#lineupGrid');
    const note = $('#lineupNote');
    if (!grid || !note) return;
    if (!db.players.length || !li.sessions) {
      grid.innerHTML = POSITIONS.map((x) => `<span class="lu-chip dim">${x}</span>`).join('');
      note.innerHTML = `<p class="lu-mut">${db.players.length ? '本周还没有训练或还没人登记' : '先添加队员'}</p>`;
      return;
    }
    const posOf = {};
    db.players.forEach((p) => { (posOf[p.position] = posOf[p.position] || []).push(p); });
    grid.innerHTML = POSITIONS.map((x) => {
      const ok = li.on.includes(x);
      const names = (posOf[x] || []).filter((p) => li.on.includes(x)).map((p) => p.name);
      const title = ok ? `${x}：${names.join('、') || '—'} 本周到过` : `${x}：本周没人到过`;
      return `<span class="lu-chip ${ok ? 'on' : 'off'}" title="${esc(title)}">${ok ? '✓' : '✕'} ${x}</span>`;
    }).join('');
    if (!li.missing.length) {
      note.innerHTML = `<p class="lu-ok">五个位置都到过，战术课想怎么排就怎么排。</p>`;
    } else {
      note.innerHTML = li.missing.map((x) => `<p class="lu-bad"><b>缺${x}</b> · ${POS_CONSEQ[x]}</p>`).join('');
    }
  }

  function renderAttSide(stats) {
    paintDonut(stats);
    renderLineup(lineupIntegrity(state.weekMonday));
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
