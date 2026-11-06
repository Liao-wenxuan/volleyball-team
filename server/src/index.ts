/**
 * 启动入口：装配 + 监听。应用本体在 app.ts（测试直接 import createApp，不起端口）。
 */
import 'dotenv/config';
import { createApp } from './app';

const PORT = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(PORT, () => {
  console.log(`[server] volleyball-team-server listening on http://localhost:${PORT}`);
});
