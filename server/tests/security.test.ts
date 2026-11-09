/**
 * 安全响应头：确认装配在最前面（连 404 都带），且刻意不下发 CSP。
 * 这两条是这个项目特有的约束，不是通用安全头知识，值得写死防回归。
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers';

describe('安全响应头', () => {
  it('所有响应都带基础防护头', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-xss-protection']).toBe('0');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('刻意不下发 CSP 与 CORP（内联脚本单文件 + CORS 全开的设计约束）', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
  });

  it('只有 HTTPS 请求才下发 HSTS', async () => {
    const plain = await request(app).get('/api/health');
    expect(plain.headers['strict-transport-security']).toBeUndefined();

    const https = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('404 与错误响应同样带头（中间件在最前面，不是只挂在路由上）', async () => {
    const notFound = await request(app).get('/api/not-exist');
    expect(notFound.status).toBe(404);
    expect(notFound.headers['x-content-type-options']).toBe('nosniff');

    const badJson = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(badJson.status).toBe(400);
    expect(badJson.headers['x-content-type-options']).toBe('nosniff');
  });

  it('浅 health 的契约没有被中间件改动', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('volleyball-team-server');
    expect(typeof res.body.time).toBe('number');
  });
});
