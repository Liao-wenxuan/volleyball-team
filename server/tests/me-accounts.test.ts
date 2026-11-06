/**
 * 队员端「我的」：数据隔离（只看自己）、出勤率口径、请假规则。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, auth, type SeedTeam } from './helpers';
import { signToken } from '../src/auth';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

/** 建一场未来训练（明天），返回 id。明天不可能「已开始」，请假规则稳定可测 */
async function futureSession(daysAhead = 1) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const res = await request(app)
    .post('/api/sessions')
    .set(auth(s.coachToken))
    .send({ date, start: '23:59', end: '23:59', venue: '测试馆' });
  return res.body.session as { id: string; date: string };
}

/** 建一场过去的训练（昨天，已结束） */
async function pastSession(daysAgo = 1) {
  return futureSession(-daysAgo);
}

describe('GET /api/me/summary 数据边界', () => {
  it('没绑球员档案的账号 → player: null', async () => {
    const res = await request(app).get('/api/me/summary').set(auth(s.coachToken)); // coach 没绑
    expect(res.status).toBe(200);
    expect(res.body.player).toBeNull();
  });

  it('绑定的队员只看到自己的数据', async () => {
    const res = await request(app).get('/api/me/summary').set(auth(s.playerToken));
    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe('小林');
    expect(res.body.player.id).toBe(s.profileId);
    expect(res.body.team).toBe('测试排球队');
  });

  it('出勤率口径：取消的训练不算，present+late 算出勤', async () => {
    // 两天过去训练：一场正常（present），一场取消
    const y1 = await pastSession(1);
    await request(app)
      .put(`/api/sessions/${y1.id}/attendance/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    const y2 = await pastSession(2);
    await request(app).patch(`/api/sessions/${y2.id}`).set(auth(s.coachToken)).send({ status: 'cancelled', cancelReason: '雨' });

    const res = await request(app).get('/api/me/summary').set(auth(s.playerToken));
    expect(res.body.stats.total).toBe(1); // 取消的不计
    expect(res.body.stats.present).toBe(1);
    expect(res.body.stats.rate).toBe(100);
  });

  it('late 也算出勤：1 late + 1 absent → 50%', async () => {
    const y1 = await pastSession(1);
    await request(app)
      .put(`/api/sessions/${y1.id}/attendance/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ state: 'late' });
    const y2 = await pastSession(2);
    await request(app)
      .put(`/api/sessions/${y2.id}/attendance/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ state: 'absent' });

    const res = await request(app).get('/api/me/summary').set(auth(s.playerToken));
    expect(res.body.stats.marked).toBe(2);
    expect(res.body.stats.rate).toBe(50);
  });

  it('下一次训练：返回未来未取消的最早一场', async () => {
    await futureSession(3);
    const tomorrow = await futureSession(1);
    const res = await request(app).get('/api/me/summary').set(auth(s.playerToken));
    expect(res.body.next.id).toBe(tomorrow.id);
  });
});

describe('POST /api/me/leave 队员请假', () => {
  it('对未来训练请假 → leave', async () => {
    const ses = await futureSession();
    const res = await request(app)
      .post('/api/me/leave')
      .set(auth(s.playerToken))
      .send({ sessionId: ses.id });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('leave');
  });

  it('取消自己请的假 → 恢复未登记', async () => {
    const ses = await futureSession();
    await request(app).post('/api/me/leave').set(auth(s.playerToken)).send({ sessionId: ses.id });
    const res = await request(app)
      .post('/api/me/leave')
      .set(auth(s.playerToken))
      .send({ sessionId: ses.id, cancel: true });
    expect(res.status).toBe(200);
    expect(res.body.state).toBeNull();
  });

  it('只能取消自己请的假：教练已改成 absent 就不许动', async () => {
    const ses = await futureSession();
    await request(app)
      .put(`/api/sessions/${ses.id}/attendance/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ state: 'absent' });
    const res = await request(app)
      .post('/api/me/leave')
      .set(auth(s.playerToken))
      .send({ sessionId: ses.id, cancel: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_mine');
  });

  it('教练已登记出勤（present）→ 不能再请假，要去联系教练', async () => {
    const ses = await futureSession();
    await request(app)
      .put(`/api/sessions/${ses.id}/attendance/${s.profileId}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    const res = await request(app).post('/api/me/leave').set(auth(s.playerToken)).send({ sessionId: ses.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('already_marked');
  });

  it('已开始的训练不能请假', async () => {
    const ses = await pastSession();
    const res = await request(app).post('/api/me/leave').set(auth(s.playerToken)).send({ sessionId: ses.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_late');
  });

  it('已取消的训练不用请假', async () => {
    const ses = await futureSession();
    await request(app)
      .patch(`/api/sessions/${ses.id}`)
      .set(auth(s.coachToken))
      .send({ status: 'cancelled', cancelReason: '雨' });
    const res = await request(app).post('/api/me/leave').set(auth(s.playerToken)).send({ sessionId: ses.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cancelled');
  });

  it('没绑球员档案 → 400 no_player', async () => {
    const ses = await futureSession();
    const res = await request(app).post('/api/me/leave').set(auth(s.coachToken)).send({ sessionId: ses.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_player');
  });

  it('训练不存在 → 404', async () => {
    const res = await request(app).post('/api/me/leave').set(auth(s.playerToken)).send({ sessionId: 's_ghost' });
    expect(res.status).toBe(404);
  });
});

describe('账号管理 /api/accounts', () => {
  it('admin 建教练账号：返回一次性初始密码，登录成功且必须改密', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set(auth(s.adminToken))
      .send({ username: 'coach2', name: '新教练', role: 'coach' });
    expect(res.status).toBe(201);
    expect(res.body.initialPassword).toHaveLength(10);
    expect(res.body.account.mustChangePassword).toBe(true);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach2', password: res.body.initialPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
  });

  it('admin 建队员账号并绑定档案：登录后 summary 能看到自己', async () => {
    // 先建一个未绑定的球员
    const p = await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '新人', number: 20 });
    const pid = p.body.player.id;

    const acc = await request(app)
      .post('/api/accounts')
      .set(auth(s.adminToken))
      .send({ username: 'player2', name: '新人', role: 'player', playerId: pid });
    expect(acc.status).toBe(201);

    const me = await request(app)
      .get('/api/me/summary')
      .set('Authorization', `Bearer ${signToken(acc.body.account.id)}`);
    expect(me.body.player.name).toBe('新人');
  });

  it('用户名重复 → 409', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set(auth(s.adminToken))
      .send({ username: 'coach1', name: '重复', role: 'coach' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('username_taken');
  });

  it('队员账号必须绑定球员档案', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set(auth(s.adminToken))
      .send({ username: 'player3', name: '没绑定', role: 'player' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('need_player');
  });

  it('一个球员档案只能绑一个账号 → 409', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set(auth(s.adminToken))
      .send({ username: 'player4', name: '抢档案', role: 'player', playerId: s.profileId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('player_taken');
  });

  it('coach 能建 player、不能建 coach（权限不许自己长出来）', async () => {
    const ok = await request(app)
      .post('/api/accounts')
      .set(auth(s.coachToken))
      .send({ username: 'player5', name: '队员x', role: 'player' });
    expect(ok.status).toBe(400); // player 角色必须带 playerId → 400 是因为缺绑定，不是权限

    const okBind = await request(app)
      .post('/api/accounts')
      .set(auth(s.coachToken))
      .send({ username: 'player6', name: '队员y', role: 'player', playerId: (await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '队员y', number: 21 })).body.player.id });
    expect(okBind.status).toBe(201);

    const denied = await request(app)
      .post('/api/accounts')
      .set(auth(s.coachToken))
      .send({ username: 'coach3', name: '想当教练', role: 'coach' });
    expect(denied.status).toBe(403);
  });

  it('coach 重置教练密码 → 403；admin 重置 → 返回新密码且旧密码失效', async () => {
    const denied = await request(app).post(`/api/accounts/${s.adminId}/reset-password`).set(auth(s.coachToken));
    expect(denied.status).toBe(403);

    const ok = await request(app).post(`/api/accounts/${s.coachId}/reset-password`).set(auth(s.adminToken));
    expect(ok.status).toBe(200);
    expect(ok.body.initialPassword).toBeTruthy();

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach1', password: 'pass123456' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach1', password: ok.body.initialPassword });
    expect(newLogin.status).toBe(200);
  });

  it('admin 不能停用自己的账号', async () => {
    const res = await request(app)
      .patch(`/api/accounts/${s.adminId}`)
      .set(auth(s.adminToken))
      .send({ status: 'disabled' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('self_disable');
  });

  it('不能降级另一个管理员账号（防自锁）', async () => {
    // 再造一个 admin（同一个队的两个管理员），A 改 B 的角色
    const { db, newId, now } = await import('../src/db');
    const second = newId('u');
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
       VALUES (?, 'admin2', 'admin2@local', 'x', '二号管理', 0, 'active', NULL, ?)`
    ).run(second, now());
    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      second,
      s.teamId,
      'admin',
      now()
    );

    const res = await request(app)
      .patch(`/api/accounts/${second}`)
      .set(auth(s.adminToken))
      .send({ role: 'player' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('admin_locked');
  });

  it('停用账号后原 token 立即失效（verifyUser 每次查库）', async () => {
    await request(app)
      .patch(`/api/accounts/${s.coachId}`)
      .set(auth(s.adminToken))
      .send({ status: 'disabled' });
    const res = await request(app).get('/api/auth/me').set(auth(s.coachToken));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('account_disabled');
  });

  it('candidates 只列还没绑账号的球员', async () => {
    const res = await request(app).get('/api/accounts/candidates').set(auth(s.adminToken));
    const names = res.body.players.map((p: { name: string }) => p.name);
    expect(names).not.toContain('小林'); // 已绑定
    expect(names).toContain('队员1');
  });
});
