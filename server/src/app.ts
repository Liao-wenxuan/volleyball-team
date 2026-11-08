/**
 * Express 应用装配（可测试版）。
 *
 * 结构刻意保持「一眼看完」：中间件 → 路由 → 404 → 统一错误处理。
 * 业务逻辑全部在 repo.ts / routes/ 里，这里不写任何 SQL。
 *
 * 从 index.ts 拆出 createApp()：路由测试不需要真的监听端口，
 * supertest 风格直接把 app 丢给 http 层即可；index.ts 只剩「装配 + listen」。
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { errorMiddleware, HttpError } from './http';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import accountRoutes from './routes/accounts';
import adminRoutes from './routes/admin';
import playerRoutes from './routes/players';
import sessionRoutes from './routes/sessions';
import skillRoutes from './routes/skills';
import formationRoutes from './routes/formation';
import settingsRoutes from './routes/settings';
import importRoutes from './routes/import';
import meRoutes from './routes/me';
import syncRoutes from './routes/sync';
import aiRoutes from './routes/ai';

export function createApp(): express.Express {
  const app = express();

  // 前端是纯静态页（GitHub Pages / file://），Origin 五花八门，直接放开；
  // 鉴权靠 Bearer token，不依赖 cookie，所以 CORS 放开没有凭证泄露面。
  app.use(cors());
  // 2mb：批量导入接口要收一整份备份（20 人一学期约 100kb，留足余量）。
  // 单条业务请求远小于此，真正的防滥用靠 import.ts 里的数量上限校验。
  app.use(express.json({ limit: '2mb' }));
  // Caddy 反代后面，让 req.ip 拿到 x-forwarded-for 里的真实客户端 IP（限流用）
  app.set('trust proxy', 1);

  // 浅 health 保持「部署脚本 curl 一下就知道进程活着」的契约；
  // 深度检查在 /api/health/deep，见 routes/health.ts。
  app.use('/api/health', healthRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api', sessionRoutes); // 内部路径已是 /weeks/:key、/sessions...
  app.use('/api/skills', skillRoutes);
  app.use('/api/formation', formationRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/ai', aiRoutes);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在', 'not_found')));

  // 管理端：独立入口，单文件随 server 产物走（不依赖 STATIC_DIR，Caddy 怎么托管根路径都不影响）。
  // 必须挂在静态目录兜底之前，否则会被 `app.get('*')` 捕获返回教练端 index.html。
  const adminPage = path.join(__dirname, '..', 'public', 'admin.html');
  const sendAdmin = (_req: express.Request, res: express.Response) => res.sendFile(adminPage);
  app.get('/admin', sendAdmin);
  app.get('/admin.html', sendAdmin);

  // 队员端「我的」：手机一屏页。跟管理端同理挂显式路由；
  // sw 注册在 /m/sw.js，作用域天然是 /m/，不会去抢教练端的离线壳。
  const mDir = path.join(__dirname, '..', 'public');
  const sendM = (_req: express.Request, res: express.Response) => res.sendFile(path.join(mDir, 'm.html'));
  app.get('/m', sendM);
  app.get('/m/', sendM);
  app.get('/m.html', sendM);
  app.get('/m/manifest.webmanifest', (_req, res) => {
    res.type('application/manifest+json').sendFile(path.join(mDir, 'm-manifest.webmanifest'));
  });
  app.get('/m/sw.js', (_req, res) => {
    res.type('application/javascript').sendFile(path.join(mDir, 'm-sw.js'));
  });

  app.use(errorMiddleware);
  return app;
}
