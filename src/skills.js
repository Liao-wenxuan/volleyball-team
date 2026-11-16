/* ============================================================
 * skills —— 成长计划 / 单项调整 / 训练后批量调整
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 成长计划 ══════════ */
  function renderGrowth() {
    const avg = teamAverage();
    const thisMonday = getMonday(new Date());
    const weekStart = dateKey(thisMonday);
    const weekEnd = dateKey(addDays(thisMonday, 6));
    const logsThisWeek = db.skillLogs.filter((l) => l.date >= weekStart && l.date <= weekEnd).length;
    const sorted = db.players.slice().sort((a, b) => overall(b) - overall(a));
    $('#gsAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#gsLogs').textContent = logsThisWeek;
    $('#gsTop').textContent = sorted.length ? `${sorted[0].name} ${overall(sorted[0]).toFixed(1)}` : '—';
    $('#gsCount').textContent = db.players.length;

    const matrix = $('#skillMatrix');
    if (!sorted.length) {
      matrix.innerHTML = '';
      $('#matrixEmpty').innerHTML = emptyState('📈', '还没有技能数据', '先添加队员并录入初始技能点，这里会出现全队技能矩阵。', '<button class="btn btn-primary" data-action="add-player">添加队员</button>');
      $('#matrixTag').hidden = true;
    } else {
      $('#matrixEmpty').innerHTML = '';
      $('#matrixTag').hidden = false;
      matrix.innerHTML = `<div class="matrix">
        <div class="matrix-head"><div>队员</div>${SKILLS.map((s) => `<div>${s.label}</div>`).join('')}<div>综合</div></div>
        ${sorted.map((p) => `<div class="matrix-row" data-player-row="${p.id}">
          <button class="m-name" data-open-player="${p.id}"><span class="m-avatar" style="--a:${positionStyle(p.position)[0]};--b:${positionStyle(p.position)[1]}">${esc(p.name[0])}</span><span><b>${esc(p.name)}</b><em>${p.position} · ${p.number} 号</em></span></button>
          ${SKILLS.map((s) => {
            const v = Number(p.skills[s.key] || 0);
            return `<button class="m-cell" data-player="${p.id}" data-skill="${s.key}" style="--v:${v / 10}" title="点击调整 ${esc(p.name)} 的${s.label}">${v.toFixed(1)}</button>`;
          }).join('')}
          <div class="m-overall">${overall(p).toFixed(1)}</div>
        </div>`).join('')}
      </div>`;
    }

    const logs = db.skillLogs.slice().sort((a, b) => b.at - a.at).slice(0, 10);
    const recent = $('#recentLogs');
    if (!logs.length) {
      recent.innerHTML = '';
      $('#recentEmpty').innerHTML = miniEmpty('还没有调整记录。点矩阵里的格子，或使用「训练后调整」。');
    } else {
      $('#recentEmpty').innerHTML = '';
      recent.innerHTML = logs.map((l) => {
        const p = getPlayer(l.playerId);
        if (!p) return '';
        const d = l.date ? parseKey(l.date) : new Date(l.at);
        return `<button class="log-row recent" data-open-player="${p.id}">
          <span class="log-date">${fmtMD(d)}</span>
          <span class="log-main"><b>${esc(p.name)}</b><em>${skillLabel(l.skill)}</em></span>
          <span class="log-delta ${l.delta >= 0 ? 'up' : 'down'}">${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}</span>
          <b class="log-after">${l.after.toFixed(1)}</b><em class="log-source">${sourceLabel(l.source)}</em>
        </button>`;
      }).join('');
    }
  }

  /* ══════════ 单项调整 ══════════ */
  function openAdjustModal(playerId, skillKey) {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const defaultPlayer = getPlayer(playerId) || db.players[0];
    const defaultSkill = skillKey && SKILLS.some((s) => s.key === skillKey) ? skillKey : 'serve';
    const body = `<form id="adjustForm">
      <div class="form-grid">
        <div class="field"><label>队员</label><select name="player">${db.players.map((p) => `<option value="${p.id}" ${p.id === defaultPlayer.id ? 'selected' : ''}>${esc(p.name)} · ${p.position}</option>`).join('')}</select></div>
        <div class="field"><label>技能</label><select name="skill">${SKILLS.map((s) => `<option value="${s.key}" ${s.key === defaultSkill ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        <div class="field"><label>来源</label><select name="source"><option value="training">训练</option><option value="match">比赛</option><option value="manual">手动</option></select></div>
        <div class="field"><label>日期</label><input type="date" name="date" value="${dateKey(new Date())}"></div>
      </div>
      <div class="adjust-preview"><div><span>当前</span><b id="adjustBefore">5.0</b></div><i>→</i><div><span>调整后</span><b id="adjustAfter">5.0</b></div></div>
      <div class="adjust-value"><button type="button" class="step-round" data-adjust-step="-0.5">−</button><input id="adjustInput" type="number" min="0" max="10" step="0.5" value="5.0"><button type="button" class="step-round" data-adjust-step="0.5">+</button></div>
      <div class="form-note">每次只能调整一个队员的一项技能。0–10 分，步进 0.5。</div>
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="submit" class="btn btn-primary">保存调整</button></div>
    </form>`;
    openModal('手动调整技能', body, { mid: true });
    const form = $('#adjustForm');
    const pSel = form.querySelector('[name=player]');
    const sSel = form.querySelector('[name=skill]');
    const input = $('#adjustInput');
    const beforeEl = $('#adjustBefore');
    const afterEl = $('#adjustAfter');
    const current = () => {
      const p = getPlayer(pSel.value);
      return p ? Number(p.skills[sSel.value] || 0) : 0;
    };
    const sync = (setValue) => {
      const cur = current();
      if (setValue != null) input.value = clamp(roundHalf(setValue), 0, 10).toFixed(1);
      const val = clamp(roundHalf(Number(input.value)), 0, 10);
      beforeEl.textContent = cur.toFixed(1);
      afterEl.textContent = val.toFixed(1);
      afterEl.classList.toggle('diff', val !== cur);
    };
    const onChange = () => { input.value = current().toFixed(1); sync(); };
    pSel.onchange = onChange;
    sSel.onchange = onChange;
    input.oninput = () => sync();
    $$('[data-adjust-step]', form).forEach((btn) => { btn.onclick = () => sync(Number(input.value) + Number(btn.dataset.adjustStep)); });
    sync(current());
    form.onsubmit = (e) => {
      e.preventDefault();
      const val = clamp(roundHalf(Number(input.value)), 0, 10);
      const count = applySkillChanges([{ playerId: pSel.value, skill: sSel.value, value: val }], form.source.value, form.date.value || dateKey(new Date()));
      closeModal();
      renderGrowth(); renderRoster(); renderDashboard(); renderActivity();
      if (count) {
        const p = getPlayer(pSel.value);
        toast(`${p.name} · ${skillLabel(sSel.value)} 已更新为 ${val.toFixed(1)}`);
      } else toast('数值没有变化', 'warn');
    };
  }

  /* ══════════ 训练后批量调整 ══════════ */
  /* 兜底壳：脏数据抛异常时也要给可见反馈，不能让按钮「看起来没反应」 */
  function openBatchAdjust() {
    try {
      openBatchAdjustInner();
    } catch (e) {
      console.error('[batch-adjust]', e);
      toast('打开训练后调整失败：' + e.message, 'warn');
    }
  }

  function openBatchAdjustInner() {
    if (!db.players.length) {
      toast(CloudOn() ? '这个队还没有队员，先去人员管理添加' : '先添加队员，或点顶栏「连接云端」登录', 'warn');
      return;
    }
    const mondays = [0, -1, -2, -3].map((n) => addDays(getMonday(new Date()), n * 7));
    const options = [];
    mondays.forEach((m) => { getSessions(m).forEach((s) => { if (s.status !== 'cancelled') options.push({ s, m }); }); });
    options.sort((a, b) => sessionStart(b.s) - sessionStart(a.s));
    if (!options.length) { toast('还没有可用的训练记录，先加一次训练', 'warn'); return; }
    const now = new Date();
    const pastWithMarks = options.find((o) => sessionEnd(o.s) <= now && Object.keys(o.s.attendance || {}).length > 0);
    const pastSession = options.find((o) => sessionEnd(o.s) <= now);
    const defaultOption = pastWithMarks || pastSession || options[0];
    const defaultIndex = Math.max(0, options.indexOf(defaultOption));
    const body = `<div class="batch-wrap">
      <div class="batch-head"><div class="field"><label>选择训练</label><select id="batchSession">${options.map((o, i) => `<option value="${i}" ${i === defaultIndex ? 'selected' : ''}>${fmtDateCN(parseKey(o.s.date))} · ${o.s.start}–${o.s.end}</option>`).join('')}</select></div><div class="batch-hint" id="batchHint"></div></div>
      <div class="batch-scroll"><div id="batchTable"></div></div>
      <div class="batch-foot"><span id="batchCount">还没有改动</span><div><button type="button" class="btn btn-ghost" id="batchReset">重置</button><button type="button" class="btn btn-primary" id="batchSave">保存本次调整</button></div></div>
    </div>`;
    openModal('训练后调整', body, { wide: true });
    let pending = new Map();
    let currentOption = defaultOption;
    let tableListenerBound = false;

    const updateCount = () => { $('#batchCount').textContent = pending.size ? `待保存 ${pending.size} 项改动` : '还没有改动'; };

    const buildTable = () => {
      const s = currentOption.s;
      const hasMarks = Object.keys(s.attendance || {}).length > 0;
      let players = db.players.filter((p) => ['present', 'late'].includes(s.attendance[p.id]));
      const unmarked = !hasMarks;
      if (unmarked) players = db.players.slice();
      // 部分登记：只标过一部分人的考勤时，明确告诉用户还有多少人被隐藏、去哪补，
      // 否则看起来像「弹窗丢了数据」（2026-11-03 用户反馈 11-01 场次只剩 1 人）
      const noRecord = hasMarks ? db.players.filter((p) => !s.attendance[p.id]).length : 0;
      $('#batchHint').textContent = unmarked
        ? `这次训练的考勤还没有登记，默认显示全部 ${db.players.length} 名队员。`
        : (players.length
          ? `按考勤筛选出 ${players.length} 名参训队员（出勤 / 迟到）。` +
            (noRecord ? `另有 ${noRecord} 人没登过考勤，没显示；要给他们调整先去训练页补考勤。` : '')
          : '这次训练的考勤里没有出勤或迟到的队员。');
      if (!players.length) { $('#batchTable').innerHTML = miniEmpty('这次训练没有参训队员可以调整。'); return; }
      $('#batchTable').innerHTML = `<table class="batch-table">
        <thead><tr><th>队员</th>${SKILLS.map((sk) => `<th>${sk.label}</th>`).join('')}</tr></thead>
        <tbody>${players.map((p) => `<tr data-player="${p.id}">
          <td><div class="batch-player"><span class="u-avatar" style="--a:${positionStyle(p.position)[0]};--b:${positionStyle(p.position)[1]}">${esc(p.name[0])}</span><span><b>${esc(p.name)}</b><em>${p.position}</em></span></div></td>
          ${SKILLS.map((sk) => {
            const v = Number(p.skills[sk.key] || 0);
            return `<td><div class="batch-stepper" data-player="${p.id}" data-skill="${sk.key}" data-value="${v.toFixed(1)}" data-original="${v.toFixed(1)}"><button type="button" data-step="-0.5">−</button><b title="双击数字还原这一格">${v.toFixed(1)}</b><button type="button" data-step="0.5">+</button></div></td>`;
          }).join('')}
        </tr>`).join('')}</tbody></table>`;
      pending = new Map();
      updateCount();
    };

    if (!tableListenerBound) {
      $('#batchTable').addEventListener('click', (e) => {
        const btn = e.target.closest('.batch-stepper button');
        if (!btn) return;
        const box = btn.closest('.batch-stepper');
        const cur = Number(box.dataset.value);
        const next = clamp(roundHalf(cur + Number(btn.dataset.step)), 0, 10);
        box.dataset.value = next.toFixed(1);
        $('b', box).textContent = next.toFixed(1);
        const key = `${box.dataset.player}:${box.dataset.skill}`;
        const original = Number(box.dataset.original);
        if (next === original) pending.delete(key);
        else pending.set(key, { playerId: box.dataset.player, skill: box.dataset.skill, value: next });
        box.classList.toggle('changed', next !== original);
        updateCount();
      });
      $('#batchTable').addEventListener('dblclick', (e) => {
        // 还原只认「双击中间那个数字」。双击 +/− 按钮属于连点调整，一律不还原——
        // 否则两次点击被浏览器判成 dblclick 时，数值会被拉回原值，
        // 看起来就是「点了加号反而变小」（连点越快越容易中招）
        if (!e.target.closest('.batch-stepper b')) return;
        const box = e.target.closest('.batch-stepper');
        if (!box) return;
        const key = `${box.dataset.player}:${box.dataset.skill}`;
        box.dataset.value = box.dataset.original;
        $('b', box).textContent = box.dataset.original;
        box.classList.remove('changed');
        pending.delete(key);
        updateCount();
      });
      tableListenerBound = true;
    }
    $('#batchSession').onchange = (e) => { currentOption = options[Number(e.target.value)]; buildTable(); };
    $('#batchReset').onclick = () => {
      $$('#batchTable .batch-stepper').forEach((box) => {
        box.dataset.value = box.dataset.original;
        $('b', box).textContent = box.dataset.original;
        box.classList.remove('changed');
      });
      pending = new Map();
      updateCount();
    };
    $('#batchSave').onclick = () => {
      if (!pending.size) { toast('没有改动需要保存', 'warn'); return; }
      const count = applySkillChanges(Array.from(pending.values()), 'training', currentOption.s.date);
      closeModal();
      renderGrowth(); renderRoster(); renderDashboard(); renderActivity();
      toast(`已保存 ${count} 项技能调整`);
    };
    buildTable();
  }
