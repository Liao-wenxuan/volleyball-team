/**
 * 技能调整：批量事务（半失败全回滚）、单人单项、记录列表。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

async function playerIds(): Promise<string[]> {
  const res = await request(app).get('/api/players').set(auth(s.coachToken));
  return res.body.players.map((p: { id: string }) => p.id);
}

describe('POST /api/skills/batch 批量调整', () => {
  it('两项调整一次提交：球员更新 + 每人一条日志', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({
        date: '2026-11-01',
        source: 'training',
        changes: [
          { playerId: ids[0], skill: 'spike', after: 7.5 },
          { playerId: ids[1], skill: 'serve', after: 6 }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const byId = new Map(players.body.players.map((p: { id: string; skills: Record<string, number> }) => [p.id, p]));
    expect(byId.get(ids[0]).skills.spike).toBe(7.5);
    expect(byId.get(ids[1]).skills.serve).toBe(6);
    // 未动过的字段保持 5
    expect(byId.get(ids[0]).skills.serve).toBe(5);

    const logs = await request(app).get('/api/skills/logs').set(auth(s.coachToken));
    expect(logs.body.logs).toHaveLength(2);
  });

  it('delta 记录了前后差值', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({ date: '2026-11-01', changes: [{ playerId: ids[0], skill: 'block', after: 7 }] });
    const log = res.body.logs[0];
    expect(log.before).toBe(5);
    expect(log.after).toBe(7);
    expect(log.delta).toBe(2);
  });

  it('半失败全回滚：第二项指向不存在的球员 → 400，第一项也不生效', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({
        date: '2026-11-01',
        changes: [
          { playerId: ids[0], skill: 'spike', after: 9 },
          { playerId: 'p_ghost', skill: 'serve', after: 9 }
        ]
      });
    expect(res.status).toBe(400);

    // 事务回滚的证据：第一项的修改没有落库，也没有日志
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(players.body.players.find((p: { id: string }) => p.id === ids[0]).skills.spike).toBe(5);
    const logs = await request(app).get('/api/skills/logs').set(auth(s.coachToken));
    expect(logs.body.logs).toHaveLength(0);
  });

  it('非法技能名 → 400', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({ date: '2026-11-01', changes: [{ playerId: ids[0], skill: 'charisma', after: 9 }] });
    expect(res.status).toBe(400);
  });

  it('分值越界 → 400', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({ date: '2026-11-01', changes: [{ playerId: ids[0], skill: 'spike', after: 10.5 }] });
    expect(res.status).toBe(400);
  });

  it('空调整列表 → 400', async () => {
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({ date: '2026-11-01', changes: [] });
    expect(res.status).toBe(400);
  });

  it('日期格式非法 → 400', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.coachToken))
      .send({ date: '1101', changes: [{ playerId: ids[0], skill: 'spike', after: 6 }] });
    expect(res.status).toBe(400);
  });

  it('队员身份 → 403', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post('/api/skills/batch')
      .set(auth(s.playerToken))
      .send({ date: '2026-11-01', changes: [{ playerId: ids[0], skill: 'spike', after: 6 }] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/skills/players/:id 单人单项', () => {
  it('调整成功：before 来自当前值，不是默认值', async () => {
    const ids = await playerIds();
    await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 8, date: '2026-11-01' });

    const res = await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 9, date: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.log.before).toBe(8);
    expect(res.body.log.after).toBe(9);
  });

  it('分值会归到 0.5 的整数倍（roundHalf）', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 7.3, date: '2026-11-01' });
    expect(res.body.player.skills.spike).toBe(7.5);
  });

  it('分值夹在 0~10 之间', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 0, date: '2026-11-01' });
    expect(res.body.player.skills.spike).toBe(0);
  });

  it('球员不存在 → 404', async () => {
    const res = await request(app)
      .post('/api/skills/players/p_ghost')
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 6, date: '2026-11-01' });
    expect(res.status).toBe(404);
  });

  it('set 字段名映射到 set_ 列（二传）', async () => {
    const ids = await playerIds();
    const res = await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'set', after: 8, date: '2026-11-01' });
    expect(res.status).toBe(200);
    expect(res.body.player.skills.set).toBe(8);
  });
});

describe('GET /api/skills/logs', () => {
  it('按时间倒序，limit 参数生效', async () => {
    const ids = await playerIds();
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post(`/api/skills/players/${ids[0]}`)
        .set(auth(s.coachToken))
        .send({ skill: 'spike', after: 5 + i, date: `2026-11-0${i}` });
      // 排序键是创建时刻 at（毫秒），隔开一点避免同毫秒并列导致顺序不稳定
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await request(app).get('/api/skills/logs?limit=3').set(auth(s.coachToken));
    expect(res.body.logs).toHaveLength(3);
    // 倒序：最新在前
    expect(res.body.logs[0].after).toBe(10);
  });

  it('只返回本队的记录（跨队隔离）', async () => {
    const ids = await playerIds();
    await request(app)
      .post(`/api/skills/players/${ids[0]}`)
      .set(auth(s.coachToken))
      .send({ skill: 'spike', after: 6, date: '2026-11-01' });
    const res = await request(app).get('/api/skills/logs').set(auth(s.coachToken));
    expect(res.body.logs.every((l: { playerId: string }) => ids.includes(l.playerId))).toBe(true);
  });
});
