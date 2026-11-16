/**
 * 启动入口：装配 + 监听。应用本体在 app.ts（测试直接 import createApp，不起端口）。
 */
import 'dotenv/config';
import { createApp } from './app';
import { assertSecretConfigured } from './auth';

// 密钥校验放在 listen 之前：配置漏了要在这里当场失败，
// 而不是等第一个用户拿默认密钥伪造出管理员 token 才发现。
assertSecretConfigured();

const PORT = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(PORT, () => {
  console.log(`[server] volleyball-team-server listening on http://localhost:${PORT}`);
});
