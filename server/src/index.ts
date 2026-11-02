/**
 * 入口：Express 应用装配。
 *
 * 结构刻意保持「一眼看完」：中间件 → 路由 → 404 → 统一错误处理。
 * 业务逻辑全部在 repo.ts / routes/ 里，这里不写任何 SQL。
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { errorMiddleware, HttpError } from './http';
import authRoutes from './routes/auth';
import accountRoutes from './routes/accounts';
import adminRoutes from './routes/admin';
import playerRoutes from './routes/players';
import sessionRoutes from './routes/sessions';
import skillRoutes from './routes/skills';
import formationRoutes from './routes/formation';
import settingsRoutes from './routes/settings';

const app = express();
const PORT = Number(process.env.PORT || 8787);

// 前端是纯静态页（GitHub Pages / file://），Origin 五花八门，直接放开；
// 鉴权靠 Bearer token，不依赖 cookie，所以 CORS 放开没有凭证泄露面。
app.use(cors());
app.use(express.json({ limit: '256kb' }));
// Caddy 反代后面，让 req.ip 拿到 x-forwarded-for 里的真实客户端 IP（限流用）
app.set('trust proxy', 1);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'volleyball-team-server', time: Date.now() });
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/players', playerRoutes);
app.use('/api', sessionRoutes); // 内部路径已是 /weeks/:key、/sessions...
app.use('/api/skills', skillRoutes);
app.use('/api/formation', formationRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在', 'not_found')));

// 管理端：独立入口，单文件随 server 产物走（不依赖 STATIC_DIR，Caddy 怎么托管根路径都不影响）。
// 必须挂在静态目录兜底之前，否则会被 `app.get('*')` 捕获返回教练端 index.html。
const adminPage = path.join(__dirname, '..', 'public', 'admin.html');
const sendAdmin = (_req: express.Request, res: express.Response) => res.sendFile(adminPage);
app.get('/admin', sendAdmin);
app.get('/admin.html', sendAdmin);

// 可选：生产模式下直接托管打包好的前端单文件目录
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const dir = path.resolve(staticDir);
  app.use(express.static(dir));
  app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
}

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`[server] volleyball-team-server listening on http://localhost:${PORT}`);
});
