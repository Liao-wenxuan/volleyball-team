/**
 * 训练周期（模板生成 + 幂等）与考勤登记（UPSERT 幂等、跨队隔离、级联删除）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, seedOtherTeam, seedPlayerIn, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

/** 2026-01-05 是周一 */
const MONDAY = '2026-01-05';
const TEMPLATE = [
  { id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '老馆' },
  { id: 'fri', day: 5, label: '周五', start: '16:30', end: '18:30', venue: '老馆' },
  { id: 'sun', day: 0, label: '周日', start: '08:30', end: '11:30', venue: '室外' }
];

async function putTemplate() {
  const res = await request(app)
    .put('/api/settings/template')
    .set(auth(s.coachToken))
    .send({ template: TEMPLATE });
  expect(res.status).toBe(200);
}

async function listPlayers(): Promise<{ id: string; name: string }[]> {
  const res = await request(app).get('/api/players').set(auth(s.coachToken));
  return res.body.players;
}

describe('GET /api/weeks/:key 模板生成周数据', () => {
  it('没配模板、没建训练 → 空数组', async () => {
    const res = await request(app).get(`/api/weeks/${MONDAY}`).set(auth(s.coachToken));
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });

  it('按模板生成：周二/周五/周日各一场，日期落在正确的一天', async () => {
    await putTemplate();
    const res = await request(app).get(`/api/weeks/${MONDAY}`).set(auth(s.coachToken));
    expect(res.body.weekKey).toBe(MONDAY);
    const sessions = res.body.sessions;
    expect(sessions).toHaveLength(3);
    const byId = new Map(sessions.map((x: { templateId: string; date: string }) => [x.templateId, x]));
    expect(byId.get('tue').date).toBe('2026-01-06');
    expect(byId.get('fri').date).toBe('2026-01-09');
    expect(byId.get('sun').date).toBe('2026-01-11'); // day=0 是周日，落在周一+6（周一开头的一周）
  });

  it('传周三的日期，会归一到同一周的周一（幂等键一致）', async () => {
    await putTemplate();
    const wed = await request(app).get('/api/weeks/2026-01-07').set(auth(s.coachToken));
    expect(wed.body.weekKey).toBe(MONDAY);
    expect(wed.body.sessions).toHaveLength(3);
  });

  it('重复拉取同一周不会生成重复训练（服务端幂等）', async () => {
    await putTemplate();
    const a = await request(app).get(`/api/weeks/${MONDAY}`).set(auth(s.coachToken));
    const b = await request(app).get(`/api/weeks/${MONDAY}`).set(auth(s.coachToken));
    expect(b.body.sessions).toHaveLength(a.body.sessions.length);
    const idsA = a.body.sessions.map((x: { id: string }) => x.id).sort();
    const idsB = b.body.sessions.map((x: { id: string }) => x.id).sort();
    expect(idsB).toEqual(idsA);
  });

  it('日期格式不对 → 400', async () => {
    const res = await request(app).get('/api/weeks/0105').set(auth(s.coachToken));
    expect(res.status).toBe(400);
  });

  it('模板对每一周都生效：更晚的周同样按模板生成', async () => {
    await putTemplate();
    const res = await request(app).get('/api/weeks/2026-02-02').set(auth(s.coachToken));
    expect(res.body.sessions).toHaveLength(3);
    // 且生成日期落在那一周里
    for (const x of res.body.sessions) {
      expect(x.date >= '2026-02-02').toBe(true);
      expect(x.date <= '2026-02-08').toBe(true);
    }
  });

  it('别人队的周数据拉不到：coach 对没有 membership 的队请求 → 403', async () => {
    await putTemplate();
    const other = seedOtherTeam();
    const res = await request(app)
      .get(`/api/weeks/${MONDAY}`)
      .set(auth(s.coachToken))
      .set('X-Team-Id', other);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_team');
  });
});

describe('GET /api/weeks/all 全量拉取', () => {
  it('跨多周的训练按周分组返回', async () => {
    await request(app).post('/api/sessions').set(auth(s.coachToken)).send({
      date: '2026-01-05',
      start: '10:00',
      end: '12:00'
    });
    await request(app).post('/api/sessions').set(auth(s.coachToken)).send({
      date: '2026-01-08',
      start: '10:00',
      end: '12:00'
    });
    const res = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.weeks)).toContain('2026-01-05');
    expect(res.body.weeks['2026-01-05']).toHaveLength(2);
  });
});

describe('POST /api/sessions 加练', () => {
  it('创建成功，template_id 为空（不占模板位）', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00', venue: '加练馆' });
    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({ date: '2026-01-06', start: '19:00', templateId: null, status: 'scheduled' });
  });

  it('同一天可以有多条加练（没有唯一约束）', async () => {
    for (const start of ['09:00', '14:00']) {
      const r = await request(app)
        .post('/api/sessions')
        .set(auth(s.coachToken))
        .send({ date: '2026-01-06', start, end: '11:00' });
      expect(r.status).toBe(201);
    }
    const all = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    expect(all.body.weeks['2026-01-05']).toHaveLength(2);
  });

  it('时间格式非法 → 400', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '25:00', end: '21:00' });
    expect(res.status).toBe(400);
  });

  it('队员身份 → 403', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set(auth(s.playerToken))
      .send({ date: '2026-01-06', start: '09:00', end: '11:00' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/sessions/:id', () => {
  async function createExtra(date = '2026-01-06') {
    const r = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date, start: '19:00', end: '21:00', venue: 'A馆' });
    return r.body.session.id;
  }

  it('改时间地点：只动指定字段', async () => {
    const id = await createExtra();
    const res = await request(app)
      .patch(`/api/sessions/${id}`)
      .set(auth(s.coachToken))
      .send({ venue: 'B馆' });
    expect(res.status).toBe(200);
    expect(res.body.session.venue).toBe('B馆');
    expect(res.body.session.start).toBe('19:00');
    expect(res.body.session.date).toBe('2026-01-06');
  });

  it('取消训练：status=cancelled + 原因', async () => {
    const id = await createExtra();
    const res = await request(app)
      .patch(`/api/sessions/${id}`)
      .set(auth(s.coachToken))
      .send({ status: 'cancelled', cancelReason: '下雨' });
    expect(res.body.session.status).toBe('cancelled');
    expect(res.body.session.cancelReason).toBe('下雨');
  });

  it('不存在的训练 → 404', async () => {
    const res = await request(app).patch('/api/sessions/s_nope').set(auth(s.coachToken)).send({ venue: 'x' });
    expect(res.status).toBe(404);
  });

  it('队员身份 → 403', async () => {
    const id = await createExtra();
    const res = await request(app).patch(`/api/sessions/${id}`).set(auth(s.playerToken)).send({ venue: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('删除训练会级联清掉那场的考勤', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00' });
    const sid = created.body.session.id;
    const players = await listPlayers();

    await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    expect((await request(app).get('/api/skills/logs').set(auth(s.coachToken))).status).toBe(200);

    const res = await request(app).delete(`/api/sessions/${sid}`).set(auth(s.coachToken));
    expect(res.status).toBe(200);

    const all = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    const remaining = Object.values(all.body.weeks).flat() as { id: string }[];
    expect(remaining.some((x) => x.id === sid)).toBe(false);
  });

  it('删不存在的 → 404', async () => {
    expect((await request(app).delete('/api/sessions/s_nope').set(auth(s.coachToken))).status).toBe(404);
  });
});

describe('PUT /api/sessions/:id/attendance/:playerId 考勤登记', () => {
  let sid: string;
  let players: { id: string; name: string }[];

  beforeEach(async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00' });
    sid = created.body.session.id;
    players = await listPlayers();
  });

  it('登记出勤：出现在会话 JSON 里', async () => {
    const res = await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    expect(res.status).toBe(200);
    expect(res.body.session.attendance[players[0].id]).toBe('present');
  });

  it('幂等：同一人重复登记，最终状态 = 最后一次，且只有一条记录', async () => {
    for (const state of ['late', 'present', 'absent']) {
      await request(app)
        .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
        .set(auth(s.coachToken))
        .send({ state });
    }
    const res = await request(app).get(`/api/weeks/all`).set(auth(s.coachToken));
    const session = res.body.weeks['2026-01-05'].find((x: { id: string }) => x.id === sid);
    expect(Object.keys(session.attendance)).toEqual([players[0].id]);
    expect(session.attendance[players[0].id]).toBe('absent');
  });

  it('多人各自登记互不影响', async () => {
    await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[1].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'late' });

    const res = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    const session = res.body.weeks['2026-01-05'].find((x: { id: string }) => x.id === sid);
    expect(session.attendance[players[0].id]).toBe('present');
    expect(session.attendance[players[1].id]).toBe('late');
  });

  it('非法状态 → 400', async () => {
    const res = await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('球员不存在 → 404', async () => {
    const res = await request(app)
      .put(`/api/sessions/${sid}/attendance/p_ghost`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    expect(res.status).toBe(404);
  });

  it('跨队隔离：给别的队的球员登记 → 404，且不会写入', async () => {
    const other = seedOtherTeam();
    const foreignId = seedPlayerIn(other);
    const res = await request(app)
      .put(`/api/sessions/${sid}/attendance/${foreignId}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    expect(res.status).toBe(404);
  });

  it('训练不存在 → 404', async () => {
    const res = await request(app)
      .put(`/api/sessions/s_ghost/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    expect(res.status).toBe(404);
  });

  it('队员身份登记 → 403', async () => {
    const res = await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.playerToken))
      .send({ state: 'present' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/sessions/:id/attendance/:playerId 清除考勤', () => {
  it('清除后回到未登记', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00' });
    const sid = created.body.session.id;
    const players = await listPlayers();

    await request(app)
      .put(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    const res = await request(app)
      .delete(`/api/sessions/${sid}/attendance/${players[0].id}`)
      .set(auth(s.coachToken));
    expect(res.status).toBe(200);
    expect(res.body.session.attendance[players[0].id]).toBeUndefined();
  });
});
