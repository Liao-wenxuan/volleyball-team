/* ============================================================
 * players —— 人员管理 / 队员表单 / 抽屉 / 批量导入名单 / 从表格导入（收集表 xlsx/csv/粘贴），按姓名合并，支持性别列
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 人员管理 ══════════ */
  function renderRoster() {
    const q = state.rosterSearch.trim().toLowerCase();
    const list = db.players.filter((p) => {
      const okRole = state.rosterFilter === '全部' || p.position === state.rosterFilter;
      const okQ = !q || p.name.toLowerCase().includes(q) || String(p.number).includes(q);
      return okRole && okQ;
    });

    $('#rsCount').textContent = db.players.length;
    const avgH = db.players.length ? (db.players.reduce((a, p) => a + p.height, 0) / db.players.length).toFixed(1) : '—';
    $('#rsHeight').textContent = avgH;
    const avg = teamAverage();
    $('#rsAvg').textContent = avg == null ? '—' : avg.toFixed(1);
    $('#rsCoverage').textContent = `${new Set(db.players.map((p) => p.position)).size} / 5`;
    $('#rosterSub').textContent = db.players.length
      ? `${db.players.length} 名队员 · 平均身高 ${avgH}cm · 平均技能 ${avg.toFixed(1)} 分`
      : '还没有队员。从添加第一名队员开始。';

    $$('#roleFilters .chip').forEach((chip) => {
      const role = chip.dataset.role;
      const n = role === '全部' ? db.players.length : db.players.filter((p) => p.position === role).length;
      const i = chip.querySelector('i');
      if (i) i.textContent = n;
      chip.classList.toggle('active', chip.dataset.role === state.rosterFilter);
    });

    const grid = $('#rosterGrid');
    grid.innerHTML = list.map((p, i) => playerCardHTML(p, i)).join('');
    grid.hidden = list.length === 0;
    const empty = $('#rosterEmpty');
    if (list.length) empty.innerHTML = '';
    else if (!db.players.length) empty.innerHTML = emptyState('🏐', '还没有队员', '收集表导出的 xlsx 直接一键导入；也可以粘贴接龙文本，或一个个填。', '<button class="btn btn-primary" data-action="sheet-import">从表格导入</button><button class="btn btn-ghost" data-action="bulk-import">粘贴接龙文本</button><button class="btn btn-ghost" data-action="add-player">添加第一名队员</button>');
    else empty.innerHTML = emptyState('🔍', '没有匹配的队员', '换个关键词或位置筛选试试。', '<button class="btn btn-ghost" data-action="clear-filter">清除筛选</button>');

    attachTilt(grid);
    renderSidebar();
  }

  function playerCardHTML(p, i) {
    const [a, b] = positionStyle(p.position);
    const ov = overall(p);
    const strip = SKILLS.map((s) => {
      const v = Number(p.skills[s.key] || 0);
      return `<i style="background:${a};opacity:${(0.15 + (v / 10) * 0.85).toFixed(2)}" title="${s.label} ${v.toFixed(1)}"></i>`;
    }).join('');
    return `<article class="player-card card-spot" data-id="${p.id}" style="--a:${a};--b:${b};--i:${i};--ov:${ov}">
      <div class="pc-top"><div class="pc-avatar">${esc(p.name[0] || '?')}</div><div class="pc-num">${pad2(p.number)}</div></div>
      <div class="pc-info"><h3 class="pc-name">${esc(p.name)}${p.gender ? `<i class="pc-g g${p.gender === "男" ? "m" : "f"}">${p.gender === "男" ? "♂" : "♀"}</i>` : ""}</h3><div class="pc-meta">${p.position} · ${p.grade} · ${p.height ? p.height + "cm" : "身高—"}</div></div>
      <div class="pc-score-row">
        <div class="pc-overall"><b>${ov.toFixed(1)}</b><span>综合</span></div>
        <div class="pc-strip">${strip}</div>
      </div>
      <div class="pc-foot"><span class="pc-state">6 项技能 · ${relTime(p.updatedAt)}</span><span class="pc-open">查看档案 →</span></div>
    </article>`;
  }

  function attachTilt(root) {
    $$('.player-card', root).forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', `${((0.5 - py) * 5).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ══════════ 队员表单 / 抽屉 ══════════ */
  function skillInputsHTML(values) {
    return `<div class="skill-form">${SKILLS.map((s) => {
      const v = values ? Number(values[s.key] || 0) : 5;
      return `<label class="skill-field"><span>${s.label}</span><input name="skill_${s.key}" type="number" min="0" max="10" step="0.5" value="${v.toFixed(1)}"></label>`;
    }).join('')}</div>`;
  }

  function openPlayerForm(playerId, opts) {
    const o = opts || {};
    const p = playerId ? getPlayer(playerId) : null;
    if (playerId && !p) return;
    const title = p ? `编辑 ${p.name}` : '新增队员';
    const body = `<form id="playerForm">
      <div class="form-grid">
        <div class="field"><label>姓名</label><input name="name" required maxlength="10" value="${p ? esc(p.name) : ''}" placeholder="例如：陈子昂"></div>
        <div class="field"><label>号码</label><input name="number" type="number" min="0" max="99" required value="${p ? p.number : ''}" placeholder="7"></div>
        <div class="field"><label>位置</label><select name="position">${POSITIONS.map((pos) => `<option ${((p && p.position) || o.position) === pos ? 'selected' : ''}>${pos}</option>`).join('')}</select></div>
        <div class="field"><label>性别</label><select name="gender">${[['', '没填'], ['女', '女 ♀'], ['男', '男 ♂']].map(([v, t]) => `<option value="${v}" ${(p && p.gender) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>年级</label><select name="grade">${GRADES.map((g) => `<option ${p && p.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field full"><label>身高 (cm)</label><input name="height" type="number" min="140" max="230" required value="${p ? p.height : ''}" placeholder="185"></div>
      </div>
      <div class="form-note">号码只要求<b>同一个性别里不重复</b>——男队和女队可以穿同一个号（比如男生 4 号、女生也 4 号）。</div>
      ${p ? `<div class="form-note">技能点在成长计划里调整，编辑资料不会改动技能。</div>`
        : `<div class="form-section-title"><span>初始技能点</span><button type="button" class="btn-mini" id="fillFive">全部 5.0</button></div>${skillInputsHTML(null)}<div class="form-note">0–10 分，步进 0.5。之后每次训练或比赛后到成长页加减。</div>`}
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="submit" class="btn btn-primary">${p ? '保存资料' : '加入球队'}</button></div>
    </form>`;
    openModal(title, body, { mid: !p });
    const form = $('#playerForm');
    if (!p) {
      $('#fillFive').onclick = () => {
        SKILLS.forEach((s) => { const input = form.querySelector(`[name="skill_${s.key}"]`); if (input) input.value = '5.0'; });
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      const number = Number(fd.get('number'));
      const height = Number(fd.get('height'));
      const gender = String(fd.get('gender') || '');
      if (!name) { toast('姓名不能为空', 'warn'); return; }
      if (!Number.isInteger(number) || number < 0 || number > 99) { toast('号码需要 0–99 的整数', 'warn'); return; }
      if (!height || height < 140 || height > 230) { toast('身高需要在 140–230cm 之间', 'warn'); return; }
      // 号码只在同性别内唯一：男队女队分头排号，可以撞号
      const dup = db.players.find((x) => x.number === number && (x.gender || '') === gender && x.id !== (p && p.id));
      if (dup) {
        toast(gender
          ? `${gender}队里 ${number} 号已经是 ${dup.name} 了，换一个号`
          : `${number} 号已经被 ${dup.name} 用了——填上性别就能和异性同号`, 'warn');
        return;
      }
      if (p) {
        const payload = { name, number, height, position: String(fd.get('position')), grade: String(fd.get('grade')), gender };
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.playerUpdate(p.id, payload);
            Object.assign(p, normalizePlayer(resp.player));
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          Object.assign(p, payload);
          p.updatedAt = Date.now();
        }
        save(); closeModal(); renderRoster(); renderDashboard();
        if ($('#drawer').classList.contains('open')) openPlayer(p.id);
        toast('队员资料已更新');
      } else {
        const skills = {};
        SKILLS.forEach((s) => {
          const v = Number(fd.get(`skill_${s.key}`));
          skills[s.key] = clamp(roundHalf(Number.isFinite(v) ? v : 5), 0, 10);
        });
        const payload = { name, number, height, position: String(fd.get('position')), grade: String(fd.get('grade')), gender, skills };
        let np;
        if (CloudOn()) {
          try {
            const resp = await window.XGYCloud.push.playerCreate(payload);
            np = normalizePlayer(resp.player);
          } catch (err) { toast(`保存失败：${err.message}`, 'warn'); return; }
        } else {
          np = normalizePlayer({ id: uid('p'), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
        }
        db.players.push(np);
        save(); closeModal(); renderRoster(); renderDashboard(); renderSidebar(); renderActivity();
        if (state.page !== 'roster') go('roster');
        toast(`${np.name} 已加入球队`);
        setTimeout(() => openPlayer(np.id), 260);
      }
    };
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* 走兜底 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ══════════ 批量导入名单 ══════════ */
  const IMPORT_FIELDS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '名字', '队员', 'name'] },
    { key: 'number', label: '号码', aliases: ['号码', '球衣号', '号', 'number'] },
    { key: 'position', label: '位置', aliases: ['位置', '场上位置', '司职', 'position'] },
    { key: 'grade', label: '年级', aliases: ['年级', '年级/班级', 'grade'] },
    { key: 'height', label: '身高', aliases: ['身高', '身高(cm)', '身高cm', 'height'] },
    { key: 'gender', label: '性别', aliases: ['性别', '男女', 'gender'] }
  ];

  function splitRow(line) {
    let cells = line.split('\t');
    if (cells.length < 2) cells = line.split(/[,，]/);
    if (cells.length < 2) cells = line.split(/[|｜]/);
    if (cells.length < 2) cells = line.split(/\s{2,}/);
    if (cells.length < 2) cells = line.trim().split(/\s+/);
    return cells.map((c) => String(c).trim()).filter((c, i, a) => !(c === '' && i === a.length - 1));
  }

  function normalizeImportPosition(raw) {
    const s = String(raw || '');
    if (s.includes('接应')) return '接应';
    if (s.includes('二传')) return '二传';
    if (s.includes('副攻')) return '副攻';
    if (s.includes('主攻')) return '主攻';
    if (s.includes('自由') || /^(l|lib)$/i.test(s)) return '自由人';
    return '';
  }

  function normalizeImportGrade(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const hit = GRADES.find((g) => s.includes(g));
    if (hit) return hit;
    const m = s.match(/([一二三四1-4])年级?/);
    if (m) {
      const map = { 一: '大一', 二: '大二', 三: '大三', 四: '大四', 1: '大一', 2: '大二', 3: '大三', 4: '大四' };
      return map[m[1]] || '';
    }
    const y = s.match(/研([一二三1-3])/);
    if (y) {
      const map = { 一: '研一', 二: '研二', 三: '研三', 1: '研一', 2: '研二', 3: '研三' };
      return map[y[1]] || '';
    }
    return s.slice(0, 8);
  }

  function normalizeImportNumber(raw) {
    const s = String(raw || '').replace(/[号#]/g, '').replace(/^no\.?/i, '').trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }

  function normalizeImportHeight(raw) {
    const s = String(raw || '').toLowerCase().replace(/cm|厘米|公分/g, '').trim();
    if (!s) return NaN;
    let n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    if (n > 0 && n < 3) n = n * 100; // 1.88 这种写法
    return Math.round(n);
  }

  /** 把粘贴进来的一段文本解析成待导入行，含每行的问题标注 */
  function parseRosterText(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { rows: [], header: false };

    // 表头识别：单字别名（如「号」）必须完全相等，避免把「5号」这种数据行当表头
    const matchField = (cell) => IMPORT_FIELDS.find((f) => f.aliases.some((a) => cell === a || (a.length >= 2 && cell.includes(a))));
    const first = splitRow(lines[0]).map((c) => c.toLowerCase());
    const firstHits = first.map(matchField).filter(Boolean);
    const header = new Set(firstHits.map((f) => f.key)).size >= 2;
    const cols = {};
    if (header) {
      first.forEach((c, i) => {
        const f = matchField(c);
        if (f && cols[f.key] === undefined) cols[f.key] = i;
      });
    } else {
      IMPORT_FIELDS.forEach((f, i) => { cols[f.key] = i; });
    }

    // 号码查重也按性别分队：同一号码男队女队各一件，不算撞号
    const used = new Map(); // 号码 -> 穿过这个号的性别集合
    db.players.forEach((p) => {
      const set = used.get(p.number) || new Set();
      set.add(p.gender || '');
      used.set(p.number, set);
    });
    const rows = [];
    lines.slice(header ? 1 : 0).forEach((rawLine) => {
      // 接龙里的序号：「1. 张三 …」「2、张三 …」，整行层面先剥掉
      const line = rawLine.replace(/^\s*\d{1,2}\s*[.、)．:：]\s*/, '');
      let cells = splitRow(line);
      // 剥不干净时（如「1.」独立成列）再按列丢一次
      if (cells.length >= 4 && /^\d{1,2}\s*[.、)．:：]$/.test(cells[0])) cells = cells.slice(1);
      const pick = (k) => (cols[k] === undefined ? '' : (cells[cols[k]] || ''));
      const raw = {
        name: String(pick('name') || '').trim().slice(0, 10),
        number: normalizeImportNumber(pick('number')),
        position: normalizeImportPosition(pick('position')),
        grade: normalizeImportGrade(pick('grade')),
        height: normalizeImportHeight(pick('height')),
        gender: siGender(pick('gender'))
      };
      const issues = [];
      if (!raw.name) issues.push({ level: 'err', text: '缺姓名' });
      if (!Number.isFinite(raw.number) || raw.number < 0 || raw.number > 99) issues.push({ level: 'err', text: '号码无效' });
      else {
        const holders = used.get(raw.number);
        if (holders && holders.has(raw.gender)) {
          issues.push({ level: 'err', text: `号码 ${raw.number} 重复` + (raw.gender ? `（${raw.gender}队内）` : '') });
        } else if (holders && !raw.gender && holders.size) {
          // 这行没写性别，而号码已被 (可能的) 异性占用——可能是合法的男女同号，交给队长判断
          const who = [...holders].filter(Boolean).join('/') || '性别未填的人';
          issues.push({ level: 'warn', text: `${raw.number} 号已被${who}占用，同性则需换号` });
        }
      }
      if (!Number.isFinite(raw.height) || raw.height < 140 || raw.height > 230) issues.push({ level: 'err', text: '身高异常' });
      if (!raw.position) { raw.position = '主攻'; issues.push({ level: 'warn', text: '位置未知，按主攻' }); }
      if (!raw.grade) { raw.grade = '大一'; issues.push({ level: 'warn', text: '年级未知，按大一' }); }
      if (Number.isFinite(raw.number)) {
        const set = used.get(raw.number) || new Set();
        set.add(raw.gender);
        used.set(raw.number, set);
      }
      rows.push({ raw, issues, on: issues.every((i) => i.level !== 'err') });
    });
    return { rows, header };
  }

  function openBulkImport() {
    const sample = '姓名\t号码\t位置\t年级\t身高\t性别\n张辰\t1\t主攻\t大三\t188\t男\n乔奕博\t4\t副攻\t大二\t175\t男\n张佳\t4\t主攻\t大二\t161\t女';
    const body = `<div class="import-wrap">
      <div class="import-help">
        从 Excel / 腾讯文档 / 金山表格整块复制，直接粘贴进来就行；也认逗号、空格分隔的接龙文本（如 <code>1. 张辰 1号 主攻 大三 188</code>）。
        带表头会自动识别列，没表头按 <b>姓名 号码 位置 年级 身高 性别</b> 顺序读（性别可以不填）。<br>
        号码只查<b>同性别</b>的重复：男队和女队可以穿同一个号。
      </div>
      <textarea id="importText" class="import-input" rows="7" spellcheck="false" placeholder="姓名	号码	位置	年级	身高	性别
张辰	1	主攻	大三	188	男
张佳	1	主攻	大二	178	女"></textarea>
      <div class="import-actions-row">
        <button type="button" class="btn-mini" id="importTpl">复制收集模板</button>
        <button type="button" class="btn-mini" id="importSample">填入示例</button>
        <button type="button" class="btn-mini" id="importClear">清空</button>
        <span class="import-hint" id="importHint"></span>
      </div>
      <div id="importPreview" class="import-preview"></div>
      <div class="form-foot"><button type="button" class="btn btn-ghost" data-close-modal>取消</button><button type="button" class="btn btn-primary" id="importGo" disabled>导入</button></div>
    </div>`;
    openModal('批量导入队员', body, { wide: true });

    const ta = $('#importText');
    const preview = $('#importPreview');
    const go = $('#importGo');
    const hint = $('#importHint');
    let parsed = { rows: [], header: false };

    function repaint() {
      parsed = parseRosterText(ta.value);
      const ok = parsed.rows.filter((r) => r.on).length;
      const bad = parsed.rows.length - ok;
      hint.textContent = parsed.rows.length
        ? `识别到 ${parsed.rows.length} 行 · 可导入 ${ok} 行${bad ? ` · ${bad} 行有问题` : ''}`
        : '';
      go.disabled = ok === 0;
      if (!parsed.rows.length) { preview.innerHTML = ''; return; }
      preview.innerHTML = `<div class="ip-head">
          <span>共 ${parsed.rows.length} 行${parsed.header ? '（已识别表头）' : ''}</span>
          <button type="button" class="btn-mini" id="importToggle">反选可导入行</button>
        </div>
        <div class="ip-table">
        ${parsed.rows.map((r, i) => `<div class="ip-row${r.on ? '' : ' off'}">
            <label class="ip-check"><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} ${r.issues.some((x) => x.level === 'err') ? 'disabled' : ''}></label>
            <span class="ip-num">${Number.isFinite(r.raw.number) ? pad2(r.raw.number) : '—'}</span>
            <span class="ip-name">${esc(r.raw.name || '（无名）')}${r.raw.gender ? `<i class="pc-g ${r.raw.gender === '男' ? 'gm' : 'gf'}">${r.raw.gender === '男' ? '♂' : '♀'}</i>` : ''}</span>
            <span class="ip-pos">${esc(r.raw.position)}</span>
            <span class="ip-grade">${esc(r.raw.grade)}</span>
            <span class="ip-h">${Number.isFinite(r.raw.height) ? r.raw.height + 'cm' : '—'}</span>
            <span class="ip-issue">${r.issues.map((x) => `<i class="ip-tag ${x.level}">${esc(x.text)}</i>`).join('')}</span>
          </div>`).join('')}
        </div>`;
      const toggle = $('#importToggle');
      if (toggle) toggle.onclick = () => {
        parsed.rows.forEach((r) => { if (r.issues.every((x) => x.level !== 'err')) r.on = !r.on; });
        preview.querySelectorAll('.ip-check input').forEach((cb) => {
          const r = parsed.rows[Number(cb.dataset.i)];
          cb.checked = r.on;
          cb.closest('.ip-row').classList.toggle('off', !r.on);
        });
        go.disabled = parsed.rows.filter((r) => r.on).length === 0;
      };
      preview.querySelectorAll('.ip-check input').forEach((cb) => {
        cb.onchange = () => {
          const r = parsed.rows[Number(cb.dataset.i)];
          r.on = cb.checked;
          cb.closest('.ip-row').classList.toggle('off', !r.on);
          go.disabled = parsed.rows.filter((x) => x.on).length === 0;
        };
      });
    }

    ta.addEventListener('input', repaint);
    ta.addEventListener('paste', () => setTimeout(repaint, 0));
    $('#importTpl').onclick = () => {
      const tpl = '姓名\t号码\t位置\t年级\t身高\t性别\n'
        + '（每个人复制上一行，改成自己的，接在下面，别删第一行；性别填男/女，不填也行）\n\n'
        + '位置填：主攻 / 副攻 / 二传 / 接应 / 自由人\n';
      copyText(tpl) ? toast('收集模板已复制，发到群里让大家接龙')
        : toast('复制失败，手动选中模板文字复制', 'warn');
    };
    $('#importSample').onclick = () => { ta.value = sample; repaint(); ta.focus(); };
    $('#importClear').onclick = () => { ta.value = ''; repaint(); ta.focus(); };

    go.onclick = async () => {
      const picked = parsed.rows.filter((r) => r.on);
      if (!picked.length) return;
      const cloud = CloudOn();
      go.disabled = true;
      let done = 0;
      let failed = 0;
      for (const r of picked) {
        const payload = {
          name: r.raw.name, number: r.raw.number, position: r.raw.position,
          grade: r.raw.grade, height: r.raw.height, gender: r.raw.gender || '',
          skills: SKILLS.reduce((o, s) => { o[s.key] = 5; return o; }, {})
        };
        try {
          const np = cloud
            ? normalizePlayer((await window.XGYCloud.push.playerCreate(payload)).player)
            : normalizePlayer({ id: uid('p'), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
          db.players.push(np);
          done += 1;
        } catch (err) { failed += 1; }
      }
      save(); closeModal(); renderRoster(); renderDashboard(); renderSidebar(); renderActivity();
      if (state.page !== 'roster') go('roster');
      toast(failed ? `导入 ${done} 人，${failed} 人失败` : `已导入 ${done} 名队员`);
    };
    repaint();
    ta.focus();
  }

  /* ══════════ 从表格导入（收集表 xlsx/csv/粘贴），按姓名合并，支持性别列 ══════════
     收集表是腾讯文档导出的 xlsx，列名带「（必填）（自动）」后缀；队友填的东西很野：
     身高带 cm、号码写「无」、男女混编还有重号——全部在这里清洗，别指望队友。 */
  const SI_COL = {
    name: /姓名|名字/,
    number: /号码|球衣|球服/,
    position: /位置/,
    grade: /年级/,
    height: /身高/,
    gender: /性别|男女/
  };
  function siNum(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || /^(无|暂无|待定|-|—|\/)$/.test(s)) return 0;
    const m = /(\d{1,2})/.exec(s);
    return m ? Number(m[1]) : 0;
  }
  function siHeight(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return 0;
    const m = /([\d.]+)/.exec(s);
    if (!m) return 0;
    let n = Number(m[1]);
    if (n > 0 && n < 3) n = Math.round(n * 100); // 「1.68」按米读
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  function siGender(v) {
    const s = String(v || '').trim();
    if (/^(m|male|boy|♂)$/i.test(s)) return '男';
    if (/^(f|female|girl|♀)$/i.test(s)) return '女';
    return /男/.test(s) ? '男' : /女/.test(s) ? '女' : '';
  }
  function siParseCSVLine(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function siTextRows(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (!lines.length) return [];
    const sep = lines[0].includes('\t') ? '\t' : ',';
    return lines.map((l) => (sep === '\t' ? l.split('\t') : siParseCSVLine(l)).map((c) => c.trim()));
  }
  function siMapHeader(row) {
    const map = {};
    (row || []).forEach((h, i) => {
      const s = String(h || '');
      Object.keys(SI_COL).forEach((k) => { if (map[k] === undefined && SI_COL[k].test(s)) map[k] = i; });
    });
    return map;
  }
  // rows（二维数组）→ 清洗后的队员列表 + 警告
  function siExtract(rows) {
    if (!rows.length) throw new Error('表格是空的');
    const header = siMapHeader(rows[0]);
    if (header.name === undefined) throw new Error('第一行没认出「姓名」列——确认导出的是收集表原样，别删表头');
    const warns = [];
    const out = [];
    rows.slice(1).forEach((row, idx) => {
      const name = String(row[header.name] || '').trim();
      if (!name) return;
      const lineNo = idx + 2;
      const item = {
        name: name.slice(0, 10),
        number: header.number !== undefined ? siNum(row[header.number]) : 0,
        position: header.position !== undefined ? String(row[header.position] || '').trim() : '',
        grade: header.grade !== undefined ? String(row[header.grade] || '').trim() : '',
        height: header.height !== undefined ? siHeight(row[header.height]) : 0,
        gender: header.gender !== undefined ? siGender(row[header.gender]) : ''
      };
      const posHit = POSITIONS.find((p) => item.position.includes(p));
      if (posHit) item.position = posHit;
      else {
        if (item.position) warns.push(`第 ${lineNo} 行：${item.name} 的位置「${item.position}」没认出来，先按主攻记`);
        item.position = '主攻';
      }
      const gradeHit = GRADES.find((g) => item.grade.includes(g));
      if (gradeHit) item.grade = gradeHit;
      else {
        if (item.grade) warns.push(`第 ${lineNo} 行：${item.name} 的年级「${item.grade}」没认出来，先按大一记`);
        item.grade = '大一';
      }
      if (!item.number) warns.push(`第 ${lineNo} 行：${item.name} 没填号码，先按 0 记（还没领球衣的话之后补）`);
      if (!item.height) warns.push(`第 ${lineNo} 行：${item.name} 没填身高`);
      out.push(item);
    });
    if (!out.length) throw new Error('表格里没读出任何队员（姓名列全是空的？）');
    return { players: out, warns };
  }
  /* 号码查重只查「同性别」：男队女队分头排号，男 4 号和女 4 号是两件球衣。
     性别没填的人先归到「未填」这一组里互相查，所以补完性别警告会自己消失。 */
  function siDupWarns(list) {
    const seen = new Map();
    const out = [];
    list.forEach((item) => {
      if (!item.number) return;
      const key = `${item.number}|${item.gender || ''}`;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, item.name); return; }
      out.push(item.gender
        ? `${item.number} 号在${item.gender}队里重了：${prev} 和 ${item.name}——同性别不能同号，到人员页改一个`
        : `${item.number} 号撞了：${prev} 和 ${item.name}（两边性别都没填，先按同队算）——点出性别就能各穿各的`);
    });
    return out;
  }
  /* 表里的人要「新增」时，跟库里已有的同性别队员撞号也要提醒（异性撞号不管）。
     人多时合成一条，别让警告区刷成一面墙。 */
  function siNewConflicts(plan) {
    const hits = [];
    plan.forEach((row) => {
      if (row.target) return;
      const it = row.item;
      if (!it.number) return;
      const hit = db.players.find((p) => p.number === it.number && (p.gender || '') === (it.gender || ''));
      if (hit) hits.push(`${it.number} 号 ${it.name}↔${hit.name}`);
    });
    if (!hits.length) return [];
    return [`有 ${hits.length} 人和库里队员撞号（同性别才算冲突）：${hits.join('、')}——改号，或给两边点出性别`];
  }
  // 性别显示与切换（男女混编，收集表里没这列就当场点）
  const siGenderNext = (g) => (g === '女' ? '男' : g === '男' ? '' : '女');
  const siGenderLabel = (g) => (g === '女' ? '♀ 女' : g === '男' ? '♂ 男' : '· 未填');

  function openSheetImport() {
    const app = inAppBrowser();
    const fileCls = app ? 'btn-ghost' : 'btn-primary'; // 内置浏览器里把「粘贴」推到主位
    const pasteCls = app ? 'btn-primary' : 'btn-ghost';
    openModal('从表格导入队员', `<div class="imp-wrap">
      ${app ? `<p class="imp-alert"><b>${app}里选不了文件。</b>点按钮会有反应、选择器就是不弹——这是${app}内核没这个能力，不是页面坏了。<br>
        ① 用下面的<b>粘贴表格内容</b>；② 或者复制链接，到系统浏览器（Chrome / Edge / 夸克）里打开再选。</p>` : ''}
      <p class="imp-lead">直接选收集表导出的 <b>xlsx</b>；微信里打不开的话，用腾讯文档 / WPS 打开、<b>全选复制</b>，粘到下面也一样。</p>
      <div class="imp-choice">
        ${fileHitHTML('sheetFile', '选择表格文件（.xlsx / .csv）', fileCls)}
        <button type="button" class="btn ${pasteCls}" id="siPaste">粘贴表格内容</button>
        ${app ? '<button type="button" class="btn btn-ghost" id="siCopyLink">复制本页链接（到浏览器打开）</button>' : ''}
      </div>
      <p class="imp-hint" id="fileStuck" hidden>点了没弹出文件选择器？<b id="fileRetry">换一种方式打开</b>；或者把表格先另存到平板的「下载 / 文档」目录再来选。<br>
      还有一条最稳的：<b id="fileCopyLink">复制本页链接</b>，用 Chrome / Edge 打开导入——数据存在同一个地方，回到这个 App 就能看到。</p>
      <p class="imp-note">按「姓名」认人：表里的人会更新资料，新名字会加进来，没出现的人不动。考勤和技能记录不碰。<br>
      号码只在<b>同性别</b>里查重，男队女队可以穿同一个号。收集表里没有性别列也没关系，下一步可以逐个点。</p>
    </div>`, { mid: true });
    bindFileHit('sheetFile', handleSheetFile, 'fileStuck');
    bindCopyLink();
    if ($('#siPaste')) $('#siPaste').onclick = () => openSheetPaste();
  }

  function openSheetPaste() {
    openModal('粘贴表格内容', `<div class="imp-wrap">
      <p class="imp-lead">在腾讯文档 / WPS / Excel 里<b>全选复制</b>（连表头一起），粘到这里。认 tab、逗号两种分隔。</p>
      <textarea class="imp-ta" id="siText" rows="8" placeholder="姓名（必填）	球服号码（必填）	位置（必填）	年级（必填）	身高（必填）&#10;张辰	1	主攻	大三	188"></textarea>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="siClip">读剪贴板</button>
        <button type="button" class="btn btn-primary" id="siGo">解析并预览</button>
        <button type="button" class="btn btn-ghost" id="siCancel">取消</button>
      </div>
    </div>`, { mid: true });
    const ta = $('#siText');
    $('#siCancel').onclick = closeModal;
    /* 粘完自动解析：从腾讯文档复制过来就该直接看见预览，不用再点一次「解析并预览」 */
    const tryGo = (auto) => {
      let rows;
      try { rows = siTextRows(ta.value); }
      catch (e) { if (!auto) toast(e && e.message ? e.message : '解析失败', 'warn'); return false; }
      if (rows.length < 2) { if (!auto) toast('至少要有表头 + 一行数据', 'warn'); return false; }
      try { openSheetPreview(siExtract(rows)); return true; }
      catch (e) { if (!auto) toast(e && e.message ? e.message : '解析失败', 'warn'); return false; }
    };
    $('#siClip').onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('剪贴板是空的', 'warn'); return; }
        ta.value = t;
        if (!tryGo(true)) toast('已从剪贴板读入，点「解析并预览」看看');
      } catch (e) { toast('读不了剪贴板，长按输入框手动粘贴', 'warn'); }
    };
    $('#siGo').onclick = () => tryGo(false);
    ta.addEventListener('paste', () => setTimeout(() => tryGo(true), 60));
    setTimeout(() => ta.focus(), 60);
  }

  function openSheetPreview(extracted) {
    const list = extracted.players;
    const plan = list.map((item) => {
      const same = db.players.filter((p) => p.name === item.name);
      let target = null;
      if (same.length === 1) target = same[0];
      else if (same.length > 1) {
        // 同名不止一个（男女两队都可能有人重名）：先看号码，再拿性别对齐
        target = same.find((p) => item.number && p.number === item.number && (!item.gender || !p.gender || p.gender === item.gender))
          || same.find((p) => item.number && p.number === item.number)
          || same.find((p) => item.gender && p.gender === item.gender)
          || null;
      }
      return { item, target: target ? target.id : null };
    });
    const upd = plan.filter((r) => r.target).length;
    const add = plan.length - upd;
    const kept = db.players.length - upd;
    const body = `<div class="imp-wrap">
      <p class="imp-lead">来源表格里读出 <b>${plan.length}</b> 人：<b>更新 ${upd}</b> · 新增 ${add} · 本机另有 ${kept} 人不在这个表里（保留不动）。</p>
      <div class="si-warns" id="siWarns" hidden></div>
      <div class="si-table">
        <div class="si-tr si-th"><span>姓名</span><span>号码</span><span>位置</span><span>年级</span><span>身高</span><span>性别</span><span>动作</span></div>
        ${plan.map((r, i) => `
          <div class="si-tr">
            <span><b>${esc(r.item.name)}</b></span>
            <span>${r.item.number || '—'}</span>
            <span>${r.item.position}</span>
            <span>${r.item.grade}</span>
            <span>${r.item.height || '—'}</span>
            <span><button type="button" class="si-g g${r.item.gender === '男' ? 'm' : r.item.gender === '女' ? 'f' : ''}" data-i="${i}">${siGenderLabel(r.item.gender)}</button></span>
            <span class="si-act ${r.target ? 'up' : 'ad'}">${r.target ? `更新 ${esc((getPlayer(r.target) || {}).name || '')}` : '新增'}</span>
          </div>`).join('')}
      </div>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="siBack">上一步</button>
        <button type="button" class="btn btn-primary" id="siCommit">确认导入（更新 ${upd} · 新增 ${add}）</button>
      </div>
    </div>`;
    openModal('确认导入', body, { wide: true });
    const paintWarns = () => {
      const all = extracted.warns.concat(siDupWarns(list), siNewConflicts(plan));
      const box = $('#siWarns');
      if (!box) return;
      box.innerHTML = all.map((w) => `<p>⚠ ${esc(w)}</p>`).join('');
      box.hidden = all.length === 0;
    };
    paintWarns();
    $$('.si-g').forEach((btn) => {
      btn.onclick = () => {
        const r = plan[Number(btn.dataset.i)];
        r.item.gender = siGenderNext(r.item.gender);
        btn.textContent = siGenderLabel(r.item.gender);
        btn.className = `si-g g${r.item.gender === '男' ? 'm' : r.item.gender === '女' ? 'f' : ''}`;
        paintWarns(); // 补完性别，同号但不同队的警告会自己消掉
      };
    });
    $('#siBack').onclick = () => openSheetImport();
    $('#siCommit').onclick = async () => {
      const cloud = CloudOn();
      const btn = $('#siCommit');
      btn.disabled = true;
      let done = 0, failed = 0, nUp = 0, nAdd = 0;
      for (const row of plan) {
        const it = row.item;
        try {
          if (row.target) {
            const p = getPlayer(row.target);
            const payload = {
              name: it.name,
              number: it.number || p.number,
              position: it.position,
              grade: it.grade,
              height: it.height || p.height,
              gender: it.gender || p.gender
            };
            if (cloud) Object.assign(p, normalizePlayer((await window.XGYCloud.push.playerUpdate(p.id, payload)).player));
            else { Object.assign(p, payload); p.updatedAt = Date.now(); }
            nUp += 1;
          } else {
            const payload = {
              name: it.name, number: it.number, position: it.position, grade: it.grade,
              height: it.height, gender: it.gender,
              skills: SKILLS.reduce((o, s) => { o[s.key] = 5; return o; }, {})
            };
            const np = cloud
              ? normalizePlayer((await window.XGYCloud.push.playerCreate(payload)).player)
              : normalizePlayer({ id: uid('p'), ...payload, createdAt: Date.now(), updatedAt: Date.now() });
            db.players.push(np);
            nAdd += 1;
          }
          done += 1;
        } catch (err) { failed += 1; }
      }
      save(); closeModal(); renderRoster(); renderDashboard(); renderSidebar(); renderActivity();
      if (state.page !== 'roster') go('roster');
      toast(failed ? `完成 ${done} 人，${failed} 人失败` : `已更新 ${nUp} 人、新增 ${nAdd} 人，技能和考勤没动`);
    };
  }

  async function handleSheetFile(file) {
    if (!file) return;
    const name = file.name || '表格';
    try {
      let rows;
      if (/\.csv$/i.test(name)) {
        rows = siTextRows(await file.text());
      } else {
        await ensureMod('xlsx');
        const wb = await window.XGYXlsx.read(await file.arrayBuffer());
        // 多个子表时选数据最多的那个（收集表通常只有一个）
        const sh = wb.sheets.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
        rows = sh.rows;
      }
      openSheetPreview(siExtract(rows));
    } catch (e) {
      toast(e && e.message ? `${name}：${e.message}` : `${name} 解析失败`, 'warn');
    }
  }

  function openPlayer(id) {
    const p = getPlayer(id);
    if (!p) return;
    const [a, b] = positionStyle(p.position);
    const logs = db.skillLogs.filter((l) => l.playerId === p.id).sort((x, y) => y.at - x.at).slice(0, 20);
    const best = SKILLS.slice().sort((s1, s2) => Number(p.skills[s2.key]) - Number(p.skills[s1.key]))[0];
    const stats = weekStats(getMonday(new Date()));
    const me = stats.perPlayer.get(p.id) || { present: 0, late: 0, leave: 0, absent: 0, marked: 0 };
    $('#drawerBody').innerHTML = `
      <div class="dr-hero">
        <span class="dr-num">${pad2(p.number)}</span>
        <div class="dr-top">
          <span class="u-avatar" style="--a:${a};--b:${b}">${esc(p.name[0] || '?')}</span>
          <div>
            <h3>${esc(p.name)}</h3>
            <p>${p.position} · ${p.grade}${p.gender ? " · " + p.gender : ""} · ${p.height ? p.height + "cm" : "身高—"}</p>
            <div class="dr-tags"><span class="dr-tag v">${p.position}</span><span class="dr-tag">${p.number} 号</span><span class="dr-tag">${overall(p).toFixed(1)} 分</span></div>
          </div>
        </div>
      </div>
      <div class="dr-stats">
        <div class="dr-stat"><b>${overall(p).toFixed(1)}</b><span>综合评分</span></div>
        <div class="dr-stat"><b>${skillLabel(best.key)}</b><span>最强项 ${Number(p.skills[best.key]).toFixed(1)}</span></div>
        <div class="dr-stat"><b>${me.marked ? Math.round(((me.present + me.late) / me.marked) * 100) + '%' : '—'}</b><span>本周出勤</span></div>
      </div>
      <div class="dr-section"><h4>能力雷达</h4><div class="radar-box">${radarSVG10(SKILLS.map((s) => Number(p.skills[s.key])), 230)}</div></div>
      <div class="dr-section"><h4>技术细项</h4><div class="dr-skill">${SKILLS.map((s) => `<div class="skill-item"><span>${s.label}</span><div class="skill-bar"><i style="width:${Number(p.skills[s.key]) * 10}%"></i></div><b>${Number(p.skills[s.key]).toFixed(1)}</b></div>`).join('')}</div></div>
      <div class="dr-section"><h4>调整记录</h4><div class="log-list">${logs.length ? logs.map((l) => {
        const d = l.date ? parseKey(l.date) : new Date(l.at);
        return `<div class="log-row"><span class="log-date">${fmtMD(d)}</span><span class="log-skill">${skillLabel(l.skill)}</span><span class="log-delta ${l.delta >= 0 ? 'up' : 'down'}">${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}</span><b>${l.after.toFixed(1)}</b><em class="log-source">${sourceLabel(l.source)}</em></div>`;
      }).join('') : '<div class="mini-empty small">还没有调整记录。</div>'}</div></div>
      <div class="dr-actions"><button class="btn btn-ghost" data-action="edit-player" data-player="${p.id}">编辑资料</button><button class="btn btn-danger-ghost" data-action="delete-player" data-player="${p.id}">删除队员</button></div>
      <p class="form-note">删除队员会同时删除他的考勤和技能调整记录。</p>`;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawerScrim').classList.add('show');
    closePopovers();
    syncLock();
  }

  async function deletePlayer(id) {
    const p = getPlayer(id);
    if (!p) return;
    const ok = await confirmDialog({ title: `删除 ${p.name}？`, message: '会同时删除他的全部考勤记录和技能调整记录。这个操作无法撤销。', ok: '确认删除' });
    if (!ok) return;
    if (CloudOn()) {
      try { await window.XGYCloud.push.playerDelete(id); }
      catch (err) { toast(`删除失败：${err.message}`, 'warn'); return; }
    }
    db.players = db.players.filter((x) => x.id !== id);
    Object.keys(db.weeks).forEach((k) => (db.weeks[k] || []).forEach((s) => { if (s.attendance) delete s.attendance[id]; }));
    db.skillLogs = db.skillLogs.filter((l) => l.playerId !== id);
    save();
    closeDrawer();
    renderAllCurrent();
    toast(`${p.name} 已从球队删除`);
  }
