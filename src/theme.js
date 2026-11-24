/* ============================================================
 * theme —— 主题 / 阵型板常量
 *
 * 本文件是 app.js 的源码分片，由 build.mjs 拼接成单个 app.js。
 * 直接改 app.js 会在下次构建时被覆盖 —— 要改这里。
 * ============================================================ */
  /* ══════════ 主题 = 完整设计语言 ══════════
   * v72 起主题不只是配色：每套有自己的圆角、面板材质、字体、密度，
   * 形态 token 在 style.css 的 [data-theme] 块里覆盖。
   * p/s/base/ink/no 只用于选择器的球衣卡预览，不参与界面渲染。
   * 默认 graphite（黑白战术板）。v76 新增暴风玻璃 / 云境两套。 */
  const THEMES = [
    { id: 'graphite', name: '黑白', sub: '裁判条纹 · 战术板', p: '#8ba3c7', s: '#7fd4e8', base: '#151a22', ink: '#eef3fb', no: '07', style: '硬边 · 网格 · 等宽' },
    { id: 'paper', name: '秩序册', sub: '印刷白 · 靛蓝', p: '#5a55e8', s: '#0a90bd', base: '#f2f3f8', ink: '#1b1c33', no: '08', mode: 'light', style: '衬线 · 细线 · 高留白' },
    { id: 'sakura', name: '樱粉', sub: '春季邀请赛', p: '#f06fb0', s: '#b18cff', base: '#281424', ink: '#ffeaf5', no: '06', style: '柔和 · 辉光 · 精致' },
    { id: 'mint', name: '训练日', sub: '薄荷 · 湖蓝', p: '#0d8f6f', s: '#0b7ea3', base: '#eaf6f1', ink: '#0b3b2f', no: '10', mode: 'light', style: '圆润 · 透气 · 轻盈' },
    { id: 'collegiate', name: '学院', sub: '藏青 · 绯红', p: '#14284a', s: '#a62e38', base: '#f4f1e8', ink: '#1b2433', no: '11', mode: 'light', style: '衬线 · 队徽 · 荣誉感' },
    { id: 'storm-glass', name: '暴风玻璃', sub: '球场夜 · 液态玻璃', p: '#8fd8e8', s: '#d6f4fa', base: '#04121b', ink: '#eafaff', no: '12', style: '冷青 · 玻璃 · 聚光' },
    { id: 'cirrus-sky', name: '云境', sub: '晴空 · 轻盈白卡', p: '#3b82f6', s: '#111111', base: '#eaf3ff', ink: '#111111', no: '13', mode: 'light', style: '天空 · 白卡 · 黑胶囊' }
  ];
  const THEME_IDS = THEMES.map((t) => t.id);
  const isTheme = (v) => THEME_IDS.includes(v);

  /* ══════════ 阵型板常量 ══════════ */
  const FX_SIZE = 9;      // 半场 9 × 9 米
  const FX_SNAP = 0.25;   // 吸附精度
  const FX_MIN = 0.30;    // 边界内缩
  const FX_MAX = FX_SIZE - 0.30;

  const FX_ROLES = [
    { id: 'oh1', name: '主攻1', color: '#ff9f5c' },
    { id: 'oh2', name: '主攻2', color: '#fb7299' },
    { id: 'mb', name: '副攻', color: '#a89bff' },
    { id: 'opp', name: '接应', color: '#ffbb55' },
    { id: 's', name: '二传', color: '#46e0ff' },
    { id: 'lib', name: '自由人', color: '#37e39b' }
  ];

  const FX_FRONT_Y = 3; // 网到 3m 线之间是前排（y 从网起算）

  // 自由人轮转到前排（进入 3m 线内）时按排球规则换标牌：自由人→副攻2、原副攻→副攻1；
  // 纯显示层变化，不挪任何位置、不改数据 id（2026-11-03 用户拍板：保留各自颜色）
  function fxLibFront() {
    const p = db.formation.pos && db.formation.pos.lib;
    return !!p && p.y < FX_FRONT_Y;
  }
  function fxRoleName(id) {
    if (fxLibFront()) {
      if (id === 'lib') return '副攻2';
      if (id === 'mb') return '副攻1';
    }
    return FX_ROLES.find((r) => r.id === id).name;
  }

  // 仅作内部默认站位（「恢复默认」按钮 / 新建初始值用）；预设列表已移除，阵型全部由用户在「阵型库」自行保存
  const FX_PRESETS = {
    base: {
      label: '默认站位',
      pos: {
        s: { x: 6.30, y: 1.10 }, mb: { x: 4.50, y: 0.85 }, opp: { x: 2.60, y: 1.35 },
        oh1: { x: 1.80, y: 5.60 }, lib: { x: 4.50, y: 7.00 }, oh2: { x: 7.00, y: 5.90 }
      }
    }
  };

  function fxClamp(v) { return Math.min(FX_MAX, Math.max(FX_MIN, v)); }
  function fxSnap(v) { return fxClamp(Math.round(v / FX_SNAP) * FX_SNAP); }

  function blankFormation() {
    const pos = {};
    FX_ROLES.forEach((r) => { pos[r.id] = { x: FX_PRESETS.base.pos[r.id].x, y: FX_PRESETS.base.pos[r.id].y }; });
    return { version: 1, preset: 'base', name: '', pos };
  }

  function normalizeFormation(raw) {
    const base = blankFormation();
    if (!raw || typeof raw !== 'object' || !raw.pos) return base;
    const pos = {};
    FX_ROLES.forEach((r) => {
      const p = raw.pos[r.id];
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      pos[r.id] = {
        x: fxClamp(Number.isFinite(x) ? x : base.pos[r.id].x),
        y: fxClamp(Number.isFinite(y) ? y : base.pos[r.id].y)
      };
    });
    // name = 当前套用的是阵型库里哪一套（r33 标题统一用）；手动拖动会清掉
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 12) : '';
    return { version: 1, preset: FX_PRESETS[raw.preset] ? raw.preset : 'custom', name, pos };
  }
