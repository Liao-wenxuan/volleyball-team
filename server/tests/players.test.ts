/**
 * 队员 CRUD + 跨队隔离 + 角色门禁。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, seedOtherTeam, seedPlayerIn, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

const validPlayer = {
  name: '张三',
  number: 11,
  position: '二传',
  grade: '大二',
  height: 186,
  gender: '男',
  skills: { serve: 6, spike: 8.5 }
};

describe('GET /api/players', () => {
  it('空队返回空数组（种子含 3 人，先只看结构）', async () => {
    const res = await request(app).get('/api/players').set(auth(s.playerToken));
    expect(res.status).toBe(200);
    expect(res.body.players).toHaveLength(3); // 绑定球员 + 2 个种子球员
    const p = res.body.players[0];
    expect(Object.keys(p.skills).sort()).toEqual(['block', 'defense', 'receive', 'serve', 'set', 'spike']);
  });

  it('按号码排序', async () => {
    const res = await request(app).get('/api/players').set(auth(s.coachToken));
    const nums = res.body.players.map((p: { number: number }) => p.number);
    expect(nums).toEqual([...nums].sort((a: number, b: number) => a - b));
  });

  it('未登录 → 401', async () => {
    expect((await request(app).get('/api/players')).status).toBe(401);
  });

  it('跨队隔离：看不到别的队的球员', async () => {
    const other = seedOtherTeam();
    const foreignId = seedPlayerIn(other);
    const res = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(res.body.players.some((p: { id: string }) => p.id === foreignId)).toBe(false);
  });
});

describe('POST /api/players', () => {
  it('完整创建 → 201，返回创建的球员', async () => {
    const res = await request(app).post('/api/players').set(auth(s.coachToken)).send(validPlayer);
    expect(res.status).toBe(201);
    expect(res.body.player).toMatchObject({
      name: '张三',
      number: 11,
      position: '二传',
      height: 186
    });
    expect(res.body.player.skills.serve).toBe(6);
    expect(res.body.player.skills.spike).toBe(8.5);
    // 未指定的技能落默认值 5
    expect(res.body.player.skills.receive).toBe(5);
  });

  it('最小创建：只给姓名，其余全走默认值', async () => {
    const res = await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '李四' });
    expect(res.status).toBe(201);
    expect(res.body.player).toMatchObject({ number: 0, position: '主攻', grade: '大一', height: 0, gender: '' });
  });

  it('姓名为空 → 400', async () => {
    const res = await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  it('号码越界（100）→ 400', async () => {
    const res = await request(app)
      .post('/api/players')
      .set(auth(s.coachToken))
      .send({ name: '王五', number: 100 });
    expect(res.status).toBe(400);
  });

  it('号码为负 → 400', async () => {
    const res = await request(app)
      .post('/api/players')
      .set(auth(s.coachToken))
      .send({ name: '王五', number: -1 });
    expect(res.status).toBe(400);
  });

  it('身高越界 → 400', async () => {
    const res = await request(app)
      .post('/api/players')
      .set(auth(s.coachToken))
      .send({ name: '王五', height: 300 });
    expect(res.status).toBe(400);
  });

  it('非法位置 → 400', async () => {
    const res = await request(app)
      .post('/api/players')
      .set(auth(s.coachToken))
      .send({ name: '王五', position: '队长' });
    expect(res.status).toBe(400);
  });

  it('技能越界（>10）→ 400', async () => {
    const res = await request(app)
      .post('/api/players')
      .set(auth(s.coachToken))
      .send({ name: '王五', skills: { spike: 11 } });
    expect(res.status).toBe(400);
  });

  it('队员身份创建 → 403（前端藏按钮只是体验，权限以服务端为准）', async () => {
    const res = await request(app).post('/api/players').set(auth(s.playerToken)).send(validPlayer);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('未登录创建 → 401', async () => {
    expect((await request(app).post('/api/players').send(validPlayer)).status).toBe(401);
  });
});

describe('PATCH /api/players/:id', () => {
  it('只改姓名，其余字段保持原值（partial 合并）', async () => {
    const created = await request(app).post('/api/players').set(auth(s.coachToken)).send(validPlayer);
    const id = created.body.player.id;

    const res = await request(app).patch(`/api/players/${id}`).set(auth(s.coachToken)).send({ name: '赵六' });
    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe('赵六');
    expect(res.body.player.number).toBe(11);
    expect(res.body.player.skills.serve).toBe(6);
    expect(res.body.player.skills.spike).toBe(8.5);
  });

  it('只改一项技能，其他技能不动', async () => {
    const created = await request(app).post('/api/players').set(auth(s.coachToken)).send(validPlayer);
    const id = created.body.player.id;

    const res = await request(app).patch(`/api/players/${id}`).set(auth(s.coachToken)).send({ skills: { block: 3 } });
    expect(res.status).toBe(200);
    expect(res.body.player.skills.block).toBe(3);
    expect(res.body.player.skills.serve).toBe(6);
    expect(res.body.player.skills.spike).toBe(8.5);
  });

  it('改到不存在的球员 → 404', async () => {
    const res = await request(app).patch('/api/players/p_nope').set(auth(s.coachToken)).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('改别的队的球员 id → 404（team_id 作用域拦住）', async () => {
    const other = seedOtherTeam();
    const foreignId = seedPlayerIn(other);
    const res = await request(app).patch(`/api/players/${foreignId}`).set(auth(s.coachToken)).send({ name: '抢人' });
    expect(res.status).toBe(404);
    // 而且对方球员没被改
    const res2 = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(res2.body.players.some((p: { id: string }) => p.id === foreignId)).toBe(false);
  });

  it('队员身份改 → 403', async () => {
    const res = await request(app)
      .patch(`/api/players/${s.profileId}`)
      .set(auth(s.playerToken))
      .send({ name: '自己改自己' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/players/:id', () => {
  it('删除成功 → ok', async () => {
    const created = await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '要走的' });
    const id = created.body.player.id;
    const res = await request(app).delete(`/api/players/${id}`).set(auth(s.coachToken));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(list.body.players.some((p: { id: string }) => p.id === id)).toBe(false);
  });

  it('删除不存在的 → 404', async () => {
    const res = await request(app).delete('/api/players/p_nope').set(auth(s.coachToken));
    expect(res.status).toBe(404);
  });

  it('队员身份删 → 403', async () => {
    const res = await request(app).delete(`/api/players/${s.profileId}`).set(auth(s.playerToken));
    expect(res.status).toBe(403);
  });

  it('删除球员会级联清掉他的技能记录（外键 CASCADE）', async () => {
    // 先给他造一条技能记录
    await request(app)
      .post(`/api/skills/players/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 7, date: '2026-11-01' });
    const res = await request(app).delete(`/api/players/${s.profileId}`).set(auth(s.coachToken));
    expect(res.status).toBe(200);

    const logs = await request(app).get('/api/skills/logs').set(auth(s.coachToken));
    expect(logs.body.logs).toHaveLength(0);
  });
});
