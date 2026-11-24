# 更新日志

记录**面向使用者的发布级变更**。日常 UI 微调（提交信息里的 `r35.x`）不留在这里，看 `git log` 和 `sw.js` 头部注释。

## 版本号怎么读

项目里同时存在三套编号，别混用：

| 标识 | 位置 | 含义 | 是否每次发版都变 |
|---|---|---|---|
| `1.0.0` | `package.json` | 仓库发行版，给 `npm` 和对外介绍用 | 否 |
| `vN` | `sw.js` 的 `VERSION` | **实际发布的版本号，唯一真源**。决定缓存名 `xgy-pwa-vN`，`build.mjs` 用它给 HTML 引用和 SW 预缓存统一注入 `?v=N` | 是（仅前端资源变动时） |
| `r35.x` / `r28` | 提交信息 | 开发期迭代编号，便于回溯一次改动，不是版本号 | 否 |

**发版流程**：改 `sw.js` 的 `VERSION` 并在头部注释加一行 → `node build.mjs`（刷新 HTML 引用与单文件内联）→ `npm run test:all` → commit / push → CI 绿了才由 `deploy.yml` 部署 → 线上核实 `?v=N` 与 `sw.js` 版本一致。

## v76 · 2026-11-24 —— 新增两套完整主题：暴风玻璃 / 云境

主题从 5 套扩到 **7 套**，编号 12「暴风玻璃」（夜场照片 + 液态玻璃毛玻璃）、
编号 13「云境」（晴空白卡 + 发丝边框 + 黑胶囊，Cirrus 设计语言）。两套都含
`[data-theme]` token、六页选择器覆盖和主题选择器预览卡，切换只换外观不动数据。

- **后端白名单同步**：上次 v73 漏 `collegiate` 导致云端同步 400，这次新增两套时提前补上——
  `server/src/routes/settings.ts`、`server/src/routes/import.ts` 两处白名单 + 前端主题一致性测试
  （`server/tests/formation-settings.test.ts`）都已纳入新 id，避免重蹈覆辙。
- **依赖资源**：暴风玻璃读取 `assets/court-night.jpg`（单文件 HTML 已 base64 内联该图）。
- **验证**：`npm run test:all` 全绿（后端 208/208、前端纯函数 54/54、e2e 5/5）。

后端 / 文档 / CI 的改动不 bump `vN`：它们不进 SW 预缓存，版本号变了反而会白清一次用户缓存。这类变更在下面按日期记，不打版本标签。

## 前端源码分片 · 2026-11-16（不 bump vN）

**app.js 从 5000 行单文件拆成 src/ 下 15 个领域分片**

- 动机：app.js 全在一个 IIFE 里，靠命名约定而非模块边界维持，继续加功能会成主要摩擦点。
- 方案：**源码分片 + 构建拼接**，产物形态完全不变（还是一个 app.js、一个 IIFE）。
  为什么不直接上 ESM：① `tests/load-app.mjs` 用 `node:vm` 加载单个 app.js 跑纯函数测试，
  产物形态变了那套测试要重写；② 单文件分发版需要内联一段完整 JS。保持 app.js 是单文件，
  这两件事都不用动。**维护**这件事从「5000 行一个文件」变成「按领域分的一堆文件」。
- 拆分依据：app.js 顶层那些 `═══ 区块注释`（40 个），每个区块是一个完整领域。
  按领域归并成 15 个文件，切分工具 `tools/split-app.mjs`（--dry 可先看计划）。
- 踩了三个坑，都写进了 `docs/前端源码结构.md`：
  1. **按领域重排分片 → 直接炸**：`ReferenceError: Cannot access 'FX_ROLES' before initialization`。
     JS 的 const/let 有 TDZ，`blankDB()` 在模块加载期就调 `blankFormation()`，
     后者依赖 theme 里的 `FX_ROLES`。**分片顺序必须等于原文行序。**
  2. **切分源不能读磁盘上的 app.js**：它是构建产物，会被 build 覆盖。调试时残留的多余空行
     会在「切分→构建→再切分」之间**累积**（最后产物比原文多 25 行，且看不出是哪步引入）。
     改成用 `git show HEAD:app.js` 取源，拿不到就报错退出。
  3. **段落合并必须「紧邻」**：只判「同归属」会让 core 的区间跨越 theme 的内容，
     同一段代码出现两次。
- 验证：拆分后产物与原 app.js **逐字节一致**（4759 行归一化后完全相同，
  构建输出 `guard: app.js 与 HEAD 版本逐字节一致 ✅`）；
  单文件 HTML 762.3 KB（与拆分前一致，体积增长 0%）；
  测试 199 后端单测 + 54 纯函数 + 5 e2e 全绿。
- 产物是 app.js 但**源码是 src/**：改代码改 `src/` 下的分片，`npm run build` 自动拼接。
  build 里加了一道守卫，把拼接产物与 `git show HEAD:app.js` 做字节级比较。

## 安全与可达性 · 2026-11-16（不 bump vN）

**生产环境强制 JWT_SECRET，缺失即拒绝启动**

- 背景：开发默认密钥 `dev-only-secret-change-me` 写在公开仓库里，拿到它就能签一个 `uid=admin` 的 token 冒充管理员。之前缺配置只是 `console.warn`——服务照常启动、接口全通、看起来完全正常。这种「配漏了但系统照常工作」的失败模式，要等到用户被伪造登录才暴露。
- 改动：新增 `assertSecretConfigured()`，在启动入口（`server/src/index.ts`，**`app.listen` 之前**）调用。`NODE_ENV=production`（或显式 `JWT_REQUIRE_SECRET=1`）时生效：密钥缺失 / 仍是开发默认值 / 短于 16 位，三种情况都直接抛错退出（exit 1）。本地开发与测试不受影响（测试由 `tests/setup.ts` 注入固定密钥）。
- 校验前先只读探过线上：用默认密钥签的 token 请求线上 `/api/auth/me` 同样验签失败 → 线上用的是真密钥，这次改动不会影响在跑的服务。
- 验证：新增 8 条单测（含一条源码断言：校验调用点必须排在 `app.listen` 之前，否则函数只是摆设），后端 199 → 207。另外用子进程实跑四个场景确认行为：生产+缺密钥 → exit 1；生产+默认值 → exit 1；生产+太短 → exit 1；生产+合规 → 正常启动。
- **补交两份文档**：`docs/从零到一搭建解析.md`、`docs/面试问题全景.md` —— 之前写完忘了 `git add`，在未跟踪状态躺了 6 天。

**跨境可达性：复测 + 根治方案定案（未实施，需账号侧操作）**

- 复测（2026-11-16，上海移动 AS9808 → 阿里云新加坡 AS45102，与当初丢包场景同一条链路）：真实 Chromium 下 `vb.bscjs.top` **16/16 成功**、`csp.bscjs.top` 10/10 成功；复刻 CHANGELOG 的对照实验，默认 TLS **6/6**（当初是 0/6）、强制 TLS1.2 也 6/6。
- 结论：丢包是**间歇性**的，不是持续故障——「现在能打开」不能证明「以后也能打开」。这正是要上 CDN 的理由：把间歇性故障变成有冗余的稳定路径，而不是靠 `npm run proxy` 兜着。
- 方案定案（用户选定）：把 `bscjs.top` 接到 Cloudflare 免费版，**只有 `vb.bscjs.top` 开橙云走 CDN**，`csp.bscjs.top` 与 `vigil.bscjs.top` 保持灰云直连（解析结果不变，对用户无感知）。一次只解决一个问题。
- 产出：`docs/Cloudflare接入手册.md`（含迁移前 DNS 快照、逐步操作、`Full (strict)` 与 `sw.js` Bypass 规则、验证清单、回滚路径）与 `tools/cf-precheck.mjs`（`--verify` 复检模式会核对橙云/灰云是否配对、`sw.js` 是否被缓存、manifest MIME 是否正确）。
- **本项未实施**：改 NS 需登录 Cloudflare 与阿里云两个平台，无法代劳。按手册由用户手动执行。

## 工具与测试 · 2026-11-16（不 bump vN）

**应急代理能自证清白，按需模块清单有守卫**

- `npm run proxy -- --check`：不占端口、不启动服务，用与代理相同的强制 TLS 1.2 通道打 `/api/health`；可达打印 `HTTP 200 / 耗时` 退出 0，不可达给出「服务器可能正常，也可能是本机网络 / 跨境链路问题」的交叉核对提示并退出 1。正常启动也异步自检一次；非 8787 端口会提示登录页要手填地址。实测真实上游 `200 / 396ms`、不可达 IP 退出 1。
- `tests/proxy.test.mjs` 补 6 条：自检文案三种结果 + **按需模块四处清单守卫**（`app.js` 的 `MODS` / 模块文件与全局名 / `build.mjs` 的 `lazyMods` / `ASSET_RE`）。以前新增按需模块漏改其中一处，症状是发版后 404，只能靠线上验收撞见。
- 对照实验：临时从 `lazyMods` 摘掉 `courtcard`，只有「同一批模块」这一条精确变红（14 过 1 挂），随后恢复，恢复后 15/15 全绿。
- 纯函数 48 → 54，CI 单测 247 → 253。**均为工具 / 测试改动，不进 SW 预缓存**，前端资源零改动，`sw.js` 保持 `v70`。

## 后端主题白名单补漏 · 2026-11-23（不 bump vN）

**修复：学院风主题云端同步 400**

- 用户报「云端同步失败：theme: Invalid enum value … received 'collegiate'」。v73 加学院风主题时只改了前端，`server/src/routes/settings.ts` 的 zod 枚举和 `import.ts` 的 THEMES 白名单没同步，换到学院风的队伍每次同步都被服务器拒绝。
- 两处补上 `collegiate`；新增回归测试：前端在用的每个主题 id（graphite/paper/sakura/mint/collegiate）逐个过 `PUT /api/settings/theme` 必须 200。以后加主题前后端要一起改，这条测试会当场变红。
- 单测 207 → 208 全绿。前端资源零改动，`sw.js` 保持 v75。

## v75 · 2026-11-23

**学院风头像色改按综合分映射**

- 用户指出 v74 的藏青深浅是按「位置/卡片序号」给的，但他要的是「综合技能得分高的颜色深、低的浅」。
- `src/players.js` 的卡片模板注入 `--ov`（综合分），`style.css` 用 `color-mix` 在 3 分（浅 `#3f6096`）到 9 分（深 `#0b1a33`）之间连续插值，写进 `--a/--b`。技能条沿 `--a` 同步变深。浅端亮度仍保证白字可读。
- 验证：真 Edge 注入 3.3 / 4.6 / 5.8 / 7.1 / 8.3 五名队员，头像实际渲染亮度 89 → 74.9 → 61.9 → 47.7 → 34.7 严格递减；零 JS 异常。

## v74 · 2026-11-23

**学院风（Collegiate）队员卡收敛配色 + 换掉玻璃扫光**

- 起因：用户看 v73 实机截图指出「颜色太杂、很乱」——原 `ROLE_STYLE` 五套位置色（橙/紫/青/粉/绿）打在象牙白荣誉墙底上像调色盘。
- 队员卡改用同一支藏青的五级色阶（`#14284a` → `#3b60a3`），按卡片序号循环；技能条 6 格跟随各自卡片深浅，只靠透明度表达数值，不再出现位置彩虹。
- 学院风中头像文字统一改象牙白（深底白字），头字用衬线体并跟主题方角；考勤/技能页的小头像也收进藏青同色系。
- hover 从斜向玻璃反射 + 指针聚光改成**左侧绯红绶带展开 + 双线描边上浮 3px**，并关掉跟随鼠标的 3D 倾斜（荣誉墙不需要夜店灯球）。其余四套主题零影响。
- 验证：真 Edge 注入 10 名队员实测五档 `--a/--b` 递进、技能条色随卡片、hover 伪元素 scaleY(1) + translateY(-3px) + 双线阴影，零 JS 异常。

## v73 · 2026-11-22

**新增第五套界面风格「学院」（Collegiate）**

- 用户从五套新风格 demo 中看中学院荣誉墙，要求加进 systems 当可切换主题。
- 视觉语言：藏青主色 + 象牙白底 + 绯红/金点缀，衬线标题（Georgia/宋体）、双线边框、低圆角 2px、仪式感留白；hero 为藏青底，内部文字统一改浅色以保证可读。
- 主题选择器从四张风格卡变五张，新增第五张迷你预览（象牙底 + 衬线号码 + 绯红徽记）。
- 语义色（出勤绿/缺席红/提醒琥珀）未动；默认仍是 graphite；云端同步、E2E-4 主题测试均不受影响。
- 顺手修了一个历史 bug：`.theme-card.on::after{content://}` 是无效 CSS（应为 `content:""`），选中态那圈描边其实一直没渲染。
- 验证：真 Edge 5 卡 + 切换后 data-theme/data-mode 正确 + 形态 token 生效 + 零 JS 异常；全套 207+54+5 全绿。

## v72 · 2026-11-21

**主题升级为四套完整设计语言 —— 换主题 = 换整套界面风格**

- **起因**：用户指出 v71 只是「换颜色」，要求真正的风格切换；圈定保留 paper / mint / graphite / sakura 四套，删掉其余 6 套配色变体。参考了用户给的设计系统截图（Meridian / Reverie / Orbit Index / Meadowlark / Emberspire / Aether 等）与 uiverse.io。
- **四套设计语言**（每套有独立的圆角、面板材质、字体、边框、密度、光晕）：
  - `graphite` 黑白战术板：方角 2/4/6px、无模糊无光晕、深黑底、紧凑（默认）
  - `paper` 秩序册：衬线标题（Georgia/Songti）、纸白底、细线、4px 圆角、高留白
  - `sakura` 樱粉：深粉紫底、14/20px 圆角、渐变玻璃、柔和辉光
  - `mint` 训练日：12/18/28px 大圆角、浅绿底、半透明面板、轻盈透气
- **实现**：新增形态 token（`--radius-sm/md/lg`、`--panel-bg/blur/shadow`、`--edge`、`--font-display`、`--pad-panel`、`--glow-*`），106 处硬编码圆角改为 token；hero 背景、面板、标题、按钮阴影全部接入。选择器从球衣卡改为迷你界面预览卡，2×2 平铺，点之前就看得见风格差异。
- **清理**：删除 v55 主题迁移（aurora→court，两套都已不存在）；默认主题 court→graphite；E2E-4 的主题引用从 sand/court 改成 mint/graphite；去掉 hero 渐变文字（impeccable craft-floor 拒绝项）。
- **验证**：真 Edge 四套截图 + 形态数据（paper 衬线生效、graphite 4px vs mint 18px 圆角、sakura 渐变面板）；4 张风格卡、零 JS 异常；全套 207 后端 + 54 纯函数 + 5 e2e 全绿（E2E-4 修完）；impeccable detect 139 条与改前持平（无新增告警）。

## v71 · 2026-11-20

**主题切换 UI 重做：从「SaaS 色板」改为「球队球衣」**

- **为什么改**：旧版十张卡顶着一模一样的渐变色带、清一色圆角玻璃卡、整屏模糊——典型 AI 模板观感，跟排球队没有语义关联。用户明确要求删除这类泛化视觉，保留切换逻辑与球队信息表达。
- **新设计**：每张卡是一枚球衣——斜切主辅色块 + Impact 斜体大号码（01–10）+ 球场语境命名（主场 / 夜场 / 客场 / 草地 / 黄昏 / 樱粉 / 黑白 / 秩序册 / 沙滩 / 训练日）。主场卡单独置顶，其余 3×3，解决十张卡掉单。
- **删掉的 AI 味**：主题卡的渐变色带、径向高光、圆角堆叠、选中发光；弹窗背景的 8px 模糊、渐变底、22px 圆角、巨型阴影；号码牌顶部语义不明的半圆装饰。色块改用 `color-mix` 跟底色混 18% 压掉霓虹感。
- **一致性**：主题弹窗用专属 `.theme-modal` 固定深色展板——球衣卡在任何主题下都有统一展示背景（浅底会让浅色球衣融进背景）。勾选标识统一白底，不随主题变色。语义色（出勤绿 / 缺席红 / 提醒琥珀）全程未动。
- **诚实边界**：独立视觉评审 6/10，指出"球衣色块本质仍是色卡，受限于纯 CSS 画球衣"——接受，这是方案上限；评审建议"浅色主题弹窗该变浅底"未采纳，理由如上。全局 toast 堆叠未在本次修改（超出主题 UI 范围）。
- **改文件**：`src/theme.js`（主题元数据）、`src/settings.js`（弹窗结构 + 球衣卡）、`src/ui.js`（openModal 支持自定义 class）、`style.css`（球衣卡 + 弹窗样式）。**注意**：`app.js` 是 `src/` 分片拼出的产物，直接改会被构建覆盖。
- **验证**：真 Edge 三套主题截图（主场 / 夜场 / 秩序册），10 张球衣卡 + 切换后 `data-theme`/`data-mode` 正确 + 零 JS 异常；全套测试 207 后端 + 54 纯函数 + 5 e2e 全绿（E2E-4 专测主题切换）。

## v70 · 2026-11-14

**新增：SW 装好新版本后页面提示「立即重载」**

- **现象**：`sw.js` 的 `skipWaiting()` + `clients.claim()` 会让新 SW 立刻接管，但已打开的页面仍跑旧 HTML/JS。v67 / v68 / v69 三次发版，都要用户 F12 → Application → Unregister → Ctrl+F5 才能看到新界面。
- **改动**：`app.js` 新增 `watchSwUpdate(reg)`，监听 `updatefound` / `waiting`，**仅在已有 controller 时**弹「发现新版本 · 立即重载」；首次安装不提示，也**不自动 reload**（会打断未保存的考勤 / 阵型）。页面可见时主动 `reg.update()` 查一次，断网静默跳过。`style.css` 复用 `.pwa-install` 外壳，`.sw-update` 上移 88px 避免与安装引导条叠加。
- **诚实边界**：这条改不了「跨境链路丢弃 TLS 1.3 ClientHello」。旧 SW 拿不到新 HTML 时提示根本不会出现，**第一次仍需手动注销一次 SW**；此后每次发版自动提示。根治链路见下方 2026-11-11 条目，属产品决策。
- **同批发版但不单独 bump 的两项**：① `tools/local-proxy.mjs` 把此前只放在 `preview/`（gitignore）的 TLS 1.2 本地应急代理收进仓库，加 `npm run proxy`；② `tests/proxy.test.mjs` 补 9 条纯函数断言，含「改了 `VERSION` 忘跑 `build.mjs` 就变红」的版本一致性守卫。两者不进 SW 预缓存，不另起版本号。
- **验证**：`npm run test:all` 全绿（199 后端单测 + 48 纯函数 + 5 e2e）；`node build.mjs` 重生成单文件 762.3 KB，`index.html` 与 SHELL 的 `?v=` 全部刷到 `v70`。

## 服务端配置 · 2026-11-11（不 bump vN）

**修复两处线上缺陷，前端代码零改动**

- **关掉 HTTP/3**：Caddy 默认启用 h3 并下发 `Alt-Svc: h3=":443"; ma=2592000`，浏览器记住后 30 天内优先走 QUIC/UDP 443，跨境链路常被丢包。全局 `servers { protocols h1 h2 }` 关掉，并给 vb 站点下发 `Alt-Svc: clear` 清掉已有缓存记录。
- **修 PWA 清单 404**：`handle /m*` 是前缀匹配，把 `/manifest.webmanifest` 一并反代到 Express（文件其实一直都在 web 目录）。拆成 `handle /m` + `handle /m/*`；顺手补 `Content-Type: application/manifest+json`（Go 的 mime 库不认识 `.webmanifest`，会回落 `text/plain`）。
- **运维通道**：本机到服务器 22 端口被跨境链路重置，改由 `server-ops.yml` 借 GitHub Actions runner 的 SSH 执行 `deploy/server-ops.sh`。四个动作 `probe / fix / tls12 / undo-tls12` 都先备份 Caddyfile，`caddy validate` 或 reload 失败自动回滚。服务器配置与 `deploy/Caddyfile` 副本已对齐。
- **验证**：线上 `Alt-Svc: clear`、manifest 200 且 MIME 正确、`/admin` `/m/` `/api/health/deep` 全绿；真 Edge 跑 `LIVE_TLS12=1 node preview/verify-live.mjs` 全绿（v67、三帧 WebP、按需 `courtcard.js`、750×1220 阵型导出、零 JS 异常 / 零失败请求）。

**遗留（非代码问题，别再往 Caddy 方向查）**：这条跨境链路会稳定丢弃 Chromium 的 **TLS 1.3 ClientHello**——交错对照实验「默认 TLS 0/6」、客户端加 `--ssl-version-max=tls1.2` 则「6/6 稳定打开（1.0–2.1s）」，而 curl 的 TLS 1.3 能通，说明是按 ClientHello 特征选择性丢包。服务端把 Caddy 限制为只协商 TLS 1.2 的实验**无效**（默认浏览器仍 0/6，因为服务器根本收不到那个包），已回滚，TLS 1.3 恢复。真正根治要换线路 / 套 CDN / 换 IP，属产品决策，未擅自实施。

## v69 · 2026-11-12

**修复：跨队 / 换号后历史周、AI 会话、AI 配置残留（主题串色的同源问题）**

- **现象**：沿用 v68 的排查继续审计发现，`applyServerState()` 是「按字段增量覆盖」而内存 `db` 是单例，只有 `logout()` 会 `reloadLocal()` 换成本机那份。于是换队时若干带 `if` 守卫的字段会沿用上一份库的值。
- **影响最重的是周数据**：`/api/weeks/all` 只返回**该队**有的周，旧代码只逐 key 覆盖、从不删旧 key，本机库或上一队独有的周会留在 `db.weeks`；赛季统计遍历 `Object.keys(db.weeks)` 会把别队的训练与出勤算进来，`save()` 还会把脏数据写进新球队 scope 的缓存，刷新后仍在。此外 `aiChat` 完全不清（A 队聊天记录出现在 B 队 AI 面板）、`settings.ai` 在服务器返回 `ai: null`（该队没配过 AI）时不覆盖（「已配置」状态残留）。
- **改动**：`applyServerState()` 里 `db.weeks` 改为整份重建、`db.settings.ai` 无条件以服务器为准；`cloud.js` 的 `pullCore(freshTeam)` 在身份变化时调 `hooks.resetForTeam()`——重建 `blankDB()` 骨架、清空 AI 面板的 `state.ai`（含中止进行中的请求）、取消阵型防抖定时器；`switchTeam` / `finishLogin` 传 `true`，`switchTeam` 另把 `lastTouch` 归零重新定轮询基线。同队内的手动同步 / 15 秒轮询仍走增量路径，保护期语义不变。
- **验证**：新增 `E2E-5`——往「本机那份」无后缀库注入一条带考勤的历史周、一条 AI 会话、一个假 Key，退出后**不刷新页面**重登，断言三项都不出现在新 scope 缓存里。`npm run test:all` 全绿（199 后端单测 + 39 纯函数 + 5 e2e）；对照实验：把 `app.js`/`cloud.js` 临时换回 v68 只跑 e2e，E2E-5 精确失败在「上一份库的历史周不得残留」（残留的是带 `attendance` 的真实训练记录），前四条仍过，随后恢复修复版。
- 前端源码变了必须 bump `vN`；已登录用户若仍显示旧版，需注销一次 Service Worker 再硬刷新。

## v68 · 2026-11-12

**修复：跨队 / 换号登录后主题色串色**

- **现象**：在 A 队刚把主题改成「暖砂」，退出后 60 秒内登录 B 队，主题弹窗显示选中「素纸」，界面却仍渲染暖砂。
- **定位**：选中态读内存 `db.settings.theme`，真实配色读 `<html data-theme>`，云端登录不刷新页面、启动时的 `applyTheme()` 不会再跑。三个缺口叠加：① `applyServerState()` 只在「采用服务器值」时刷 DOM，而 60s 保护期内整段跳过；② `logout()` 的 `reloadLocal()` 换 db 不刷 DOM；③ 保护期是全局时间戳、不区分队伍，但主题在服务端按 `team_id` 存。
- **改动**：`applyServerState()` 段后无条件 `applyTheme(db.settings.theme)`；`reloadLocal()` 退出时也刷新配色；新增 `resetSettingsGrace()`，在 `runAuth` / `switchTeam` / `logout` 三处清零。同队内「自己刚改、PUT 还在排队」的保护期语义不变。
- **验证**：新增 `E2E-4`（真后端 + 真浏览器，不刷新页面的退出→重登，断言「配色 === 服务器该队主题 === 弹窗选中」）。`npm run test:all` 全绿（199 后端单测 + 39 纯函数 + 4 e2e）；对照实验：把 `app.js`/`cloud.js` 临时换回修复前 `HEAD` 只跑 e2e，E2E-4 精确失败 `'sand' !== 'court'`、前三条仍过，随后恢复修复版。
- 前端源码变了必须 bump `vN`，否则 SW 预缓存会让用户继续拿旧 HTML；已登录用户若仍显示旧版，需注销一次 Service Worker 再硬刷新。

## v67 · 2026-11-11

**变更：登录前品牌中性化，修掉多球队串队**

- **现象**：首屏加载界面、登录门禁、页脚版权、页面标题、PWA 清单都写死「信工院排球队」。系统其实早有队名（后端 `teams.name`、管理端建队填队名、登录后 `applyBrand()` 覆盖顶栏与页脚），但**登录之前拿不到队名，本地模式更没有队名字段**——于是 A 队教练登录前看到 B 队名字，登录完又突然跳变。
- **改动**：登录前 / 本地模式一律显示中性名「排球队管理系统」；登录云端后仍显示账号所属球队名。9 个源文件共 30 处硬编码统一替换，`cloud.js` 的 `document.title` 改条件式。`build.mjs` 产物文件名与 README 引用本期不改（仓库产物名 ≠ 界面品牌）。
- **验证**：`npm run test:all` 全绿（后端 199 单测 + 39 纯函数 + 3 e2e）；新增 `preview/verify-brand.mjs` 用真 Edge 验收首屏 / 主界面 / 门禁三屏文案、零横向溢出、零 JS 异常；WebP 三场景零退化。
- 改了前端源码就必须 bump `vN`：SHELL 预缓存了 `index.html`/`style.css`/`app.js`/`cloud.js`/`manifest`，不 bump 用户 SW 会一直拿旧 HTML。

## v66 · 2026-11-09

**修复：登录云端卡在「登录中…」**

- **现象**：用本地单文件 `file://` 打开、再填线上服务器地址登录时，POST 发出去后浏览器不给任何响应，按钮永远停在「登录中…」；线上站点同源登录正常（实测 1.4 秒返回）。
- **定位**：`file://` 是不透明源，浏览器在这个环境里会挂起跨站请求——连简单 GET `/api/health` 也一样，CDP 里只有请求、没有响应。CORS 预检本身正常（OPTIONS 204 带完整头），登录接口也正常（错误账号 401 JSON）。**不是账号、密码、服务器或 CORS 配置的问题**。
- **改动**：`cloud.js` 的 `api()` 统一 15 秒超时（AbortController），挂起时抛「服务器没有响应…检查网络/代理，或换系统浏览器重试」；`file://` 下打开登录弹窗直接提示改用线上完整版；正常 401 等错误路径一字未动。
- **验证**：`preview/verify-timeout.mjs` 两场景——挂起请求 15 秒恢复按钮并给出明确提示、正常 401 仍在 2 秒内恢复。
- 改了前端源码就必须 bump `vN`，否则 SW 静态缓存优先会让用户继续拿旧代码。

## v65 · 2026-11-09

**功能**
- 阵型板新增「导出图片」：把当前 6 个角色位画成 750×1220 PNG，可发群里讲站位。零依赖手写 canvas（`courtcard.js`），按需加载，不进冷启动；本机生成、不经过服务器，手机上长按即可保存。
- 单文件版同样可用：`build.mjs` 把 `courtcard.js` 内联，验证脚本实测 `file://` 下 0 次外部请求、`http://` 下动态注入 1 次。

**性能**
- 首屏三帧加载动画 PNG → WebP（q90），合计 `56.4KB → 32.9KB`（-23.5KB）。保留 PNG 作 `onerror` 回退，单文件版两个源都内联成 data URI。
- 没用 `<picture>`：三帧靠 `.boot-frame:nth-child(1/2/3)` 排动画延迟，换成 picture 会让三张都变成 `nth-child(1)`。验证脚本覆盖正常 / WebP 全 404 / 单文件三场景，三档延迟仍为 `0s / -0.6s / -1.2s`。

**安全**
- 补 `server/src/security.ts` 自研响应头中间件（`nosniff` / `SAMEORIGIN` / `Referrer-Policy` / `Permissions-Policy`，HTTPS 下加 HSTS），挂在所有中间件之前，404 和错误响应也带。
- **刻意不下发 CSP**：三端页面都是内联脚本，默认 CSP 会打白页面；**不引 helmet**，避免为一个 6 行中间件加依赖。5 条测试锁死这两个约束。

**测试与文档**
- 新增 `tests/courtcard.test.mjs` 9 条（米→像素换算、坐标夹取、角色短标），用 `vm` 加载真实 `courtcard.js`；`test:pure` 改跑 `tests/*.test.mjs`，新测试自动进 CI。
- 单测合计 **238**（199 后端 + 39 前端纯函数），另有 3 条 Playwright e2e。
- 修 e2e 架子：`e2e/e2e.mjs` 改用动态空闲端口、直接 `node + tsx CLI`（不再 `npx ... shell:true`）、`after()` 递归杀进程树、health 18s 未就绪直接报错；静态服务器补 `.webp` MIME。此前残留后端占住固定 8799，新一轮会静默连到上一轮的旧库，连挂两条但业务代码其实没问题。
- 单文件体积实测 820 KB（含按需模块内联副本 + WebP/PNG 双源），README 数字同步。
- `docs/上线清单.md` 对齐真实现状：已完成 / 明确不做 / 需外部条件三类分开，路线 B/C/D 与桌面端整体标注放弃。
- `docs/interview.md` 与 GitHub About 同步数字与本轮取舍。

## v64 · 2026-11-08

- `app.js` 末尾加 Node 专用纯函数导出钩子（浏览器里 `module` 恒为 undefined，是死代码），配套 30 条前端纯函数单测。
- 从此 `npm run test:pure` 可在 ~125ms 内跑完前端纯函数，不启浏览器、不改业务逻辑。

## v63 · 2026-11-08

- 版本化静态资源上 `immutable` 一年缓存头，HTML / `sw.js` 保持 `no-cache`；条件请求 304 / 0B。
- SW 预缓存从 12 项 816KB 砍到 8 项 530KB（-35%）：去掉首屏用不到的 3 张大图标和重复的 `'./'`。
- head 加 `rel=preload`，启动脚本与 CSS 并行；单文件版自动摘掉 preload。
- 实测推翻两个直觉：`zstd(19)` 174.3KB 反比 `gzip(9)` 172.1KB 大，压缩算法一个字没动；JS minify 要同时改五条发布路径，收益不抵风险，不做。

## v62 · 2026-11-07

- 进站转场：登录成功后用系统配色的刷子把黑白门禁刷走，消掉「进门风格突变」。
- v53–v61 同期完成门禁排球猫舞台（透明底抠图 / 去水印 / 扁平化）、进站动线暖奶油配色、「排球」主题设为默认、页脚波浪跟主题走。

## 未打版本号的变更（后端 / 工程化）

| 日期 | 变更 |
|---|---|
| 2026-11-08 | 三层可观测性：`/api/health/deep`（DB 写锁 / 磁盘 / 内存 / 备份新鲜度）、服务器内存看门狗（每 2 分钟、连续 3 次才告警、只告警不杀）、GitHub Actions 外部探活自动开/关 issue。部署配置脱敏入库 `deploy/`。**触发原因**：线上整站僵死 54 分钟、靠用户刷网页才发现；验尸定位到 `/opt/vigil` Docker build + 无限重启容器吃内存（journal 252 次 `Under memory pressure` 却没有 OOM-killer）。 |
| 2026-11-08 | CI 从「跑但不拦」改成真门禁：`deploy.yml` 监听 `ci.yml` 的 `workflow_run` 且 `conclusion == success` 才部署，`workflow_dispatch` 留救急；根 `package.json` + 锁文件让 clone 后 `npm ci && npm run test:all` 可复现。 |
| 2026-11-08 | 备份恢复演练抓到真 bug：通用归档按 basename 命名 tar，两个项目的 `app.db` 互相覆盖；修成带父目录前缀 + 排除滚动备份目录，并用副本起临时 API 验证可恢复。 |
| 2026-11-08 | 补 MIT `LICENSE`、README 许可段、GitHub 分享预览图（PNG 上传接口报错，改 68.4KB JPG 并核实 CDN 生效）。 |
| 2026-11-08 | 修本机 `~/.ssh/config` 首行 BOM（SSH 报 `Bad configuration option`）；README 被外部 Markdown 格式化器改坏后按 `git diff --numstat` 回退重放，从此提交前核对改动范围。 |
| 历史补记 | 早期里程碑：`v35`（队员端转向单文件 `.html` 档案导出）、`v29`（登录态按标签隔离，同浏览器两标签可各登一个队）、`v28`（云端导入走一个事务）、`v27`（管理端 `/admin` 上线）、`v23`（登录门禁）。这些版本当时没有 CHANGELOG，在此留一份索引。 |

> 完整轨迹仍以 `git log` 为准；本文件只保留「别人接手时该知道」的发布节点与决策理由。
