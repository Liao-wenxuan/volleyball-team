/**
 * 健康检查路由。
 *
 * /api/health       浅：只证明进程活着，部署脚本、Caddy、外部探活高频调用，别往里塞重活。
 * /api/health/deep  深：任一子项失败返回 503，外部只看 HTTP 码就能判定。
 */
import { Router } from 'express';
import { collectHealth } from '../health';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true, name: 'volleyball-team-server', time: Date.now() });
});

router.get('/deep', (_req, res) => {
  const report = collectHealth();
  res.status(report.ok ? 200 : 503).json(report);
});

export default router;
