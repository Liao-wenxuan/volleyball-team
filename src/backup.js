/* ============================================================
 * backup —— 导入备份：按队员合并 / 完全覆盖
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 导入备份：按队员合并 / 完全覆盖 ══════════
   * 为什么要有「合并」：电脑录数据、平板登记考勤是常态。
   * 完全覆盖会把平板新增的考勤抹掉；合并按「姓名+号码」认人，
   * 同一个人用备份覆盖，备份里没有的人保留、备份里多的人补上。
   * 号码一方可能没录（0），所以号码没对上时，只有「两边这个名字都唯一」才按姓名认。 */
  function mergeBackup(incoming) {
    const inc = normalizeDB(incoming);
    const noKey = (p) => `${String(p.name).trim()}::${Number(p.number) || 0}`;
    const nmKey = (p) => String(p.name).trim();
    const countName = (list) => list.reduce((m, p) => m.set(nmKey(p), (m.get(nmKey(p)) || 0) + 1), new Map());
    const curNameCount = countName(db.players);
    const incNameCount = countName(inc.players);
    const curByNo = new Map(db.players.map((p) => [noKey(p), p]));

    const idMap = new Map();          // 备份里的队员 id → 本机 id
    const matched = [];
    const added = [];
    const usedIds = new Set(db.players.map((p) => p.id));

    inc.players.forEach((p) => {
      let hit = curByNo.get(noKey(p));
      if (!hit) {
        const nm = nmKey(p);
        if (curNameCount.get(nm) === 1 && incNameCount.get(nm) === 1) {
          hit = db.players.find((x) => nmKey(x) === nm);
        }
      }
      if (hit) {
        idMap.set(p.id, hit.id);
        matched.push({ cur: hit, inc: p });
      } else {
        const nid = p.id && !usedIds.has(p.id) ? p.id : uid('p');
        usedIds.add(nid);
        idMap.set(p.id, nid);
        added.push({ ...p, id: nid });
      }
    });

    const out = clone(db);
    /* 1) 队员：匹配上的用备份覆盖技能/位置/年级/身高；本机独有的原样保留 */
    out.players = db.players.map((p) => {
      const pair = matched.find((m) => m.cur.id === p.id);
      if (!pair) return p;
      return {
        ...p,
        position: pair.inc.position,
        grade: pair.inc.grade,
        height: pair.inc.height,
        skills: pair.inc.skills,
        note: pair.inc.note || p.note || '',
        updatedAt: Math.max(Number(p.updatedAt) || 0, Number(pair.inc.updatedAt) || 0)
      };
    }).concat(added);

    /* 2) 训练：按「日期 + 开始时间」认定同一场，同场用备份的考勤整格覆盖。
          考勤里的队员 id 必须过一遍 idMap，否则两边 id 不同会写出孤儿数据。 */
    let sOver = 0, sAdd = 0;
    const weeks = {};
    const weekKeys = new Set([...Object.keys(db.weeks || {}), ...Object.keys(inc.weeks || {})]);
    [...weekKeys].sort().forEach((k) => {
      const cur = Array.isArray(db.weeks[k]) ? db.weeks[k] : [];
      const incW = Array.isArray(inc.weeks[k]) ? inc.weeks[k] : [];
      const merged = cur.map((s) => ({ ...s, attendance: { ...(s.attendance || {}) } }));
      incW.forEach((is) => {
        const att = {};
        Object.keys(is.attendance || {}).forEach((pid) => {
          const nid = idMap.get(pid);
          if (nid) att[nid] = is.attendance[pid];
        });
        const same = merged.find((s) => s.date === is.date && s.start === is.start);
        if (same) {
          same.end = is.end;
          same.venue = is.venue;
          same.status = is.status;
          same.cancelReason = is.cancelReason;
          same.attendance = att;
          same.updatedAt = Math.max(Number(same.updatedAt) || 0, Number(is.updatedAt) || 0);
          sOver += 1;
        } else {
          merged.push({ ...is, id: merged.some((s) => s.id === is.id) ? uid('s') : is.id, attendance: att });
          sAdd += 1;
        }
      });
      merged.sort(sessionSort);
      if (merged.length) weeks[k] = merged;
    });
    out.weeks = weeks;

    /* 3) 技能记录：只追加不覆盖，按「人+项+日期+前后分」去重 */
    const seen = new Set(db.skillLogs.map((l) => `${l.playerId}|${l.skill}|${l.date}|${l.before}|${l.after}`));
    const logs = db.skillLogs.slice();
    let lAdd = 0;
    inc.skillLogs.forEach((l) => {
      const pid = idMap.get(l.playerId);
      if (!pid) return;
      const key = `${pid}|${l.skill}|${l.date}|${l.before}|${l.after}`;
      if (seen.has(key)) return;
      seen.add(key);
      logs.push({ ...l, playerId: pid, id: logs.some((x) => x.id === l.id) ? uid('log') : l.id });
      lAdd += 1;
    });
    logs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.at) || 0) - (Number(b.at) || 0));
    out.skillLogs = logs;

    /* 4) AI 点评：有新的就换成新的（老格式在 shareNotes 字典，新格式在 players[].note） */
    const notes = { ...(db.shareNotes || {}) };
    Object.keys(inc.shareNotes || {}).forEach((pid) => {
      const nid = idMap.get(pid);
      if (nid && inc.shareNotes[pid]) notes[nid] = inc.shareNotes[pid];
    });
    matched.forEach((m) => { if (m.inc.note) notes[m.cur.id] = m.inc.note; });
    out.shareNotes = notes;

    /* 训练模板 / 主题 / 阵型库属于这台设备自己的偏好，合并时不动 */
    return {
      db: out,
      stats: {
        matched: matched.length,
        added: added.length,
        kept: db.players.length - matched.length,
        sOver, sAdd, lAdd,
        incPlayers: inc.players.length,
        incSessions: Object.values(inc.weeks || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0),
        incLogs: inc.skillLogs.length
      }
    };
  }

  /* 打开「导入」弹窗：选模式 → 看预览 → 落库。选文件 / 粘贴 / 剪贴板三个入口共用 */
  function openImportDialog(incoming, label) {
    if (!incoming || typeof incoming !== 'object') { toast('备份内容读不出来', 'warn'); return; }
    if (incoming.version !== SCHEMA) { toast(`备份版本是 ${String(incoming.version)}，当前需要 ${SCHEMA}`, 'warn'); return; }
    const merged = mergeBackup(incoming);
    const st = merged.stats;
    const sum = (mode) => mode === 'merge'
      ? `<div class="imp-row"><span>队员</span><b>匹配 ${st.matched} · 新增 ${st.added} · 本机保留 ${st.kept}</b></div>
         <div class="imp-row"><span>训练</span><b>覆盖 ${st.sOver} 场 · 新增 ${st.sAdd} 场</b></div>
         <div class="imp-row"><span>技能记录</span><b>追加 ${st.lAdd} 条</b></div>
         <div class="imp-row imp-mut"><span>不动</span><b>训练模板、主题、阵型库</b></div>`
      : `<div class="imp-row"><span>结果</span><b>${st.incPlayers} 名队员 · ${st.incSessions} 次训练 · ${st.incLogs} 条技能记录</b></div>
         <div class="imp-row imp-mut"><span>代价</span><b>本机现有数据全部清掉</b></div>`;

    const savedTxt = (() => {
      const v = incoming.savedAt;
      if (!v) return '';
      const n = Number(v);
      if (Number.isFinite(n) && n > 1e11) { const d = new Date(n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
      return String(v).slice(0, 10);
    })();

    openModal('导入备份', `<div class="imp-wrap">
      <p class="imp-lead">来源：<b>${esc(label)}</b>${savedTxt ? `，导出于 ${esc(savedTxt)}` : ''}。</p>
      <label class="imp-opt"><input type="radio" name="impMode" value="merge" checked><span><strong>按队员合并</strong><em>同姓名同号码的人用备份覆盖；备份里的新队员补上；本机独有的保留。</em></span></label>
      <label class="imp-opt"><input type="radio" name="impMode" value="replace"><span><strong>完全覆盖</strong><em>清空本机全部数据，变成备份的样子。</em></span></label>
      <div class="imp-preview" id="impPreview">${sum('merge')}</div>
      <div class="form-foot"><button type="button" class="btn btn-primary" id="impGo">导入</button><button type="button" class="btn btn-ghost" id="impCancel">取消</button></div>
    </div>`, { mid: true });

    const modeOf = () => (document.querySelector('input[name="impMode"]:checked') || {}).value || 'merge';
    document.querySelectorAll('input[name="impMode"]').forEach((r) => {
      r.onchange = () => { $('#impPreview').innerHTML = sum(modeOf()); };
    });
    $('#impCancel').onclick = closeModal;
    $('#impGo').onclick = async () => {
      const mode = modeOf();
      const cloud = CloudOn() && window.XGYCloud && window.XGYCloud.importBackup;
      const teamName = cloud && window.XGYCloud.team() ? window.XGYCloud.team().name : '';

      if (mode === 'replace') {
        const ok = await confirmDialog({
          title: '完全覆盖？',
          message: cloud
            ? `云端「${teamName}」现有的 ${db.players.length} 名队员、全部考勤和技能记录会被删掉，换成备份的内容。此操作不可撤销。`
            : `本机现有的 ${db.players.length} 名队员、全部考勤和技能记录会被删掉，换成备份的内容。`,
          ok: '覆盖'
        });
        if (!ok) return;
      }

      /* 云端模式：走服务端一个事务写库。
         以前这里只写 localStorage，reload 时 pullCore 会拿服务器数据整份覆盖，
         导入的东西在刷新那一瞬间就没了 —— 所以云端必须把数据真正推到服务器。 */
      if (cloud) {
        const btn = $('#impGo');
        btn.disabled = true;
        btn.textContent = '正在写入云端…';
        try {
          const res = await window.XGYCloud.importBackup(mode, incoming);
          const s = (res && res.stats) || {};
          toast(`已导入云端：匹配 ${s.matched || 0} 人、新增 ${s.added || 0} 人、训练覆盖 ${s.sOver || 0} 场 / 新增 ${s.sAdd || 0} 场、技能记录 ${s.lAdd || 0} 条`);
          setTimeout(() => location.reload(), 700);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = '导入';
          toast(`云端导入失败，云端数据未改动：${e && e.message ? e.message : '未知错误'}`, 'warn');
        }
        return;
      }

      if (mode === 'replace') db = normalizeDB(incoming);
      else db = merged.db;
      save();
      location.reload();
    };
  }

  /* 单元格：备份的三条通路——选文件 / 用链接 / 粘贴。选文件是 input 铺满按钮 */
  function openImportChooser() {
    const app = inAppBrowser();
    const fileCls = app ? 'btn-ghost' : 'btn-primary';
    const pasteCls = app ? 'btn-primary' : 'btn-ghost';
    openModal('导入备份', `<div class="imp-wrap">
      ${app ? `<p class="imp-alert"><b>${app}里选不了文件。</b>点按钮会有反应、选择器就是不弹——这是${app}内核没这个能力，不是页面坏了。<br>
        用下面的<b>粘贴备份内容</b>，或者复制链接到系统浏览器（Chrome / Edge / 夸克）打开再选。</p>` : ''}
      <p class="imp-lead">备份在手机/平板的「文件」里就直接选；在微信、QQ 里收到的话，让对方发<b>导入链接</b>给你最快。</p>
      <div class="imp-choice">
        ${fileHitHTML('importFile', '选择备份文件', fileCls)}
        <button type="button" class="btn btn-ghost" id="impPickLink">用链接导入</button>
        <button type="button" class="btn ${pasteCls}" id="impPickPaste">粘贴备份内容</button>
        ${app ? '<button type="button" class="btn btn-ghost" id="siCopyLink">复制本页链接（到浏览器打开）</button>' : ''}
      </div>
      <p class="imp-hint" id="fileStuck" hidden>点了没弹出文件选择器？<b id="fileRetry">换一种方式打开</b>；或者把备份文件先另存到平板的「下载 / 文档」目录再来选。<br>
      还有一条最稳的：<b id="fileCopyLink">复制本页链接</b>，用 Chrome / Edge 打开导入——数据存在同一个地方，回到这个 App 就能看到。</p>
      <p class="imp-note">三个入口后面都会先让你选「按队员合并」还是「完全覆盖」，不会一按就覆盖。<br>
      文件在选择器里是<b>灰色点不动</b>或<b>根本翻不到</b>？把文件名改成 <b>.txt</b> 再选，或者让队长生成导入链接发你。</p>
    </div>`, { mid: true });
    bindFileHit('importFile', handleImportFile, 'fileStuck');
    bindCopyLink();
    if ($('#impPickLink')) $('#impPickLink').onclick = () => openLinkImport();
    if ($('#impPickPaste')) $('#impPickPaste').onclick = () => openPasteImport();
  }

  function openPasteImport() {
    openModal('粘贴备份导入', `<div class="imp-wrap">
      <p class="imp-lead">把备份文件用文本方式打开、全选复制，粘到这里——<b>粘完会自动解析</b>，不用再点按钮。平板上文件选择器常常翻不到 .json，这是绕过去的办法。</p>
      <textarea class="imp-ta" id="impText" rows="8" placeholder='{"version":2,"players":[...]}'></textarea>
      <div class="form-foot">
        <button type="button" class="btn btn-ghost" id="impClip">读剪贴板</button>
        <button type="button" class="btn btn-primary" id="impParse">解析</button>
        <button type="button" class="btn btn-ghost" id="impPasteCancel">取消</button>
      </div>
    </div>`, { mid: true });
    const ta = $('#impText');
    $('#impPasteCancel').onclick = closeModal;
    /* 粘完就自动试一次，成了直接进预览（用户从微信里复制一大段 JSON，
       本来就不该再让他找「解析」按钮）。失败不吵，保留手动按钮。 */
    const doParse = (auto) => {
      const t = String(ta.value || '').trim().replace(/^\uFEFF/, '');
      if (!t) { if (!auto) toast('先把备份内容粘进来', 'warn'); return false; }
      let raw;
      try { raw = JSON.parse(t); }
      catch (e) {
        if (auto) return false;
        // 微信/QQ 单条消息有长度上限，长备份会被悄悄截断
        const looksCut = /^[\s{[]/.test(t) && !/[\s}\]]$/.test(t);
        toast(looksCut
          ? '内容像是被截断了（末尾没闭合）——改用「导出为链接」，或者在浏览器里导入文件'
          : '这不是有效的 JSON，检查有没有粘漏', 'warn');
        return false;
      }
      openImportDialog(raw, '粘贴的内容');
      return true;
    };
    $('#impClip').onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('剪贴板是空的', 'warn'); return; }
        ta.value = t;
        if (!doParse(true)) toast('已从剪贴板读入，点「解析」看看');
      } catch (e) {
        toast('读不了剪贴板，长按输入框手动粘贴', 'warn');
      }
    };
    $('#impParse').onclick = () => doParse(false);
    ta.addEventListener('paste', () => setTimeout(() => doParse(true), 60));
  }

  function readFileText(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  /* 文件选择这块踩过三代：
     ① `<input hidden>` + `input.click()`：安卓 PWA 吞掉程序化 click，点了没反应；
     ② `<label for>` 原生触发：桌面灵、PWA 里时灵时不灵；
     ③ 现在：<input type=file> 用 opacity:0 铺满整块按钮，手指点到的就是 input 本体，
        不依赖任何代理层，也不带 accept（选择器按 MIME 过滤会把文件变灰）。
     还压着第四个坑：国内 App 的内置浏览器大多不实现 onShowFileChooser，
     点 input 有触摸反馈、选择器就是不弹。这不是页面坏了，是宿主 WebView 没能力。 */
  function inAppBrowser() {
    const ua = navigator.userAgent || '';
    if (/MicroMessenger/i.test(ua)) return '微信';
    if (/wxwork/i.test(ua)) return '企业微信';
    if (/\bQQ\/[\d.]+/.test(ua) && !/MQQBrowser/i.test(ua)) return 'QQ';
    if (/DingTalk/i.test(ua)) return '钉钉';
    if (/AlipayClient/i.test(ua)) return '支付宝';
    if (/Weibo/i.test(ua)) return '微博';
    return '';
  }
  function fileHitHTML(id, text, cls) {
    return `<label class="btn ${cls || 'btn-primary'} imp-file"><span>${text}</span>`
      + `<input type="file" id="${id}" class="file-hit" aria-label="${text}"></label>`;
  }
  function bindFileHit(id, onPick, stuckId) {
    const el = document.getElementById(id);
    if (!el) return;
    const stuck = stuckId ? document.getElementById(stuckId) : null;
    let timer = 0;
    const disarm = () => { clearTimeout(timer); if (stuck) stuck.hidden = true; };
    /* 点了之后 2.6 秒还没离开页面 = 系统选择器压根没弹起来（安卓 PWA / 内置浏览器的通病）。
       这时候别让人对着按钮发呆，直接把「换一种方式」和「文件先存下载目录」摆出来。 */
    el.addEventListener('click', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible') return; // 选择器确实开过，页面被切走了
        if (stuck) stuck.hidden = false;
      }, 2600);
    });
    el.addEventListener('change', () => {
      disarm();
      const f = el.files && el.files[0];
      el.value = ''; // 先清空：同一个文件改完内容再选一次也要能触发 change
      if (f) onPick(f);
    });
    const retry = stuck ? document.getElementById('fileRetry') : null;
    if (retry) {
      retry.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!window.showOpenFilePicker) { toast('这台设备只能用「粘贴」，或把文件另存到「下载」再选', 'warn'); return; }
        try {
          const [h] = await window.showOpenFilePicker({ multiple: false }); // 不过滤类型：过滤会把文件变灰
          const f = await h.getFile();
          disarm();
          if (f) onPick(f);
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          toast('这个方式也不通，用「粘贴」最快', 'warn');
        }
      });
    }
    /* PWA 的 origin 和浏览器网页是同一个，localStorage 共享——
       在 Chrome / Edge 里导入完，回到这个 App 数据就在，等于绕开了 PWA 的文件选择 */
    const copyLink = stuck ? document.getElementById('fileCopyLink') : null;
    if (copyLink) {
      copyLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        const url = location.href.split('#')[0];
        if (copyText(url)) toast('链接已复制。用装这个 App 的那个浏览器打开导入，数据才通用');
        else toast('复制失败，手动记下这个网址', 'warn');
      });
    }
  }
  /* 内置浏览器里唯一的出路：把链接弄到系统浏览器去 */
  function bindCopyLink() {
    const btn = $('#siCopyLink');
    if (!btn) return;
    btn.onclick = () => {
      const url = location.href.split('#')[0];
      if (copyText(url)) toast('链接已复制，到系统浏览器里粘贴打开');
      else toast('复制失败，长按地址栏手动复制', 'warn');
    };
  }

  async function handleImportFile(file) {
    if (!file) return;
    const name = file.name || '这个文件';
    try {
      const text = (await readFileText(file)).replace(/^\uFEFF/, '');
      const raw = JSON.parse(text);
      openImportDialog(raw, name);
    } catch (e) {
      // 分开说，别一律「不是有效的 JSON」让人摸不着头脑
      if (e instanceof SyntaxError) toast(`${name} 里读不出备份数据（不是备份文件，或转发时被截断）`, 'warn');
      else toast(`${name} 打不开，换「用链接导入」试试`, 'warn');
    }
  }

  async function clearAllData() {
    const ok = await confirmDialog({ title: '清空所有数据？', message: '队员、训练、考勤、技能记录都会被删除，无法恢复。建议先导出备份。', ok: '清空所有数据' });
    if (!ok) return;
    try { localStorage.removeItem(dbKey()); } catch (e) { /* ignore */ }
    location.reload();
  }

  function openHelp() {
    openModal('使用说明', `<div class="help-body">
      <p><b>1. 先设模板。</b> 默认周二 16:30–18:30、周五 16:30–18:30、周日 08:30–11:30。地点在设置里补一次即可。</p>
      <p><b>2. 再加队员。</b> 只填姓名、号码、位置、年级、身高，以及 6 项技能的初始分（默认 5.0）。</p>
      <p><b>3. 每周自动生成训练。</b> 改时间、改地点、取消、加练都只影响那一周。下雨就用「因雨取消」，不计入出勤率。</p>
      <p><b>4. 考勤按次登记。</b> 每个格子循环切换：未登记 → 出勤 → 迟到 → 请假 → 缺席。未登记的格子不参与出勤率计算。</p>
      <p><b>5. 训练后调技能。</b> 成长页点格子单项调整，或用「训练后调整」按当次参训名单批量加减。0–10 分，步进 0.5。</p>
      <p><b>6. 阵型板摆站位。</b> 进入阵型页，手指（或鼠标）把 6 个角色拖到防守位置，松手按 0.25m 吸附并自动保存；摆好后点「存当前」起个名字存进阵型库，点列表随时套用。双击或方向键可微调。</p>
      <p><b>7. 定期备份。</b> 设置或头像菜单里导出 JSON。换电脑前先导出。</p>
      <p><b>8. 队员请假。</b> 队员在分享页底部点「请假」，选一次训练和原因，会拿到一串 12 位回执码；他把码（或整段消息）发给你，你在考勤页点「回执」粘进去，那次就登记成请假。他要是点了「复制回执链接」，你直接点开链接也会自动弹确认。</p>
    </div>`, { mid: true });
  }
