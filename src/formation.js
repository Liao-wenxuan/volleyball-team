/* ============================================================
 * formation —— 阵型板
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 阵型板 ══════════ */
  const fxEls = {};
  let fxReady = false;
  let fxDrag = null;

  function mountTactics() {
    if (fxReady) return;
    const court = $('#fxCourt');
    if (!court) return;

    FX_ROLES.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'fx-token';
      el.dataset.role = r.id;
      el.style.setProperty('--role', r.color);
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${fxRoleName(r.id)}，拖动调整站位，方向键微调`);
      el.innerHTML = `<span>${fxRoleName(r.id)}</span>`;
      court.appendChild(el);
      fxEls[r.id] = el;
      bindFxPointer(el, r);
      bindFxKeys(el, r);
    });

    $('#fxRoles').innerHTML = FX_ROLES.map((r) =>
      `<li class="fx-role" style="--role:${r.color}"><i class="fx-role-dot"></i><span class="fx-role-name">${r.name}</span><span class="fx-role-pos" data-pos="${r.id}">—</span></li>`
    ).join('');

    $('#fxSaveBtn').addEventListener('click', () => toggleFxSaveRow());
    $('#fxSaveCancel').addEventListener('click', () => toggleFxSaveRow(false));
    const saveName = $('#fxSaveName');
    saveName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = saveName.value.trim();
        if (!name) { toast('先给阵型起个名字', 'warn'); return; }
        saveFxCurrent(name);
        toggleFxSaveRow(false);
      }
    });
    $('#fxSaveOk').addEventListener('click', () => {
      const name = saveName.value.trim();
      if (!name) { toast('先给阵型起个名字', 'warn'); return; }
      saveFxCurrent(name);
      toggleFxSaveRow(false);
    });
    $('#fxSaves').addEventListener('click', (e) => {
      const apply = e.target.closest('[data-apply]');
      if (apply) { applyFxSaved(apply.dataset.apply); return; }
      const del = e.target.closest('[data-del]');
      if (del) { deleteFxSaved(del.dataset.del); return; }
      const rnBtn = e.target.closest('[data-rename-btn]');
      if (rnBtn) { fxRenameId = rnBtn.dataset.renameBtn; paintFxSaves(); return; }
      const rnOk = e.target.closest('[data-rename-ok]');
      if (rnOk) {
        const inp = $('#fxSaves').querySelector(`[data-rename="${rnOk.dataset.renameOk}"]`);
        fxRenameId = '';
        renameFxSaved(rnOk.dataset.renameOk, inp ? inp.value : '');
        return;
      }
      const upd = e.target.closest('[data-update]');
      if (upd) updateFxSaved(upd.dataset.update);
    });
    $('#fxSaves').addEventListener('keydown', (e) => {
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        fxRenameId = '';
        renameFxSaved(inp.dataset.rename, inp.value);
      } else if (e.key === 'Escape') {
        fxRenameId = '';
        paintFxSaves();
      }
    });
    // 点 ✓ 时先压住默认行为，避免输入框失焦导致改名行被重建、click 落空
    $('#fxSaves').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-rename-ok]')) e.preventDefault();
    });
    $('#fxSaves').addEventListener('focusout', (e) => {
      const inp = e.target.closest('[data-rename]');
      if (!inp || fxRenameId !== inp.dataset.rename) return;
      fxRenameId = '';
      paintFxSaves();
    });

    $('#fxExport').addEventListener('click', () => openCourtCard());
    $('#fxReset').addEventListener('click', () => applyFxPreset('base'));
    $('#fxFull').addEventListener('click', toggleFxFull);
    $('#fxExit').addEventListener('click', exitFxFull);
    $('#fxExitTop').addEventListener('click', exitFxFull);

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('fx-immersive')) {
        document.body.classList.remove('fx-immersive');
        renderTactics();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('fx-immersive') && !document.fullscreenElement) exitFxFull();
    });

    document.addEventListener('pointerdown', fsWake, true);
    document.addEventListener('keydown', fsWake, true);

    fxReady = true;
  }

  function renderTactics() {
    mountTactics();
    const f = db.formation;
    FX_ROLES.forEach((r) => {
      const el = fxEls[r.id];
      if (!el) return;
      const p = f.pos[r.id];
      el.style.left = (p.x / FX_SIZE * 100) + '%';
      el.style.top = (p.y / FX_SIZE * 100) + '%';
      // 标牌名随自由人是否在前排动态变（自由人→副攻2 / 副攻→副攻1）
      const label = fxRoleName(r.id);
      const span = el.querySelector('span');
      if (span && span.textContent !== label) span.textContent = label;
      el.setAttribute('aria-label', `${label}，拖动调整站位，方向键微调`);
    });
    paintFxPresets();
    paintFxSaves();
    paintFxRoles();
  }

  function paintFxPresets() {
    // 标题 / 状态标签跟阵型库统一（r33）：base = 默认站位，
    // 套用了库里的哪套就显示那套的名字，手动改动后回落「自定义站位」
    const label = db.formation.preset === 'base' ? '默认站位' : (db.formation.name || '自定义');
    const title = db.formation.preset === 'base' ? '默认站位' : (db.formation.name || '自定义站位');
    const tag = $('#fxState');
    if (tag) tag.textContent = label;
    const h2 = $('#fxTitle');
    if (h2) h2.textContent = title;
    const fsName = $('#fxFsName');
    if (fsName) fsName.textContent = label;
  }

  let fsIdleTimer = 0;
  function fsWake() {
    const bar = $('#fxFsBar');
    const top = $('#fxExitTop');
    if (bar) bar.classList.remove('idle');
    if (top) top.classList.remove('idle');
    clearTimeout(fsIdleTimer);
    if (!document.body.classList.contains('fx-immersive')) return;
    fsIdleTimer = setTimeout(() => {
      if (!document.body.classList.contains('fx-immersive')) return;
      if (bar) bar.classList.add('idle');
      if (top) top.classList.add('idle');
    }, 3000);
  }

  function enterFxFull() {
    document.body.classList.add('fx-immersive');
    renderTactics();
    fsWake();
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => { /* 不支持就用沉浸层兜底 */ });
    }
  }

  function exitFxFull() {
    document.body.classList.remove('fx-immersive');
    clearTimeout(fsIdleTimer);
    const bar = $('#fxFsBar');
    if (bar) bar.classList.remove('idle');
    const top = $('#fxExitTop');
    if (top) top.classList.remove('idle');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    renderTactics();
  }

  function toggleFxFull() {
    if (document.body.classList.contains('fx-immersive')) exitFxFull();
    else enterFxFull();
  }

  function paintFxRoles() {
    FX_ROLES.forEach((r) => {
      const el = $(`#fxRoles [data-pos="${r.id}"]`);
      if (!el) return;
      const p = db.formation.pos[r.id];
      el.textContent = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)}`;
      const nameEl = el.parentElement && el.parentElement.querySelector('.fx-role-name');
      if (nameEl) nameEl.textContent = fxRoleName(r.id);
    });
  }

  function applyFxPreset(k) {
    const preset = fxPreset(k);
    if (!preset) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: preset.pos[r.id].x, y: preset.pos[r.id].y }; });
    db.formation = { version: 1, preset: k, name: '', pos };
    save();
    cloudPushFormation();
    renderTactics();
    toast(`已套用「${preset.label}」`);
  }

  /* ── 自定义阵型库：把当前站位存成命名阵型 ── */
  function fxPreset(k) {
    const p = FX_PRESETS[k];
    return p ? { label: p.label, pos: p.pos } : null;
  }

  function sameFxPos(a, b) {
    return FX_ROLES.every((r) => Math.abs(a[r.id].x - b[r.id].x) < 0.01 && Math.abs(a[r.id].y - b[r.id].y) < 0.01);
  }

  function saveFxCurrent(name) {
    if (!Array.isArray(db.formations)) db.formations = [];
    if (db.formations.length >= 30) { toast('自定义阵型最多存 30 套，先删掉几个', 'warn'); return; }
    const dup = db.formations.find((f) => f.name === name);
    if (dup) { toast(`已经有叫「${name}」的阵型了`, 'warn'); return; }
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: db.formation.pos[r.id].x, y: db.formation.pos[r.id].y }; });
    db.formations.push({ id: uid('f'), name, pos, at: Date.now() });
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`已保存「${name}」，在下方列表随时套用`);
  }

  function applyFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: f.pos[r.id].x, y: f.pos[r.id].y }; });
    db.formation = { version: 1, preset: 'custom', name: f.name, pos };
    save();
    cloudPushFormation();
    renderTactics();
    toast(`已套用「${f.name}」`);
  }

  async function deleteFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const ok = await confirmDialog({ title: `删除「${f.name}」？`, message: '只删这套保存的阵型，不影响当前站位。这个操作无法撤销。', ok: '确认删除' });
    if (!ok) return;
    db.formations = db.formations.filter((x) => x.id !== id);
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast('阵型已删除');
  }

  function renameFxSaved(id, name) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    name = String(name || '').trim().slice(0, 12);
    if (!name) { toast('名字不能为空', 'warn'); return; }
    if (db.formations.some((x) => x.id !== id && x.name === name)) { toast(`已经有叫「${name}」的阵型了`, 'warn'); return; }
    f.name = name;
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`已改名为「${name}」`);
  }

  function updateFxSaved(id) {
    const f = (db.formations || []).find((x) => x.id === id);
    if (!f) return;
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: db.formation.pos[r.id].x, y: db.formation.pos[r.id].y }; });
    if (sameFxPos(pos, f.pos)) { toast(`「${f.name}」已经是这个站位了`); return; }
    f.pos = pos;
    f.at = Date.now();
    save();
    cloudPushFxLibrary();
    paintFxSaves();
    toast(`「${f.name}」已更新为当前站位`);
  }

  let fxRenameId = '';
  function paintFxSaves() {
    const box = $('#fxSaves');
    if (!box) return;
    const list = Array.isArray(db.formations) ? db.formations : [];
    box.innerHTML = list.map((f) => {
      const on = db.formation.preset === 'custom' && sameFxPos(db.formation.pos, f.pos);
      if (fxRenameId === f.id) {
        return `<div class="fx-save on" data-id="${f.id}">
          <input class="fx-rename-input" data-rename="${f.id}" maxlength="12" value="${esc(f.name)}">
          <button type="button" class="fx-act ok" data-rename-ok="${f.id}" aria-label="确认改名">✓</button>
        </div>`;
      }
      return `<div class="fx-save${on ? ' on' : ''}">
        <button type="button" class="fx-save-name" data-apply="${f.id}" title="套用「${esc(f.name)}」">${esc(f.name)}</button>
        <button type="button" class="fx-act" data-rename-btn="${f.id}" title="重命名" aria-label="重命名">✎</button>
        <button type="button" class="fx-act" data-update="${f.id}" title="用当前站位覆盖这套" aria-label="更新站位">⟳</button>
        <button type="button" class="fx-act danger" data-del="${f.id}" title="删除" aria-label="删除 ${esc(f.name)}">×</button>
      </div>`;
    }).join('') || '<div class="fx-save-empty">还没有保存的阵型。摆好站位后点「存当前」。</div>';
    if (fxRenameId) {
      const inp = box.querySelector(`[data-rename="${fxRenameId}"]`);
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function toggleFxSaveRow(show) {
    const row = $('#fxSaveRow');
    if (!row) return;
    const open = show === undefined ? !row.classList.contains('open') : show;
    row.classList.toggle('open', open);
    if (open) { $('#fxSaveName').value = ''; $('#fxSaveName').focus(); }
  }

  function fxMeters(e) {
    const r = $('#fxCourt').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * FX_SIZE, y: (e.clientY - r.top) / r.height * FX_SIZE };
  }

  function fxShowCoord(p) {
    const coord = $('#fxCoord');
    if (!coord) return;
    coord.classList.add('on');
    coord.style.left = (p.x / FX_SIZE * 100) + '%';
    coord.style.top = (p.y / FX_SIZE * 100) + '%';
    coord.textContent = `x ${p.x.toFixed(2)}m · 距网 ${p.y.toFixed(2)}m`;
  }

  function bindFxPointer(el, role) {
    el.addEventListener('pointerdown', (e) => {
      if (fxDrag) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const m = fxMeters(e);
      const p = db.formation.pos[role.id];
      fxDrag = { id: role.id, pid: e.pointerId, dx: m.x - p.x, dy: m.y - p.y, moved: false };
      el.classList.add('dragging');
      fxShowCoord(p);
    });

    el.addEventListener('pointermove', (e) => {
      if (!fxDrag || fxDrag.pid !== e.pointerId || fxDrag.id !== role.id) return;
      e.preventDefault();
      const m = fxMeters(e);
      const x = fxClamp(m.x - fxDrag.dx);
      const y = fxClamp(m.y - fxDrag.dy);
      fxDrag.moved = true;
      db.formation.pos[role.id] = { x, y };
      el.style.left = (x / FX_SIZE * 100) + '%';
      el.style.top = (y / FX_SIZE * 100) + '%';
      fxShowCoord({ x, y });
    });

    const end = (e) => {
      if (!fxDrag || fxDrag.pid !== e.pointerId || fxDrag.id !== role.id) return;
      const moved = fxDrag.moved;
      fxDrag = null;
      el.classList.remove('dragging');
      const coord = $('#fxCoord');
      if (coord) coord.classList.remove('on');
      if (!moved) return;
      const p = db.formation.pos[role.id];
      db.formation.pos[role.id] = { x: fxSnap(p.x), y: fxSnap(p.y) };
      db.formation.preset = 'custom';
      db.formation.name = ''; // 手动动过就不再是「库里的那套」，标题回落自定义
      save();
      cloudPushFormation();
      renderTactics();
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', (e) => { if (fxDrag) end(e); });
  }

  function bindFxKeys(el, role) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    el.addEventListener('keydown', (e) => {
      const d = step[e.key];
      if (!d) return;
      e.preventDefault();
      const p = db.formation.pos[role.id];
      db.formation.pos[role.id] = { x: fxClamp(p.x + d[0] * FX_SNAP), y: fxClamp(p.y + d[1] * FX_SNAP) };
      db.formation.preset = 'custom';
      db.formation.name = ''; // 方向键微调同样视为手动改动
      save();
      cloudPushFormation();
      renderTactics();
      fxShowCoord(db.formation.pos[role.id]);
      setTimeout(() => { const c = $('#fxCoord'); if (c) c.classList.remove('on'); }, 900);
    });
  }
