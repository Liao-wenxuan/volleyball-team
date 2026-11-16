# Cloudflare CDN 接入操作手册（vb.bscjs.top）

> 目标：让 `vb.bscjs.top` 走 Cloudflare CDN，根治「某些网络下 Chromium 直连站点一直转圈 /
> 登录报 Failed to fetch」的跨境链路丢包问题。
>
> **写于 2026-11-16。动手前请通读第 0 节。**

---

## 0. 先读这个：为什么要做，以及当前的真实状态

### 0.1 故障是什么

2026-11-11 排查过一次，结论记录在 `CHANGELOG.md` 的「服务端配置 · 2026-11-11」条目：

- 现象：某些网络下，Chromium 直连 `vb.bscjs.top` 页面一直转圈，登录报 `Failed to fetch`。
- 归因：这条跨境链路**按 TLS 1.3 ClientHello 的特征选择性丢包**。
  - 浏览器默认发 TLS 1.3 → 包被丢 → 连接挂起 → 页面永远转圈
  - 强制 TLS 1.2 → 包不被丢 → 稳定打开（实测 6/6，1.0–2.1s）
  - curl 的 TLS 1.3 能通 → 说明服务器活着，是链路按特征丢包
- 服务端把 Caddy 限制为「只协商 TLS 1.2」的实验**无效**——服务器根本收不到那个包。已回滚。

### 0.2 为什么 CDN 能根治

丢包发生在「浏览器 → 服务器」这一段。接了 CDN 之后，链路变成：

```
浏览器 ──→ Cloudflare 边缘节点（就近）──→ 服务器
        └─ 短距离，走本地网络        └─ Cloudflare 到服务器的稳定线路
```

浏览器只跟边缘节点握手 TLS 1.3，**丢包的那段路径不再出现在浏览器到边缘之间**。
Cloudflare 到源站是固定骨干网，不受你本地运营商的跨境丢包影响。

### 0.3 2026-11-16 的复测：故障目前不复现，但没被消除

| 测试 | 结果 |
|---|---|
| 本机环境 | 上海移动（AS9808）→ 阿里云新加坡（AS45102），**与当初丢包的场景完全一致** |
| Node TLS 栈（vb / csp） | TLS 1.3 与 TLS 1.2 均通 |
| 真实 Chromium（vb） | **16/16 成功**，中位 131ms |
| 真实 Chromium（csp） | **10/10 成功**，中位 120ms |
| 复刻 CHANGELOG 对照实验 | 默认 **6/6**、强制 TLS1.2 **6/6**（当初默认是 0/6） |
| 代理 `--check` 强制 TLS1.2 | 可达 HTTP 200 / 447ms |

**结论**：丢包是**间歇性**的，不是持续故障。2026-11-16 这条链路恰好是好的，
所以「默认 TLS 0/6」复现不出来了。

> ⚠️ **这不等于问题被修复了**。它意味着：你无法用「现在能打开」证明「以后也能打开」。
> 这正是要做 CDN 的理由——把间歇性故障变成有冗余的稳定路径，
> 而不是靠运气和 `npm run proxy` 这个临时手段兜着。

### 0.4 变更范围（重要）

`bscjs.top` 下有 **3 个生产子域**，全部指向同一台服务器 `47.84.52.175`：

| 子域 | 用途 | 本次是否走 CDN |
|---|---|---|
| `vb.bscjs.top` | 排球队管理系统 | ✅ **开橙云（代理）** |
| `csp.bscjs.top` | content-sharing-platform（简历主项目） | ❌ **灰云（DNS only）**，直连不变 |
| `vigil.bscjs.top` | Vigil 监控面板（容器 8080） | ❌ **灰云（DNS only）**，直连不变 |

**为什么 csp / vigil 要灰云**：
- 它们的解析结果和现在**完全一样**（还是 `47.84.52.175`），只是 DNS 托管方从阿里云换成 Cloudflare，
  对它们的用户没有任何可感知变化 → 风险最小。
- csp 有 WebSocket（`/ws*`）、上传（`/uploads/*`），Vigil 有自己的登录与 token 注入逻辑，
  接 CDN 都要额外配规则才能保证不出意外。**一次只解决一个问题的原则**。
- 如果后续你想让 csp 也走 CDN，那是独立的一次变更，单独验证、单独回滚。

### 0.5 前置条件

- 一个 Cloudflare 账号（免费版即可，免费版支持自定义域名 + 无限流量）
- 阿里云账号（改 NS 用）
- 一个完整的、能不依赖 DNS 的回滚方案（见第 6 节）

---

## 1. 迁移前快照（2026-11-16 实测，请先自己复核一遍）

```
NS:     dns25.hichina.com / dns26.hichina.com
根域 bscjs.top        → 无 A 记录（无可用记录）
vb.bscjs.top          → A 47.84.52.175
csp.bscjs.top         → A 47.84.52.175
vigil.bscjs.top       → A 47.84.52.175
www/api/m.bscjs.top   → 无记录
MX / TXT              → 无记录（域名不做邮件）
```

> **没有 MX / TXT 记录 = 没有邮件服务**，这是好消息：迁移时不会漏邮件配置导致收信失败。

**自己复核的命令**（在 PowerShell 里跑）：

```powershell
nslookup -type=NS bscjs.top dns25.hichina.com
nslookup -type=A  vb.bscjs.top    dns25.hichina.com
nslookup -type=A  csp.bscjs.top   dns25.hichina.com
nslookup -type=A  vigil.bscjs.top dns25.hichina.com
```

如果你复核出来的结果和上面**不一致**（比如多了记录、或 IP 不是 `47.84.52.175`），
**停下来**，说明域名状态在这份文档写好之后变了，照抄会出错。

---

## 2. 第一步：在 Cloudflare 添加站点

1. 打开 <https://dash.cloudflare.com>，注册并登录（邮箱验证）。
2. 点 **Add a domain / 添加域**，输入 **`bscjs.top`**。
   - ⚠️ 只填根域，**不要**填 `vb.bscjs.top`，也不要把 `https://` 一起粘进去。
3. 套餐选 **Free（免费）** → Continue。
4. Cloudflare 会扫描现有 DNS 记录。**这一步大概率扫描不全**，直接 Continue。
5. 页面会给你 **2 条 Cloudflare NS**，形如 `xxxx.ns.cloudflare.com` / `yyyy.ns.cloudflare.com`。
   **把这两条抄下来**，第 3 步要用。
   - 每条记录各不相同，**不要抄本文档或别处的示例**。
6. 点 Continue，Cloudflare 会显示 "Pending Nameserver Update"（等待 NS 更新）。
   **此时什么都还没变，线上服务一切正常。**

---

## 3. 第二步：在 Cloudflare 补齐 DNS 记录

进入该站点的 **DNS → Records**，**逐条手工添加**下面 3 条：

| Type | Name | Content | Proxy status | 说明 |
|---|---|---|---|---|
| A | `vb` | `47.84.52.175` | 🟠 **Proxied（橙云）** | 走 CDN —— 这是本次要修的 |
| A | `csp` | `47.84.52.175` | ⚫ **DNS only（灰云）** | 直连不变 |
| A | `vigil` | `47.84.52.175` | ⚫ **DNS only（灰云）** | 直连不变 |

**要点**

- `Name` 只填**子域前缀**（`vb` / `csp` / `vigil`），不要填完整域名，Cloudflare 会自动拼上 `bscjs.top`。
- **灰云/橙云是这一整件事的关键**，别点错：
  - 橙云 = Cloudflare 代理（走 CDN，有 TLS 终止、缓存、防护）
  - 灰云 = 只做 DNS 解析（直连，和现在一样）
- **不要**添加根域 `@` 的 A 记录（现在没有，别新增）。
- **不要**添加任何 MX / TXT（现在没有）。
- 如果 Cloudflare 的自动扫描把某些记录导进来了，**逐条核对**上表：多出来的删掉，缺的补上，
  代理状态按上表设置。

---

## 4. 第三步：改阿里云的 NS（**这是唯一有真实风险的一步**）

在 NS 切换完成前，Cloudflare 那边配的记录**完全不生效**，线上仍是老样子。
NS 一改，解析权就从阿里云转到 Cloudflare 了。

1. 登录阿里云控制台 → **域名** → 找到 `bscjs.top` → **管理**。
2. 找 **DNS 修改 / 修改 DNS 服务器 / Nameserver**。
3. 选 **自定义 DNS**，删掉原有的 `dns25.hichina.com`、`dns26.hichina.com`。
4. 填入 Cloudflare 给的那 2 条 NS，保存。
5. ⚠️ **如果之前开了 DNSSEC，先把它关掉**，改完 NS 之后再在 Cloudflare 面板重新开启。
   （没开过就忽略这行。）

> **只有 NS 记录会被改，站点原有的解析记录留在阿里云那边不动。**
> 迁移窗口内两边记录并存不冲突——NS 生效后以 Cloudflare 为准。

---

## 5. 第四步：Cloudflare 侧的 SSL / 缓存设置

NS 生效、Cloudflare 状态变成 **Active** 之后，去：

### 5.1 SSL/TLS

- **SSL/TLS → Overview → 模式：选 `Full (strict)`**
  - 源站 Caddy 有有效证书（Let's Encrypt），所以 strict 可用。
  - **不要选 `Flexible`**——它会让 Cloudflare 用 HTTP 回源，你服务器上的
    `Strict-Transport-Security` 和 `Secure` cookie 语义全失效。
- **Edge Certificates → Always Use HTTPS：开**

### 5.2 缓存规则（**这一步最容易被忽略，但不做会出 bug**）

Cloudflare 默认**不缓存 HTML**，但会缓存静态资源。而这个项目的静态资源带
`?v=N` 版本号 + `immutable` 强缓存头——**这套机制和 CDN 的缓存是叠加的，不冲突**。

**但有一个真问题**：`sw.js` 必须永远拿最新的。
Service Worker 的更新检查依赖 `sw.js` 本身不被缓存，否则用户永远拿不到新版本。

去 **Rules → Cache Rules**，加一条：

```
条件：  URI Path  equals  /sw.js
动作：  Cache eligibility → Bypass cache
```

同理，`index.html` 是 SPA 入口，也建议 Bypass（Cloudflare 默认就不缓存 HTML，一般无需额外设置，
但加了这条更保险）。

> **不做这条的后果**：SW 更新永远拉不到新 `sw.js` → 用户卡在旧版本，
> 表现是「界面改不动」，而且极难排查。

### 5.3 不要开的东西

- **不要**开 Cloudflare Workers / Pages / 缓存规则改写响应体
- **不要**把 `/api/*` 设为缓存（默认就不缓存，确认一下没被误设）
- **不要**改 WAF 规则去拦 `/api`（正常业务请求会被误伤）

---

## 6. 验证清单（逐条打勾，全绿才算完成）

### 6.1 等待 NS 生效

```powershell
# NS 应该变成 Cloudflare 的两条
nslookup -type=NS bscjs.top 1.1.1.1
```
- 全球生效通常 **10 分钟 ~ 2 小时**，最长可能 24–48 小时。
- Cloudflare 面板状态变成 **Active** 才算好。
- 用 <https://www.whatsmydns.net/> 可以看全球各点的解析状态。

### 6.2 三个子域都要活（**最重要的验收**）

```powershell
foreach ($h in @('vb.bscjs.top','csp.bscjs.top','vigil.bscjs.top')) {
  try { $r = Invoke-WebRequest "https://$h/" -TimeoutSec 20 -UseBasicParsing
        "{0,-20} {1}" -f $h, $r.StatusCode }
  catch { "{0,-20} ERR {1}" -f $h, $_.Exception.Message }
}
```

**预期**：`vb` 返回 200 且响应头里有 `server: cloudflare`；`csp` 和 `vigil` 同样 200
但**没有** `server: cloudflare`（灰云直连，响应头是 Caddy 的）。

### 6.3 用真实浏览器确认（别只 curl）

浏览器（不是 curl）才能反映 Chromium 的 TLS 行为。打开：

- <https://vb.bscjs.top/> → 页面正常渲染，DevTools → Network 里首页和 API 都是 200
- 登录一次，确认 token 能拿到、`/api/me` 正常
- DevTools → Network → 任意请求 → Response Headers 里应能看到 `cf-cache-status`、`cf-ray`
  （证明请求确实过了 Cloudflare）

### 6.4 后端功能抽查

```powershell
Invoke-WebRequest https://vb.bscjs.top/api/health -UseBasicParsing | Select-Object -ExpandProperty Content
# 预期：{"ok":true,"name":"volleyball-team-server","time":...}
```

再手动测一遍：考勤登记、阵型板拖拽、主题切换、AI 助手——这几条是主要业务路径。

---

## 7. 回滚方案（**改 NS 前先确认你能执行这一步**）

出问题时，**最快的回滚是把 NS 改回阿里云**：

1. 阿里云控制台 → `bscjs.top` → DNS 修改 → 改回 `dns25.hichina.com` + `dns26.hichina.com`
2. 等 NS 重新生效（通常比切过去快，因为阿里云是原 NS，缓存还在）

> ⚠️ **回滚的代价**：NS 生效期间（最长 48 小时）部分用户的 DNS 缓存可能仍指向 Cloudflare，
> 那段时间的行为取决于 Cloudflare 上你的记录是否还正确。
> 所以**第 3 步里的 Cloudflare 记录一定要配对**，即使后来回滚了 NS，
> Cloudflare 上留着的正确记录也不会让情况变坏。

**如果只是想临时关掉 CDN 而不改 NS**：把 `vb` 那条记录的 Proxy status 从橙云改回灰云，
30 秒内生效，解析回到 `47.84.52.175` 直连。**这比改 NS 轻得多**——
如果你只是怀疑 CDN 有问题、想验证是不是 CDN 引起的，先用这招。

---

## 8. 迁移后的持续监控

`bscjs.top` 的外部探活（`.github/workflows/monitor.yml`）当前只探 `vb`。
CDN 接入后，建议在监控里补两项：

1. **记录 `cf-ray` / `cf-cache-status` 响应头**——确认请求确实过了 CDN，
   而不是被某种规则绕过了。
2. **增加一条 csp / vigil 的探活**——NS 托管方换了，这两个子域的解析由 Cloudflare 负责，
   它们虽然没走代理，但 DNS 解析路径变了，应该纳入监控。

（这两项属于监控增强，可以之后单独做，不阻塞本次迁移。）

---

## 9. 一句话清单

```
□ 复核第 1 节的 DNS 快照（和文档一致才继续）
□ Cloudflare 注册 + 添加 bscjs.top + Free 套餐
□ 抄下 2 条 Cloudflare NS
□ 在 Cloudflare 加 3 条 A 记录：vb(橙云) / csp(灰云) / vigil(灰云)
□ 核对自动扫描导入的记录，多删少补
□ SSL 模式 = Full (strict)，Always Use HTTPS 开
□ Cache Rule：/sw.js → Bypass cache
□ 阿里云改 NS 为 Cloudflare 的 2 条（DNSSEC 先关）
□ 等 Cloudflare 状态变 Active（nslookup -type=NS 确认）
□ 三个子域全部 200，vb 有 server: cloudflare
□ 真实浏览器验证 vb：页面 + 登录 + 考勤 + 阵型 + 主题
□ 回滚路径确认：灰云切换 / NS 改回，两条都要能执行
```

---

## 10. 延伸：仓库里已有的应急手段

仓库里有一个**本地强制 TLS 1.2 的反向代理**，在 CDN 生效前可以作为过渡：

```bash
npm run proxy              # 浏览器开 http://localhost:8787/
npm run proxy -- --check   # 只体检上游，不占端口
```

实现见 `tools/local-proxy.mjs`。它是**应急工具，不是长期方案**——
要求用户改用 `localhost:8787` 而不是正常网址，属于退而求其次。
CDN 接好之后它就不再是必需品了（但建议保留，它对「排查是不是线路问题」很有用）。
