/* ============================================================
 * ai —— AI 助手（BYOK 直连，OpenAI 兼容接口）
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ AI 助手（BYOK 直连，OpenAI 兼容接口） ══════════ */
  const AI_PRESETS = [
    { label: 'DeepSeek（推荐，便宜）', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { label: 'Kimi 月之暗面', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { label: '自定义（OpenAI 兼容）', base: '', model: '' }
  ];

  function aiCfg() {
    if (!db.settings.ai) db.settings.ai = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
    return db.settings.ai;
  }

  function aiUrl(base) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    return /chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
  }

  /** 组装喂给模型的全队上下文（只带必要字段，控制体积） */
  function aiContext() {
    const monday = state.page === 'dashboard' ? getMonday(new Date()) : state.weekMonday;
    const stats = weekStats(monday);
    const players = db.players.map((p) => {
      const att = stats.perPlayer.get(p.id) || {};
      return {
        姓名: p.name, 号码: p.number, 位置: p.position, 年级: p.grade, 身高cm: p.height,
        技能: SKILLS.reduce((o, s) => { o[s.label] = Number(p.skills[s.key]); return o; }, {}),
        本周: { 出勤: att.present || 0, 迟到: att.late || 0, 请假: att.leave || 0, 缺席: att.absent || 0 }
      };
    });
    const sessions = (db.weeks[weekKey(monday)] || []).map((s) => ({
      日期: s.date, 时间: `${s.start}-${s.end}`, 状态: s.status, 说明: s.cancelReason || s.venue || ''
    }));
    const logs = db.skillLogs.slice(-30).map((l) => {
      const pl = db.players.find((p) => p.id === l.playerId);
      const sk = SKILLS.find((s) => s.key === l.skill);
      return `${pl ? pl.name : '?'}：${sk ? sk.label : l.skill} ${l.before}→${l.after}（${l.date}）`;
    });
    return `# 球员（${players.length} 人）\n${JSON.stringify(players)}\n\n# 本周训练安排\n${JSON.stringify(sessions)}\n\n# 最近技能调整\n${logs.join('\n') || '（无）'}`;
  }

  const AI_SYSTEM = () => `你是一所高校院系排球队的助理教练。用户是队长。根据下面提供的真实数据回答问题、完成任务。
要求：用简体中文；语气自然、接地气，适合直接复制发到队群；只用数据里出现的信息，不要编造；人数、姓名、数字要和数据一致；回答尽量精炼。

${aiContext()}`;

  const AI_TASKS = [
    { id: 'week', icon: '📋', label: '本周小结', desc: '谁全勤、谁要提醒，一段话直接发群里', prompt: '根据本周训练安排和每个人的出勤数据，生成本周训练小结：谁全勤、谁迟到或缺席要点名提醒，再带一句下周鼓励。控制在 200 字以内，适合直接发群里。' },
    { id: 'lineup', icon: '🏐', label: '阵容建议', desc: '按身高和六项技能排 6 人首发站位', prompt: '根据队员的身高、位置和六项技能，给出一套周六友谊赛的 6 人首发站位建议（主攻×2、副攻、接应、二传、自由人各一），说明每条选择的理由；哪个位置缺人就直说，并给替补方案。' },
    { id: 'praise', icon: '⭐', label: '队员点评', desc: '选一名队员，生成鼓励式成长点评', prompt: '__PLAYER__' }
  ];

  function aiMsgHTML(role, text) {
    return `<div class="ai-msg ${role === 'user' ? 'me' : 'bot'}"><div class="ai-bubble">${text}</div></div>`;
  }

  function aiRender(text) {
    // 极简 markdown：转义后支持 **粗体**、`代码`、换行
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function aiQuickHTML() {
    return AI_TASKS.map((t) => `<button type="button" class="ai-task" data-task="${t.id}"><span>${t.icon}</span>${t.label}</button>`).join('') +
      `<button type="button" class="ai-task ai-clear" data-clear="1"><span>🧹</span>清空对话</button>`;
  }

  function bindTasks() {
    $$('#aiPageBody .ai-task[data-task]').forEach((btn) => {
      btn.onclick = () => {
        const t = AI_TASKS.find((x) => x.id === btn.dataset.task);
        if (t.id === 'praise') { renderAiPraisePicker(); return; }
        aiRun(t.prompt, t.label);
      };
    });
    const clr = $('#aiPageBody [data-clear]');
    if (clr) clr.onclick = () => {
      if (!state.ai.messages.length) return;
      state.ai.messages = [];
      db.aiChat = [];
      save();
      renderAiPage();
      toast('对话已清空');
    };
  }

  /** 聊天记录镜像进 db（localStorage 持久化），最多留 100 条 */
  function aiRemember() {
    db.aiChat = state.ai.messages.slice(-100);
    save();
  }

  /** 首条消息发出后把欢迎页换成精简任务条 */
  function mountQuick() {
    const shell = $('#aiShell');
    if (!shell || $('#aiTop')) return $('#aiTop');
    shell.querySelector('.ai-log').insertAdjacentHTML('afterend', `<div class="ai-quick" id="aiTop">${aiQuickHTML()}</div>`);
    bindTasks();
    return $('#aiTop');
  }

  function renderAiPage() {
    const cfg = aiCfg();
    if (!state.ai) state.ai = { messages: (db.aiChat || []).slice(), busy: false, abort: null };
    const body = $('#aiPageBody');
    if (!body) return;
    $('#aiSub').textContent = cfg.key
      ? (CloudOn() ? '带着全队的真实数据回答；Key 由服务器保管，浏览器不碰明文。' : '带着全队的真实数据回答：小结、阵容、点评，随口问也行。')
      : '先填一个 API Key（只存本机），一分钟就能用。';
    if (!cfg.key) { renderAiSettings(); return; }
    const hasMsg = state.ai.messages.length > 0;
    const hero = `
      <div class="ai-hero">
        <div class="ai-hero-ico">✦</div>
        <h3>你的助理教练已就位</h3>
        <p>它读得到全队名单、本周考勤和技能记录，<br>挑一个开始，或直接在下面提问：</p>
        <div class="ai-cards">
          ${AI_TASKS.map((t) => `<button type="button" class="ai-card" data-task="${t.id}"><span class="ai-card-ico">${t.icon}</span><b>${t.label}</b><i>${t.desc}</i></button>`).join('')}
        </div>
      </div>`;
    body.innerHTML = `
      <div class="ai-panel reveal">
        <div class="ai-shell" id="aiShell">
          <div class="ai-log" id="aiLog">${hasMsg ? state.ai.messages.map((m) => aiMsgHTML(m.role, aiRender(m.content))).join('') : hero}</div>
          ${hasMsg ? `<div class="ai-quick" id="aiTop">${aiQuickHTML()}</div>` : ''}
          <form class="ai-input" id="aiForm">
            <textarea id="aiText" rows="1" placeholder="输入问题，Enter 发送，Shift+Enter 换行"></textarea>
            <button type="submit" class="ai-send" id="aiSend" data-tip="发送">${state.ai.busy ? '■' : '↑'}</button>
          </form>
        </div>
      </div>`;
    bindTasks();
    wireAiChat();
    // 重渲染后必须刷新入场动画，否则 .reveal 元素一直 opacity:0（面板隐形）
    refreshReveals();
  }

  function aiSettingsHTML() {
    const cfg = aiCfg();
    const presetIdx = AI_PRESETS.findIndex((p) => p.base && p.base === cfg.base);
    const cloudNote = CloudOn()
      ? '云端模式：API Key 保存在球队的服务器上，请求由服务器转发给服务商，浏览器不接触明文 Key。已保存的 Key 显示为占位圆点，原样保存不会覆盖它，换填新 Key 才会更新。'
      : '自带钥匙（BYOK）：API Key 只存在你这台设备的浏览器里，请求由浏览器直连你选的服务商，不经过任何中间服务器。';
    return `<div class="ai-panel reveal"><div class="ai-settings">
      <div class="form-note" style="margin:2px 0 14px">${cloudNote}</div>
      <div class="field"><label>服务商</label><select id="aiPreset">${AI_PRESETS.map((p, i) => `<option value="${i}" ${i === (presetIdx < 0 ? AI_PRESETS.length - 1 : presetIdx) ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div class="field"><label>接口地址（Base URL）</label><input id="aiBase" value="${esc(cfg.base)}" placeholder="https://api.deepseek.com"></div>
      <div class="field"><label>模型</label><input id="aiModel" value="${esc(cfg.model)}" placeholder="deepseek-chat"></div>
      <div class="field"><label>API Key</label><input id="aiKey" type="password" value="${esc(cfg.key)}" placeholder="sk-..." autocomplete="off"></div>
      <div class="form-note">DeepSeek 的 Key 在 platform.deepseek.com 充几块钱就够用一学期。</div>
      <div class="form-foot"><button type="button" class="btn btn-primary" id="aiSave">保存并开始</button></div>
    </div></div>`;
  }

  function renderAiSettings() {
    $('#aiPageBody').innerHTML = aiSettingsHTML();
    wireAiSettings();
    refreshReveals();
  }

  function wireAiSettings() {
    const sel = $('#aiPreset');
    sel.onchange = () => {
      const p = AI_PRESETS[Number(sel.value)];
      if (p.base) { $('#aiBase').value = p.base; $('#aiModel').value = p.model; }
    };
    $('#aiSave').onclick = () => {
      const cfg = aiCfg();
      cfg.base = $('#aiBase').value.trim() || 'https://api.deepseek.com';
      cfg.model = $('#aiModel').value.trim() || 'deepseek-chat';
      cfg.key = $('#aiKey').value.trim();
      if (!cfg.key) { toast('API Key 还没填', 'warn'); return; }
      db.aiChat = [];
      save();
      if (CloudOn()) cloudFire(window.XGYCloud.push.settingsAi({ base: cfg.base, model: cfg.model, key: cfg.key }), null);
      state.ai = { messages: [], busy: false, abort: null };
      toast('AI 助手已就绪');
      renderAiPage();
    };
  }

  function wireAiChat() {
    const form = $('#aiForm');
    const ta = $('#aiText');
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (state.ai.busy) { if (state.ai.abort) state.ai.abort.abort(); return; }
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      ta.style.height = 'auto';
      aiRun(text);
      ta.focus();
    };
    const log = $('#aiLog');
    log.scrollTop = log.scrollHeight;
  }

  function renderAiPraisePicker() {
    const top = mountQuick() || $('#aiPageBody');
    if (!top || $('#aiPicker')) return;
    top.insertAdjacentHTML('beforeend', `<div class="ai-picker" id="aiPicker"><b>点评谁？</b><div>${db.players.map((p) => `<button type="button" data-id="${p.id}">${esc(p.name)}</button>`).join('') || '<span class="ip-tag warn">先添加队员</span>'}<button type="button" class="x" data-x="1">取消</button></div></div>`);
    const picker = $('#aiPicker');
    picker.querySelectorAll('button[data-id]').forEach((b) => {
      b.onclick = () => {
        const p = getPlayer(b.dataset.id);
        picker.remove();
        if (!p) return;
        aiRun(`给 ${p.name}（${p.position}，${p.grade}）写一段 60 字以内的鼓励式点评：先夸他最突出的一项技能和近期出勤，再点出最值得练的一项，语气像队长说话，最后加一个具体可行的小目标。`, `点评 · ${p.name}`);
      };
    });
    picker.querySelector('button[data-x]').onclick = () => picker.remove();
  }

  async function aiRun(prompt, label) {
    const cfg = aiCfg();
    if (!cfg.key) { renderAiSettings(); return; }
    if (state.ai.busy) return;
    state.ai.messages.push({ role: 'user', content: label ? `【${label}】${prompt}` : prompt });
    aiRemember();
    state.ai.busy = true;
    // 页面可能被切走，每次都现查节点，避免引用已销毁的 DOM
    const $log = () => $('#aiLog');
    const log = $log();
    if (log) {
      log.querySelector('.ai-hero') && (log.innerHTML = '');
      mountQuick();
      log.insertAdjacentHTML('beforeend', aiMsgHTML('user', aiRender(state.ai.messages[state.ai.messages.length - 1].content)));
      log.insertAdjacentHTML('beforeend', `<div class="ai-msg bot" id="aiStreaming"><div class="ai-bubble"><span class="ai-dot"></span></div></div>`);
      log.scrollTop = log.scrollHeight;
    }
    const send = $('#aiSend');
    if (send) { send.textContent = '■'; send.dataset.tip = '停止'; }

    const messages = [
      { role: 'system', content: AI_SYSTEM() },
      ...state.ai.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
    ];
    state.ai.abort = new AbortController();
    let full = '';
    try {
      // 云端模式：Key 只在服务器上，走 /api/ai/chat 代理（SSE 流原样透传）；
      // 本地模式：浏览器带着本机存的 Key 直连服务商。
      const res = CloudOn()
        ? await window.XGYCloud.aiChat({ messages, temperature: 0.7 }, state.ai.abort.signal)
        : await fetch(aiUrl(cfg.base), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
            body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.7 }),
            signal: state.ai.abort.signal
          });
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = j.error && (j.error.message || j.error.code) || j.message || ''; } catch (err) { /* ignore */ }
        throw new Error(`HTTP ${res.status}${detail ? `：${detail}` : ''}${res.status === 401 ? '（Key 不对或已过期）' : res.status === 402 ? '（余额不足）' : ''}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) full += delta;
          } catch (err) { /* 忽略不完整行 */ }
        }
        const node = $('#aiStreaming .ai-bubble');
        if (node && full) node.innerHTML = aiRender(full);
        const lg = $log();
        if (lg) lg.scrollTop = lg.scrollHeight;
      }
      state.ai.messages.push({ role: 'assistant', content: full || '（空回复）' });
    } catch (err) {
      const aborted = err.name === 'AbortError';
      if (aborted && full) {
        state.ai.messages.push({ role: 'assistant', content: full });
      } else {
        const msg = aborted ? '已停止生成。' : `请求失败：${err.message}。检查接口地址 / Key / 余额；浏览器直连被拦时换 Chrome 或 Edge 试试。`;
        state.ai.messages.push({ role: 'assistant', content: msg });
      }
    } finally {
      state.ai.busy = false;
      state.ai.abort = null;
      aiRemember();
      const streamNode = $('#aiStreaming');
      if (streamNode) {
        const wrap = document.createElement('div');
        wrap.innerHTML = aiMsgHTML('assistant', aiRender(state.ai.messages[state.ai.messages.length - 1].content));
        streamNode.replaceWith(wrap.firstElementChild);
      }
      const sd = $('#aiSend');
      if (sd) { sd.textContent = '↑'; sd.dataset.tip = '发送'; }
      const lg = $log();
      if (lg) lg.scrollTop = lg.scrollHeight;
    }
  }
