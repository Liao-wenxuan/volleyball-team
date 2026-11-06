/**
 * 阵型 + 阵型库 + 设置（模板/主题/AI 配置掩码）。
 * AI 的掩码保留逻辑用 stub 的全局 fetch 验证：服务端代理必须带着库里存的 Key 请求上游。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, fullPos, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('当前站位 /api/formation', () => {
  it('没存过 → null', async () => {
    const res = await request(app).get('/api/formation').set(auth(s.playerToken));
    expect(res.status).toBe(200);
    expect(res.body.formation).toBeNull();
  });

  it('保存完整六位站位 → 成功回读', async () => {
    const res = await request(app).put('/api/formation').set(auth(s.coachToken)).send({ preset: 'base', pos: fullPos() });
    expect(res.status).toBe(200);
    expect(res.body.formation.preset).toBe('base');
    expect(res.body.formation.pos.oh1).toEqual({ x: 1.8, y: 5.6 });
  });

  it('缺一个角色位 → 400', async () => {
    const pos = fullPos();
    delete (pos as Record<string, unknown>).lib;
    const res = await request(app).put('/api/formation').set(auth(s.coachToken)).send({ preset: 'custom', pos });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('lib');
  });

  it('坐标越界（x>9）→ 400', async () => {
    const res = await request(app)
      .put('/api/formation')
      .set(auth(s.coachToken))
      .send({ preset: 'custom', pos: fullPos({ mb: { x: 9.5, y: 1 } }) });
    expect(res.status).toBe(400);
  });

  it('出现未知角色位 → 400（前端画不出来多余位置）', async () => {
    const pos = { ...fullPos(), extra: { x: 1, y: 1 } };
    const res = await request(app).put('/api/formation').set(auth(s.coachToken)).send({ preset: 'custom', pos });
    expect(res.status).toBe(400);
  });

  it('覆盖保存：只保留最新一份', async () => {
    await request(app).put('/api/formation').set(auth(s.coachToken)).send({ preset: 'a', pos: fullPos() });
    const res = await request(app)
      .put('/api/formation')
      .set(auth(s.coachToken))
      .send({ preset: 'b', pos: fullPos({ oh1: { x: 2, y: 2 } }) });
    expect(res.body.formation.preset).toBe('b');
    expect(res.body.formation.pos.oh1).toEqual({ x: 2, y: 2 });
  });

  it('队员身份保存 → 403；队员身份读取 → 200（手机看阵型）', async () => {
    const put = await request(app).put('/api/formation').set(auth(s.playerToken)).send({ preset: 'x', pos: fullPos() });
    expect(put.status).toBe(403);
    const get = await request(app).get('/api/formation').set(auth(s.playerToken));
    expect(get.status).toBe(200);
  });
});

describe('阵型库 /api/formation/library', () => {
  it('整库推送 → 全量替换（删旧写新）', async () => {
    await request(app)
      .put('/api/formation/library')
      .set(auth(s.coachToken))
      .send({ formations: [{ id: 'f1', name: '第一套', pos: fullPos(), at: 100 }] });
    const res = await request(app)
      .put('/api/formation/library')
      .set(auth(s.coachToken))
      .send({ formations: [{ id: 'f2', name: '第二套', pos: fullPos(), at: 200 }] });
    expect(res.status).toBe(200);
    expect(res.body.formations).toHaveLength(1);
    expect(res.body.formations[0].id).toBe('f2'); // f1 被整库替换掉了
  });

  it('超过 30 套 → 400', async () => {
    const formations = Array.from({ length: 31 }, (_, i) => ({
      id: `f${i}`,
      name: `套${i}`,
      pos: fullPos()
    }));
    const res = await request(app).put('/api/formation/library').set(auth(s.coachToken)).send({ formations });
    expect(res.status).toBe(400);
  });

  it('某一套缺角色位 → 400，且整库不被写入（先校验后落库）', async () => {
    const bad = fullPos();
    delete (bad as Record<string, unknown>).s;
    const res = await request(app)
      .put('/api/formation/library')
      .set(auth(s.coachToken))
      .send({ formations: [{ id: 'f1', name: 'ok', pos: fullPos() }, { id: 'f2', name: 'bad', pos: bad }] });
    expect(res.status).toBe(400);
    const get = await request(app).get('/api/formation/library').set(auth(s.coachToken));
    expect(get.body.formations).toHaveLength(0);
  });

  it('阵型同步体现到 sync/check 的时间戳', async () => {
    const before = await request(app).get('/api/sync/check').set(auth(s.coachToken));
    await request(app)
      .put('/api/formation/library')
      .set(auth(s.coachToken))
      .send({ formations: [{ id: 'f1', name: 'x', pos: fullPos() }] });
    const after = await request(app).get('/api/sync/check').set(auth(s.coachToken));
    expect(after.body.t).toBeGreaterThanOrEqual(before.body.t);
  });
});

describe('设置 /api/settings', () => {
  it('默认设置：空模板 + aurora + ai null', async () => {
    const res = await request(app).get('/api/settings').set(auth(s.coachToken));
    expect(res.body.settings).toEqual({ template: [], theme: 'aurora', ai: null });
  });

  it('更新模板（全量替换）', async () => {
    const res = await request(app)
      .put('/api/settings/template')
      .set(auth(s.coachToken))
      .send({
        template: [{ id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '老馆' }]
      });
    expect(res.status).toBe(200);
    expect(res.body.settings.template).toHaveLength(1);
    // 再 PUT 一次单项 → 整体被替换
    await request(app)
      .put('/api/settings/template')
      .set(auth(s.coachToken))
      .send({ template: [] });
    const after = await request(app).get('/api/settings').set(auth(s.coachToken));
    expect(after.body.settings.template).toHaveLength(0);
  });

  it('模板时间格式非法 → 400', async () => {
    const res = await request(app)
      .put('/api/settings/template')
      .set(auth(s.coachToken))
      .send({ template: [{ id: 't', day: 2, label: 'x', start: '9:60', end: '18:30', venue: '' }] });
    expect(res.status).toBe(400);
  });

  it('主题不在白名单 → 400', async () => {
    const res = await request(app).put('/api/settings/theme').set(auth(s.coachToken)).send({ theme: 'neon' });
    expect(res.status).toBe(400);
  });

  it('更新主题 → 200', async () => {
    const res = await request(app).put('/api/settings/theme').set(auth(s.coachToken)).send({ theme: 'sakura' });
    expect(res.body.settings.theme).toBe('sakura');
  });

  it('队员身份改设置 → 403', async () => {
    const res = await request(app).put('/api/settings/theme').set(auth(s.playerToken)).send({ theme: 'ocean' });
    expect(res.status).toBe(403);
  });
});

describe('AI 配置掩码（Key 永不回传）', () => {
  it('保存 Key 后 GET 返回掩码，不返回明文', async () => {
    await request(app)
      .put('/api/settings/ai')
      .set(auth(s.coachToken))
      .send({ ai: { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-real-secret-123' } });
    const res = await request(app).get('/api/settings').set(auth(s.coachToken));
    expect(res.body.settings.ai.key).toBe('••••••••••');
    expect(JSON.stringify(res.body)).not.toContain('sk-real-secret-123');
  });

  it('前端交回掩码 = 没改 Key，库里原值保留', async () => {
    await request(app)
      .put('/api/settings/ai')
      .set(auth(s.coachToken))
      .send({ ai: { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-first-key' } });
    // 用户只改了 base，key 字段原样交回掩码
    await request(app)
      .put('/api/settings/ai')
      .set(auth(s.coachToken))
      .send({ ai: { base: 'https://other.example.com', model: 'gpt-x', key: '••••••••••' } });

    // 用 /api/ai/chat 验证：服务端代理应该带着最初那个 Key 去请求新的 base
    const fetchMock = vi.fn(async () => new Response('data: {}\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/ai/chat')
      .set(auth(s.coachToken))
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://other.example.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-first-key');
  });

  it('base 末尾带斜杠或已含路径都能拼出正确的上游地址', async () => {
    await request(app)
      .put('/api/settings/ai')
      .set(auth(s.coachToken))
      .send({ ai: { base: 'https://x.com/v1/', model: 'm', key: 'k1' } });
    const fetchMock = vi.fn(async () => new Response('data: {}\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request(app).post('/api/ai/chat').set(auth(s.coachToken)).send({ messages: [{ role: 'user', content: 'x' }] });
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.com/v1/chat/completions');
  });

  it('没配置 AI → chat 返回 400 no_ai_config', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set(auth(s.coachToken))
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_ai_config');
  });

  it('上游 401 → 转成 400 给前端（不让前端以为是自己登录过期）', async () => {
    await request(app)
      .put('/api/settings/ai')
      .set(auth(s.coachToken))
      .send({ ai: { base: 'https://api.deepseek.com', model: 'm', key: 'bad' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }))
    );
    const res = await request(app)
      .post('/api/ai/chat')
      .set(auth(s.coachToken))
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('upstream_error');
  });

  it('队员身份调 AI → 403（烧钱的接口不放给只读端）', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set(auth(s.playerToken))
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(403);
  });
});
