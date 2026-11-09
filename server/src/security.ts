/**
 * 安全响应头（补齐 docs/上线清单.md 里那一项）。
 *
 * 为什么不用 helmet：
 *   项目一贯「自研可控」——卡片手绘 canvas 不用 html2canvas、登录限流用内存 Map
 *   不用 express-rate-limit、SSE 自己解析不引库。这里只需要几个静态头，
 *   为一张常量表拉个依赖（还要跟版本、类型、供应链）不划算。
 *   更关键的是 helmet 默认下发 Content-Security-Policy，而本项目的
 *   index.html / admin.html / m.html 全是内联 <script>/<style> 的单文件，
 *   默认 CSP 会直接把页面打白。真要上 CSP 得给每段内联脚本算 nonce/hash，
 *   那是另一件事，不该混在「加安全头」里做。
 *
 * 刻意不设的两项：
 *   - Content-Security-Policy：见上；静态页由 Caddy 托管，按路径配更合适
 *   - Cross-Origin-Resource-Policy：cors() 是刻意全开的（纯静态页 + Bearer token，
 *     Origin 五花八门），加 same-origin 会和这个设计意图打架
 */
import type { NextFunction, Request, Response } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // 别让浏览器把 JSON / 图片按猜测的 MIME 当脚本执行
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 防点击劫持：三端都是顶层打开的页面，不需要被别人 iframe 嵌
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 现代浏览器已移除 XSS Auditor；显式设 0 是避免旧版误判合法脚本（helmet 同样这么设）
  res.setHeader('X-XSS-Protection', '0');
  // 项目完全用不到这些设备能力，直接关掉
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS 只在真实 HTTPS 请求下发：本地 http 开发时浏览器本就忽略它，
  // 但显式判断能让「响应头跟协议一致」这件事一目了然。
  // 服务端在 Caddy 反代后面，真实协议取 x-forwarded-proto 第一段。
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
