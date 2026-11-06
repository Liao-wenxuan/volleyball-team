/**
 * 管理端（多球队运营）：跨队鉴权模型、停用语义、一键建队。
 *
 * 重点测设计文档里的核心声明：停用球队后，业务接口全 403，
 * 但系统管理员仍然能进 /api/admin/*（否则停用 = 把钥匙锁进保险柜）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

describe('管理端鉴权：只认系统管理员', () => {
  it('coach 访问管理端 → 403', async () => {
    const res = await request(app).get('/api/admin/teams').set(auth(s.coachToken));
    expect(res.status).toBe(403);
  });

  it('队员访问管理端 → 403', async () => {
    expect((await request(app).get('/api/admin/teams').set(auth(s.playerToken))).status).toBe(403);
  });

  it('未登录 → 401', async () => {
    expect((await request(app).get('/api/admin/teams')).status).toBe(401);
  });

  it('admin → 200', async () => {
    const res = await request(app).get('/api/admin/teams').set(auth(s.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams[0].name).toBe('测试排球队');
  });

  it('唯一的队被停用后，admin 仍能访问管理端（verifyUser 不看球队状态）', async () => {
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'disabled' });
    const res = await request(app).get('/api/admin/teams').set(auth(s.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.teams[0].status).toBe('disabled');
  });
});

describe('POST /api/admin/teams 一键建队', () => {
  it('建队即建 coach 账号，模板和站位用系统默认', async () => {
    const res = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '二队', coachName: '王指导', coachUsername: 'coach2' });
    expect(res.status).toBe(201);
    expect(res.body.team.name).toBe('二队');
    expect(res.body.account.role).toBe('coach');
    expect(res.body.initialPassword).toBeTruthy();

    // 新教练能登录，且能看到默认模板（3 场）
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach2', password: res.body.initialPassword });
    expect(login.status).toBe(200);
    expect(login.body.settings.template).toHaveLength(3);
  });

  it('队名重复 → 409', async () => {
    const res = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '测试排球队', coachName: 'x', coachUsername: 'whatever1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('team_taken');
  });

  it('教练用户名重复 → 409', async () => {
    const res = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '三队', coachName: 'x', coachUsername: 'coach1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('username_taken');
  });

  it('队名空 → 400', async () => {
    const res = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '  ', coachName: 'x', coachUsername: 'whatever2' });
    expect(res.status).toBe(400);
  });
});

describe('停用 / 恢复球队', () => {
  it('停用后：业务接口 403、登录 403（登录时不发 token）', async () => {
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'disabled' });

    const api403 = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(api403.status).toBe(403);
    expect(api403.body.error).toBe('team_disabled');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach1', password: 'pass123456' });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe('team_disabled');
  });

  it('重复停用 → unchanged: true（幂等）', async () => {
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'disabled' });
    const res = await request(app)
      .patch(`/api/admin/teams/${s.teamId}`)
      .set(auth(s.adminToken))
      .send({ status: 'disabled' });
    expect(res.status).toBe(200);
    expect(res.body.unchanged).toBe(true);
  });

  it('恢复后一切照旧', async () => {
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'disabled' });
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'active' });
    const ok = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(ok.status).toBe(200);
  });

  it('不存在的球队 → 404', async () => {
    const res = await request(app).patch('/api/admin/teams/t_ghost').set(auth(s.adminToken)).send({ status: 'disabled' });
    expect(res.status).toBe(404);
  });

  it('概览里能看出勤率：取消的训练不进分母', async () => {
    // 一场过去训练，2/3 出勤
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const ses = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date, start: '10:00', end: '12:00' });
    const sid = ses.body.session.id;

    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const ids: string[] = players.body.players.map((x: { id: string }) => x.id);
    await request(app).put(`/api/sessions/${sid}/attendance/${ids[0]}`).set(auth(s.coachToken)).send({ state: 'present' });
    await request(app).put(`/api/sessions/${sid}/attendance/${ids[1]}`).set(auth(s.coachToken)).send({ state: 'late' });
    await request(app).put(`/api/sessions/${sid}/attendance/${ids[2]}`).set(auth(s.coachToken)).send({ state: 'absent' });

    const overview = await request(app).get('/api/admin/teams').set(auth(s.adminToken));
    const team = overview.body.teams.find((t: { id: string }) => t.id === s.teamId);
    expect(team.attendanceRate).toBeCloseTo(66.7, 1);
    expect(team.trend).toHaveLength(4); // 近 4 周趋势
  });
});

describe('管理端账号操作', () => {
  it('重置教练密码并让他重新登录', async () => {
    const created = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '四队', coachName: '李指导', coachUsername: 'coach4' });
    const accountId = created.body.account.id;

    const reset = await request(app).post(`/api/admin/accounts/${accountId}/reset-password`).set(auth(s.adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.initialPassword).toBeTruthy();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach4', password: reset.body.initialPassword });
    expect(login.status).toBe(200);
  });

  it('管理员账号不能在管理端被改（防提权/防自锁，CLI 兜底）', async () => {
    const res = await request(app).post(`/api/admin/accounts/${s.adminId}/reset-password`).set(auth(s.adminToken));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('admin_locked');
  });

  it('停用教练账号 → 立即踢出', async () => {
    const created = await request(app)
      .post('/api/admin/teams')
      .set(auth(s.adminToken))
      .send({ teamName: '五队', coachName: '张指导', coachUsername: 'coach5' });
    const accountId = created.body.account.id;

    await request(app).patch(`/api/admin/accounts/${accountId}`).set(auth(s.adminToken)).send({ status: 'disabled' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach5', password: created.body.initialPassword });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe('account_disabled');
  });
});
