/**
 * 生产环境强制 JWT_SECRET。
 *
 * 这个校验的价值不在「多一个 if」，而在**把失败时机从「用户被伪造登录」提前到
 * 「部署那一刻」**。默认密钥写在公开仓库里，用它签一个 uid=admin 的 token
 * 就能冒充管理员 —— 这种配漏了但系统照常工作的失败模式必须被拦死。
 *
 * 注意：assertSecretConfigured() 读的是 process.env，而 auth.ts 在模块加载时
 * 就把 SECRET 定死了。所以这里测的是**函数本身**的判定逻辑（改 env 调用），
 * 而「启动入口真的会调用它」由 index.ts 的调用点保证 —— 见本文件末尾的源码断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertSecretConfigured, DEV_DEFAULT_SECRET } from '../src/auth';

const saved = {
  secret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV,
  require: process.env.JWT_REQUIRE_SECRET
};

beforeEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_REQUIRE_SECRET;
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  if (saved.secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = saved.secret;
  if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.nodeEnv;
  if (saved.require === undefined) delete process.env.JWT_REQUIRE_SECRET;
  else process.env.JWT_REQUIRE_SECRET = saved.require;
});

describe('生产环境 JWT_SECRET 强制校验', () => {
  it('生产环境缺少 JWT_SECRET → 拒绝启动并给出生成命令', () => {
    expect(() => assertSecretConfigured()).toThrow(/JWT_SECRET/);
    expect(() => assertSecretConfigured()).toThrow(/randomBytes/);
  });

  it('生产环境用开发默认值 → 拒绝启动（这个值在公开仓库里）', () => {
    process.env.JWT_SECRET = DEV_DEFAULT_SECRET;
    expect(() => assertSecretConfigured()).toThrow(/伪造管理员 token/);
  });

  it('生产环境密钥太短 → 拒绝启动', () => {
    process.env.JWT_SECRET = 'short123';
    expect(() => assertSecretConfigured()).toThrow(/太短/);
  });

  it('生产环境密钥合规 → 放行', () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    expect(() => assertSecretConfigured()).not.toThrow();
  });

  it('非生产环境不强制（本地开发不该被拦住）', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertSecretConfigured()).not.toThrow();
  });

  it('自建部署不设 NODE_ENV 时，可用 JWT_REQUIRE_SECRET=1 显式强制', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_REQUIRE_SECRET = '1';
    expect(() => assertSecretConfigured()).toThrow(/JWT_SECRET/);
  });

  it('测试环境不受影响（setup.ts 注入的测试密钥必须能通过）', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-volleyball';
    expect(() => assertSecretConfigured()).not.toThrow();
  });

  it('启动入口真的调用了校验（否则这个函数只是摆设）', () => {
    const src = readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    expect(src).toMatch(/assertSecretConfigured/);
    // 必须在 listen 之前：配置漏了要当场失败，而不是先开端口再报错
    expect(src.indexOf('assertSecretConfigured()')).toBeLessThan(src.indexOf('app.listen'));
  });
});
