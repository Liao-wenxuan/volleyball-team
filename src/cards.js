/* ============================================================
 * cards —— 训练卡：一次训练一张可转发的图 / 赛季卡：一学期一张的总结图 / 阵型图：把当前 6 个角色位导成一张可转发的 PNG / 分享队伍动态（队员只读视图） / 请假回执：队员反向请假
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 训练卡：一次训练一张可转发的图 ══════════ */
  function nextSessionAfter(s) {
    const all = [];
    Object.values(db.weeks).forEach((arr) => { if (Array.isArray(arr)) all.push(...arr); });
    all.sort(sessionSort);
    const key = `${s.date}T${s.start || ''}`;
    return all.find((x) => x.status !== 'cancelled' && `${x.date}T${x.start || ''}` > key) || null;
  }

  /* 考勤页的「训练卡」按钮：出当前周最近一场（优先今天）的图 */
  function openWeekCard() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    const list = (getSessions(state.weekMonday) || []).filter((s) => s && s.date && s.status !== 'cancelled');
    if (!list.length) { toast('这一周还没有训练，先加一次', 'warn'); return; }
    list.sort(sessionSort);
    const today = dateKey(new Date());
    const target = list.find((s) => s.date === today)
      || [...list].reverse().find((s) => s.date <= today)
      || list[0];
    openTrainingCard(target);
  }

  async function openTrainingCard(s) {
    if (!s) return;
    await ensureMod('card');
    const card = await window.XGYCard.render({
      team: '排球队管理系统',
      session: s,
      players: db.players,
      logs: db.skillLogs.filter((l) => l.date === s.date),
      next: nextSessionAfter(s)
    });
    openModal('训练卡', `<div class="card-wrap">
      <p class="share-hint">保存后直接发到队群。图片<b>在你自己手机上生成</b>，不经过任何服务器；手机上也可以长按图片保存。</p>
      <img class="card-preview" src="${card.dataURL}" alt="训练卡预览">
      <div class="share-foot"><button type="button" class="btn btn-primary" id="cardSave">保存图片</button><button type="button" class="btn btn-ghost" id="cardClose">关闭</button></div>
    </div>`, { mid: true });
    $('#cardClose').onclick = closeModal;
    $('#cardSave').onclick = () => {
      const url = URL.createObjectURL(card.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `训练卡-${s.date}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已保存到下载目录，去微信里发给大家吧');
    };
  }

  /* ══════════ 赛季卡：一学期一张的总结图 ══════════ */
  function seasonPayload() {
    const keys = Object.keys(db.weeks).filter((k) => Array.isArray(db.weeks[k]) && db.weeks[k].length).sort();
    let attSum = 0, attMarked = 0, activeTotal = 0, logCount = 0;
    const weeks = keys.map((k) => {
      const monday = parseKey(k);
      const active = db.weeks[k].filter((s) => s.status !== 'cancelled');
      let on = 0, marked = 0;
      const camePos = new Set();
      active.forEach((s) => db.players.forEach((p) => {
        const st = (s.attendance || {})[p.id];
        if (!st) return;
        marked += 1;
        if (st === 'present' || st === 'late') { on += 1; camePos.add(p.position); }
      }));
      attSum += on; attMarked += marked; activeTotal += active.length;
      const d = parseKey(k);
      return {
        label: `${d.getMonth() + 1}.${d.getDate()}`,
        rate: marked ? Math.round((on / marked) * 100) : null,
        positions: POSITIONS.filter((x) => camePos.has(x))
      };
    });
    logCount = (db.skillLogs || []).length;
    // 全队六维：起点 = 每人每项最早记录的 before 的均值；现在 = 当前分均值
    const radar = { skills: SKILLS.map((sk) => {
      let s0 = 0, s1 = 0;
      db.players.forEach((p) => { s0 += skillStart(p, sk.key); s1 += Number(p.skills[sk.key] ?? 5); });
      const n = Math.max(1, db.players.length);
      return { label: sk.label, start: +(s0 / n).toFixed(1), now: +(s1 / n).toFixed(1) };
    }) };
    const range = weeks.length
      ? `${weeks[0].label} – ${parseKey(keys[keys.length - 1]).getMonth() + 1}.${parseKey(keys[keys.length - 1]).getDate()}`
      : '';
    return {
      team: '排球队管理系统',
      range,
      totals: { sessions: activeTotal, rate: attMarked ? Math.round((attSum / attMarked) * 100) : null, players: db.players.length, logs: logCount },
      weeks,
      radar
    };
  }

  async function openSeasonCard() {
    if (!db.players.length) { toast('先添加队员', 'warn'); return; }
    if (!hasAnyAttendance()) { toast('还没有登记过考勤，先记几周再来看总结', 'warn'); return; }
    await ensureMod('card');
    const card = await window.XGYSeason.render(seasonPayload());
    openModal('赛季卡', `<div class="card-wrap">
      <p class="share-hint">一学期一张的总结图：每周出勤、位置完整度热力、全队六维进步。<b>在你自己设备上生成</b>，不经过任何服务器。</p>
      <img class="card-preview" src="${card.dataURL}" alt="赛季卡预览">
      <div class="share-foot"><button type="button" class="btn btn-primary" id="cardSave2">保存图片</button><button type="button" class="btn btn-ghost" id="cardClose2">关闭</button></div>
    </div>`, { mid: true });
    $('#cardClose2').onclick = closeModal;
    $('#cardSave2').onclick = () => {
      const url = URL.createObjectURL(card.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `赛季卡-${dateKey(new Date())}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('赛季卡已保存，学期末发群里正好');
    };
  }

  /* ══════════ 阵型图：把当前 6 个角色位导成一张可转发的 PNG ══════════
   * 和训练卡/赛季卡同一套路：按需加载 courtcard.js，canvas 在本机画完再交给弹窗。
   * 角色位绑的是「角色」不是真人（r35 用户拍板），所以这里也只带 label+坐标，
   * 不查队员名单——空队也能导出讲站位。 */
  async function openCourtCard() {
    try {
      await ensureMod('courtcard');
      const title = ($('#fxTitle') && $('#fxTitle').textContent.trim()) || '默认站位';
      const team = ($('#footerTeam') && $('#footerTeam').textContent.trim()) || '排球队管理系统';
      const roles = FX_ROLES.map((r) => {
        const pt = (db.formation.pos || {})[r.id] || { x: 0, y: 0 };
        // fxRoleName 会处理「自由人进 3m 线内换牌」，导出的图跟屏幕上标牌一致
        return { id: r.id, label: fxRoleName(r.id), color: r.color, x: pt.x, y: pt.y };
      });
      const card = await window.XGYCourt.render({
        team, name: title, date: dateKey(new Date()), roles
      });
      openModal('阵型图', `<div class="card-wrap">
        <p class="share-hint">把当前站位导成一张图，直接发群里讲跑位。<b>图片在你自己设备上生成</b>，不经过任何服务器；手机上可以长按图片保存。</p>
        <img class="card-preview" src="${card.dataURL}" alt="阵型图预览">
        <div class="share-foot"><button type="button" class="btn btn-primary" id="courtSave">保存图片</button><button type="button" class="btn btn-ghost" id="courtClose">关闭</button></div>
      </div>`, { mid: true });
      $('#courtClose').onclick = closeModal;
      $('#courtSave').onclick = () => {
        const url = URL.createObjectURL(card.blob);
        const a = document.createElement('a');
        a.href = url;
        // 阵型名是用户自定义的，Windows 文件名非法字符要先洗掉
        a.download = `阵型图-${title.replace(/[\\/:*?"<>|]/g, '_')}-${dateKey(new Date())}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('阵型图已保存，发群里讲站位吧');
      };
    } catch (e) {
      toast('导出失败：' + (e && e.message ? e.message : '未知错误'), 'warn');
    }
  }

  /* ══════════ 分享队伍动态（队员只读视图） ══════════ */
  // 每项技能的「起点分」：取该队员该项最早一条调整记录里的 before。
  // 从来没调过就当没变化（起点 = 现在），进步显示 0，不会凭空夸。
  function skillStart(p, key) {
    let first = null;
    (db.skillLogs || []).forEach((l) => {
      if (l.playerId !== p.id || l.skill !== key) return;
      if (!first || (l.at || 0) < (first.at || 0)) first = l;
    });
    return first ? Number(first.before) : Number(p.skills[key] ?? 5);
  }

  function attRate(att) {
    const marked = att.p + att.l + att.v + att.a;
    if (!marked) return null;
    return Math.round(((att.p + att.l) / marked) * 100);
  }

  // 全季考勤聚合：跳过取消的训练；只统计「已登记」的格子，未登记不算缺勤
  function sharePayload() {
    const players = db.players.map((p) => {
      const att = { p: 0, l: 0, v: 0, a: 0 };
      Object.values(db.weeks).forEach((arr) => (arr || []).forEach((s) => {
        if (s.status === 'cancelled') return;
        const st = (s.attendance || {})[p.id];
        if (st === 'present') att.p += 1;
        else if (st === 'late') att.l += 1;
        else if (st === 'leave') att.v += 1;
        else if (st === 'absent') att.a += 1;
      }));
      const sk = SKILLS.map((s) => Number(p.skills[s.key] ?? 5));
      const base = SKILLS.map((s) => skillStart(p, s.key));
      // note 只带 AI 写的那段：模板点评是纯规则算出来的，队员端用同样规则现场算，
      // 结果一模一样，但省掉整条链接一半的体积（中文文本压不动，最贵的就是它）
      const aiNote = (db.shareNotes && db.shareNotes[p.id]) || '';
      // nc：这段点评是不是 AI 写的（分享页据此标注来源，模板版不冒充 AI）
      return { id: p.id, n: p.name, pos: p.position, no: p.number || 0, att, sk, base, note: aiNote, nc: aiNote ? 1 : 0 };
    });
    const sessions = Object.values(db.weeks).flat()
      .filter((s) => s && s.status !== 'cancelled')
      .sort((a, b) => sessionSort(b, a))
      .slice(0, 8)
      .map((s) => {
        const c = sessionCounts(s);
        return { d: s.date || '', t: s.start || '', p: c.present, l: c.late, v: c.leave, a: c.absent, st: s.attendance || {} };
      })
      .reverse(); // 视图里按时间正序展示
    // 接下来几次还没结束的训练：队员要请假，得先知道「请哪一次」
    const now = Date.now();
    const next = [];
    const seen = new Set();
    for (let w = 0; w < 4 && next.length < 4; w++) {
      const monday = getMonday(addDays(new Date(), w * 7));
      getSessions(monday).forEach((s) => {
        if (s.status === 'cancelled') return;
        if (sessionEnd(s).getTime() <= now) return;
        const k = `${s.date}T${s.start}`;
        if (seen.has(k)) return;
        seen.add(k);
        next.push({ d: s.date, t: s.start });
      });
    }
    next.sort((a, b) => (`${a.d}T${a.t}` < `${b.d}T${b.t}` ? -1 : 1));
    return { v: 1, team: '排球队管理系统', at: Date.now(), players, sessions, next: next.slice(0, 4) };
  }

  /** 用队长的 AI Key 一次性给全队写点评（存本机，生成过就不重复花钱） */
  async function generateShareNotes() {
    const cfg = aiCfg();
    if (!cfg.key) throw new Error('还没填 API Key');
    const data = sharePayload();
    const rows = data.players.map((pl, i) => {
      const skills = {}, start = {};
      SKILLS.forEach((sk, k) => { skills[sk.label] = +pl.sk[k].toFixed(1); start[sk.label] = +pl.base[k].toFixed(1); });
      return { i, 姓名: pl.n, 号码: pl.no, 位置: pl.pos, 出勤率: attRate(pl.att), 出勤: pl.att, 技能: skills, 起点: start };
    });
    const prompt = `你是这支大学院排球队的队长，也是队里技术最细的人。下面是队员的真实数据（起点 = 赛季初的分，技能 = 现在的分，出勤率按已登记的训练算）。\n\n${JSON.stringify(rows)}\n\n给每个人写一段点评，直接对本人说、用"你"，40-50 字（链接长度直接取决于这个，超过 50 字就算失败），必须包含三件事：\n1）具体夸一处：点名某项技能或出勤表现，带上数字对比；\n2）指出最该练的一项技能，配一个能自己练的动作或次数；\n3）一句落在实处的鼓励，不要空话、不要堆感叹号、不要"你是最棒的"。\n语气像认真但不肉麻的队长，不要出现"数据""统计""评分"这类词。\n只输出 JSON 数组，格式 [{"i":0,"t":"点评正文"}]，i 用给定编号，不要解释、不要代码块。`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    let res;
    try {
      res = await fetch(aiUrl(cfg.base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], stream: false, temperature: 0.8 }),
        signal: ctl.signal
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.code)) || j.message || ''; } catch (e) { /* ignore */ }
      throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}${res.status === 401 ? '（Key 不对）' : res.status === 402 ? '（余额不足）' : ''}`);
    }
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a < 0 || b < 0) throw new Error('模型没按格式返回');
    let arr;
    try { arr = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('返回内容解析失败'); }
    let n = 0;
    const noteUpdates = [];
    (Array.isArray(arr) ? arr : []).forEach((it) => {
      const pl = data.players[it && it.i];
      if (!pl || typeof it.t !== 'string' || !it.t.trim()) return;
      if (!db.shareNotes) db.shareNotes = {};
      db.shareNotes[pl.id] = it.t.trim().slice(0, 150); // 50 字中文 ≈ 150 字节，再长二维码就扫不动了
      noteUpdates.push([pl.id, it.t.trim().slice(0, 150)]);
      n += 1;
    });
    if (!n) throw new Error('一条点评都没解析出来');
    save();
    // r30：点评上云（players.note），换设备/换标签不再丢
    if (CloudOn()) {
      noteUpdates.forEach(([pid, txt]) => {
        cloudFire(window.XGYCloud.push.playerUpdate(pid, { note: txt }), null);
      });
    }
    return n;
  }

  async function openShareModal() {
    if (!db.players.length) { toast('还没有队员，先录入队员再分享', 'warn'); return; }
    // 分享/二维码/档案文件三个模块都是这里才需要，冷启动不下发
    await ensureMod('share', 'qr', 'playercard').catch(() => {});
    const hasAi = !!aiCfg().key;
    // 先试组成一次，只为了在按钮上显示体积；真正下载时会用最新数据重拼
    let pcSize = 0;
    try { pcSize = window.XGYPlayerCard ? window.XGYPlayerCard.build(sharePayload()).length : 0; } catch (e) { pcSize = 0; }
    const body = `<div class="share-wrap">
      <div class="share-file">
        <div class="share-file-hd"><b>发档案文件给他</b><em>OFFLINE · NO LOGIN</em></div>
        <p>下载一个 <b>.html</b> 文件发到群里，队员用浏览器打开、输<b>姓名 + 球衣号码</b>，就能看自己的出勤、六项技能、点评和近 8 次记录。<b>断网也能看</b>，数据全在文件里，不上传任何服务器。</p>
        <button type="button" id="shareFile" class="share-file-btn">下载档案文件${pcSize ? ` · ${db.players.length} 人 · ${(pcSize / 1024).toFixed(1)} KB` : ''}</button>
        <em class="share-file-tip">微信里发文件比发长链接好点开；手机上收到后选「用浏览器打开」。</em>
      </div>
      <p class="share-hint">或者发下面的码：队员<b>微信扫一扫</b>或长按识别，同样输<b>姓名 + 球衣号码</b>。数据全在码里，<b>不上传任何服务器</b>。</p>
      <div class="share-qr">
        <canvas id="shareQr" aria-label="队员端二维码"></canvas>
        <em id="shareQrTips" class="mono">生成中…</em>
        <button type="button" class="share-qr-save" id="shareQrSave">保存二维码图片</button>
      </div>
      ${hasAi
        ? `<div class="share-ai"><button type="button" class="btn btn-ghost" id="shareAi"><span>✦</span>用 AI 写点评</button><em id="shareAiSt">点一次，全队每人一段（约 10 秒）</em></div>`
        : `<div class="share-ai is-tip"><em>点评先用内置模板生成。到「AI 助手」填个 API Key，可以让 AI 写得更贴每个人的情况。</em></div>`}
      <details class="share-link-box">
        <summary>或者复制链接发到群里</summary>
        <textarea id="shareLink" class="share-link" rows="3" readonly placeholder="生成中…"></textarea>
        <div class="share-meta mono" id="shareMeta"></div>
      </details>
      <div class="share-note">
        <p>· 这是<b>数据快照</b>，之后改了考勤或技能，重新生成一次再发</p>
        <p>· 码里含队员姓名和出勤，只发队内，别贴公开群</p>
        <p>· 队员要请假，让他在页面底部点「请假」拿回执码，你在考勤页点「回执」登记</p>
      </div>
      <div class="share-foot"><button type="button" class="btn btn-primary" id="shareCopy">复制链接</button><button type="button" class="btn btn-ghost" id="shareClose">关闭</button></div>
    </div>`;
    openModal('分享队伍动态', body, { mid: true });
    $('#shareClose').onclick = closeModal;
    $('#shareLink').onclick = (e) => e.target.select();
    // 单文件档案：每次点击都重新拼，保证带上最新的考勤/技能/AI 点评
    const fileBtn = $('#shareFile');
    if (fileBtn) fileBtn.onclick = () => {
      try {
        const r = window.XGYPlayerCard.download(sharePayload());
        toast(`已下载 ${r.name}（${(r.size / 1024).toFixed(1)} KB），微信发给队员就行`);
      } catch (e) {
        toast('导出失败：' + (e && e.message ? e.message : '未知错误'), 'warn');
      }
    };
    let url = '';

    // 把链接画成二维码：队员扫码进，不用看到那串长链接
    const paintQR = () => {
      const cv = $('#shareQr');
      const tips = $('#shareQrTips');
      if (!cv || !tips) return;
      if (!url) { tips.textContent = '链接还没生成好'; return; }
      if (!window.XGYQR) { cv.style.display = 'none'; tips.textContent = '二维码模块没加载'; return; }
      try {
        const info = window.XGYQR.toCanvas(cv, url, { size: 620, quiet: 2, fg: '#0c0e14', bg: '#ffffff' });
        // 版本越高模块越密：屏幕扫不动就靠存图发群、长按识别
        tips.textContent = info.version <= 16
          ? `V${info.version} · 当面扫或长按识别都行`
          : `V${info.version} · 偏密，建议存图发群里长按识别`;
        const save = $('#shareQrSave');
        if (save) save.onclick = () => {
          const name = `排球队管理系统-队员码-${new Date().toISOString().slice(0, 10)}.png`;
          // 导出单独画一张 1240px 的：屏幕上 620 够用，存图发群/打印要更密更清晰
          let exportCv = cv;
          try {
            const big = document.createElement('canvas');
            window.XGYQR.toCanvas(big, url, { size: 1240, quiet: 3, fg: '#0c0e14', bg: '#ffffff' });
            exportCv = big;
          } catch (e) { /* 画不出大的就导出屏幕这张 */ }
          exportCv.toBlob((blob) => {
            if (!blob) { toast('导出失败，可以截图保存', 'warn'); return; }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            toast('二维码已保存，发到群里让队员长按识别');
          }, 'image/png');
        };
        cv.onclick = () => {
          const ov = document.createElement('div');
          ov.className = 'qr-full';
          const big = document.createElement('canvas');
          ov.appendChild(big);
          document.body.appendChild(ov);
          window.XGYQR.toCanvas(big, url, { size: Math.max(720, Math.min(screen.width, screen.height) * 2), quiet: 2, fg: '#0c0e14', bg: '#ffffff' });
          big.style.width = 'min(86vw, 86vh)';
          ov.onclick = () => ov.remove();
        };
      } catch (err) {
        cv.style.display = 'none';
        tips.textContent = '二维码没生成：' + (err && err.message ? err.message : '未知错误') + '（可复制链接发）';
      }
    };

    const rebuild = async () => {
      try {
        url = await window.XGYShare.buildURL(sharePayload());
        $('#shareLink').value = url;
        $('#shareMeta').textContent = `LINK · ${url.length} CHARS`;
        paintQR();
      } catch (err) {
        $('#shareLink').value = '';
        $('#shareMeta').textContent = '生成失败：' + (err && err.message ? err.message : '未知错误');
        const tips = $('#shareQrTips');
        if (tips) tips.textContent = '生成失败';
      }
    };
    await rebuild();
    $('#shareCopy').onclick = async () => {
      if (!url) { toast('链接还没生成好，稍等一下再点', 'warn'); return; }
      try {
        await navigator.clipboard.writeText(url);
      } catch (e) {
        const ta = $('#shareLink');
        ta.select();
        document.execCommand('copy');
      }
      toast('链接已复制，去微信里粘贴发给队员吧');
    };
    const aiBtn = $('#shareAi');
    if (aiBtn) aiBtn.onclick = async () => {
      aiBtn.disabled = true;
      const st = $('#shareAiSt');
      if (st) st.textContent = '正在写…（一个请求，全队一起生成）';
      try {
        const n = await generateShareNotes();
        if (st) st.textContent = `已为 ${n} 名队员写好点评，链接已更新，复制发出去就行`;
        toast('点评生成好了，重新复制一次链接');
      } catch (err) {
        if (st) st.textContent = '生成失败：' + (err && err.message ? err.message : '未知错误');
        toast('AI 没写成功，先用模板版也能发', 'warn');
      } finally {
        aiBtn.disabled = false;
        await rebuild();
      }
    };
  }

  /* ══════════ 请假回执：队员反向请假 ══════════
     链路：队员在分享页点请假 → 本机算出 12 位回执码 → 微信发给队长 →
     队长在这里粘贴（或点他发来的 #rcpt= 链接）→ 一键登记成请假。
     不需要服务器，也不新增任何持久化字段：登记结果直接写进考勤。 */
  function playersByFp(fp) {
    if (!window.XGYShare || !window.XGYShare.fpOf) return [];
    return db.players.filter((p) => window.XGYShare.fpOf(p.name, p.number) === fp);
  }

  function openReceiptModal(prefill) {
    if (!db.players.length) { toast('还没有队员，先录入队员再收回执', 'warn'); return; }
    const body = `<div class="rcpt-wrap">
      <p class="rcpt-hint">队员在分享页点「请假」会拿到一串 <b>12 位回执码</b>。把他发来的整段话粘进来（或直接开他发来的回执链接），核对无误后一键登记。</p>
      <textarea id="rcptInput" class="rcpt-input" rows="3" spellcheck="false" placeholder="粘贴回执码，例如 7Q3M-9PDK-2XAB"></textarea>
      <div class="rcpt-preview" id="rcptPreview"></div>
      <div class="share-foot"><button type="button" class="btn btn-primary" id="rcptApply" disabled>登记为请假</button><button type="button" class="btn btn-ghost" id="rcptCancel">关闭</button></div>
    </div>`;
    openModal('队员请假回执', body, { mid: true });
    $('#rcptCancel').onclick = closeModal;
    const input = $('#rcptInput');
    const prev = $('#rcptPreview');
    const applyBtn = $('#rcptApply');
    let rc = null;
    let cands = [];
    let cand = null;
    let target = null; // { monday, session }

    const card = (player, bad, inner) => {
      const [a, b] = positionStyle(player.position);
      return `<div class="rcpt-card${bad ? ' is-bad' : ''}">
        <div class="rcpt-who">
          <span class="u-avatar" style="--a:${a};--b:${b}">${esc((player.name || '?')[0])}</span>
          <strong>${esc(player.name)}</strong><em>${player.number ? '#' + player.number + ' · ' : ''}${esc(player.position)}</em>
        </div>
        <dl class="rcpt-facts">${inner}</dl>
      </div>`;
    };

    const syncApply = () => {
      let ok = !!(cand && rc && target && target.session);
      let why = '';
      if (cand && target && target.session) {
        if (target.session.status === 'cancelled') { ok = false; why = '那次已取消'; }
        else if (target.session.attendance[cand.id] === 'leave') { ok = false; why = '已经是请假'; }
      }
      applyBtn.disabled = !ok;
      applyBtn.textContent = why ? `无需登记（${why}）` : '登记为请假';
    };

    const showTarget = () => {
      if (!rc) return;
      target = (() => {
        const monday = getMonday(parseKey(rc.date));
        const hits = getSessions(monday).filter((s) => s.date === rc.date);
        return { monday, session: hits.find((s) => s.start === rc.start) || hits[0] || null };
      })();
      if (!cand) return;
      const s = target.session;
      let stateLine;
      if (!s) stateLine = `<dd class="warn">那天没有训练记录</dd>`;
      else if (s.status === 'cancelled') stateLine = `<dd class="warn">那次已取消</dd>`;
      else {
        const cur = s.attendance[cand.id] || '';
        stateLine = cur === 'leave' ? '<dd>已经是请假</dd>'
          : cur ? `<dd class="warn">现在是「${ATT_LABEL[cur]}」，会被改成请假</dd>`
            : '<dd>未登记</dd>';
      }
      prev.innerHTML = card(cand, false, `
        <div><dt>哪一次</dt><dd>${esc(fmtDateCN(parseKey(rc.date)))} ${esc(rc.start)}</dd></div>
        <div><dt>原因</dt><dd>${esc(rc.reasonText)}</dd></div>
        <div><dt>当前</dt>${stateLine}</div>`);
      syncApply();
    };

    const parse = () => {
      rc = null; cands = []; cand = null; target = null;
      prev.innerHTML = '';
      applyBtn.disabled = true;
      applyBtn.textContent = '登记为请假';
      const raw = String(input.value || '').trim();
      if (!raw) return;
      try {
        rc = window.XGYShare.decodeReceipt(raw);
      } catch (err) {
        prev.innerHTML = `<div class="rcpt-card is-bad"><b>${esc(err.message)}</b><p>回执码是 12 位，形如 <span class="mono">7Q3M-9PDK-2XAB</span>。整段消息一起粘也行。</p></div>`;
        return;
      }
      cands = playersByFp(rc.fp);
      if (!cands.length) {
        prev.innerHTML = `<div class="rcpt-card is-bad"><b>队里对不上这个人</b><p>可能改过名字或号码，也可能这条回执不是发给咱们队的。让对方重新生成一次，或者你手动登记。</p><p class="mono">${esc(rc.date)} ${esc(rc.start)} · ${esc(rc.reasonText)}</p></div>`;
        return;
      }
      if (cands.length === 1) {
        cand = cands[0];
        showTarget();
        return;
      }
      // 同名同号（数据重复录了两次）：让人自己点一下
      prev.innerHTML = card(cands[0], false, `
        <div><dt>哪一次</dt><dd>${esc(fmtDateCN(parseKey(rc.date)))} ${esc(rc.start)}</dd></div>
        <div><dt>原因</dt><dd>${esc(rc.reasonText)}</dd></div>
        <div><dt>注意</dt><dd class="warn">队里有 ${cands.length} 人同名同号，点一下是谁</dd></div>`)
        + `<div class="rcpt-pick">${cands.map((p, i) => `<button type="button" data-pick="${i}">${esc(p.name)} · ${esc(p.position)}</button>`).join('')}</div>`;
      prev.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          cand = cands[Number(btn.dataset.pick)];
          prev.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b === btn));
          showTarget();
        };
      });
    };

    applyBtn.onclick = async () => {
      if (!cand || !rc || !target || !target.session) return;
      applyBtn.disabled = true;
      applyBtn.textContent = '登记中…';
      const monday = getMonday(parseKey(rc.date));
      // 云端模式：本周可能是懒加载的，先把服务器那份拉下来，别拿模板里的临时 id 去写
      if (CloudOn() && !Array.isArray(db.weeks[weekKey(monday)])) {
        try { await window.XGYCloud.syncWeek(weekKey(monday), true); } catch (e) { /* 拉不到就按本地写 */ }
      }
      const sessions = ensureWeek(monday);
      const hits = (sessions || []).filter((s) => s.date === rc.date);
      const s = hits.find((x) => x.start === rc.start) || hits[0];
      if (!s) { toast('那天没有训练安排，可能被删掉了', 'warn'); applyBtn.disabled = false; applyBtn.textContent = '登记为请假'; return; }
      if (s.status === 'cancelled') { toast('那次训练已取消，不用请假', 'warn'); applyBtn.disabled = false; applyBtn.textContent = '登记为请假'; return; }
      s.attendance[cand.id] = 'leave';
      s.updatedAt = Date.now();
      save();
      if (CloudOn()) cloudFire(window.XGYCloud.push.attSet(s.id, cand.id, 'leave'), () => window.XGYCloud.syncWeek(weekKey(monday), true).then(renderAttendance));
      state.weekMonday = monday;
      closeModal();
      go('attendance');
      toast(`${cand.name} · ${fmtMD(parseKey(s.date))} 已登记为请假`);
    };

    input.addEventListener('input', parse);
    if (prefill) { input.value = prefill; parse(); } else { setTimeout(() => input.focus(), 80); }
  }
