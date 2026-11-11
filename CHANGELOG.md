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

后端 / 文档 / CI 的改动不 bump `vN`：它们不进 SW 预缓存，版本号变了反而会白清一次用户缓存。这类变更在下面按日期记，不打版本标签。

## 服务端配置 · 2026-11-11（不 bump vN）

**修复两处线上缺陷，前端代码零改动**

- **关掉 HTTP/3**：Caddy 默认启用 h3 并下发 `Alt-Svc: h3=":443"; ma=2592000`，浏览器记住后 30 天内优先走 QUIC/UDP 443，跨境链路常被丢包。全局 `servers { protocols h1 h2 }` 关掉，并给 vb 站点下发 `Alt-Svc: clear` 清掉已有缓存记录。
- **修 PWA 清单 404**：`handle /m*` 是前缀匹配，把 `/manifest.webmanifest` 一并反代到 Express（文件其实一直都在 web 目录）。拆成 `handle /m` + `handle /m/*`；顺手补 `Content-Type: application/manifest+json`（Go 的 mime 库不认识 `.webmanifest`，会回落 `text/plain`）。
- **运维通道**：本机到服务器 22 端口被跨境链路重置，改由 `server-ops.yml` 借 GitHub Actions runner 的 SSH 执行 `deploy/server-ops.sh`。四个动作 `probe / fix / tls12 / undo-tls12` 都先备份 Caddyfile，`caddy validate` 或 reload 失败自动回滚。服务器配置与 `deploy/Caddyfile` 副本已对齐。
- **验证**：线上 `Alt-Svc: clear`、manifest 200 且 MIME 正确、`/admin` `/m/` `/api/health/deep` 全绿；真 Edge 跑 `LIVE_TLS12=1 node preview/verify-live.mjs` 全绿（v67、三帧 WebP、按需 `courtcard.js`、750×1220 阵型导出、零 JS 异常 / 零失败请求）。

**遗留（非代码问题，别再往 Caddy 方向查）**：这条跨境链路会稳定丢弃 Chromium 的 **TLS 1.3 ClientHello**——交错对照实验「默认 TLS 0/6」、客户端加 `--ssl-version-max=tls1.2` 则「6/6 稳定打开（1.0–2.1s）」，而 curl 的 TLS 1.3 能通，说明是按 ClientHello 特征选择性丢包。服务端把 Caddy 限制为只协商 TLS 1.2 的实验**无效**（默认浏览器仍 0/6，因为服务器根本收不到那个包），已回滚，TLS 1.3 恢复。真正根治要换线路 / 套 CDN / 换 IP，属产品决策，未擅自实施。

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
