/**
 * 鉴权与登录：登录校验、token 边界、限流、改密。
 *
 * 限流是模块级内存 Map（键 = IP|用户名）：文件内所有用例共享。
 * 涉及连续失败计数的用例一律用独立用户名，避免污染别的用例。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app, resetDb, seedTeam, auth, type SeedTeam } from './helpers';

const SECRET = 'test-secret-volleyball';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

describe('POST /api/auth/login 参数校验', () => {
  it('缺密码 → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('用户名太短 → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'a', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('用户名带非法字符 → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: '管理员!', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('用户名自动转小写后能登录', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'Admin1', password: 'pass123456' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('请求体不是 JSON → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('not-json');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login 凭证', () => {
  it('用户名不存在 → 401，文案与密码错误一致（防枚举）', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'nouser', password: 'x' });
    expect(res.status).toBe(401);
    const res2 = await request(app).post('/api/auth/login').send({ username: 'admin1', password: 'wrong' });
    expect(res2.status).toBe(401);
    expect(res.body.message).toBe(res2.body.message);
  });

  it('密码错误 → 401 bad_credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin1', password: 'wrong!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_credentials');
  });

  it('正确凭证 → 200，返回 token / 用户 / 球队 / 角色 / 设置', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'coach1', password: 'pass123456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('coach1');
    expect(res.body.team.id).toBe(s.teamId);
    expect(res.body.team.name).toBe('测试排球队');
    expect(res.body.role).toBe('coach');
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.settings).toEqual({ template: [], theme: 'aurora', ai: null });
  });

  it('停用账号 → 403 account_disabled', async () => {
    await request(app)
      .patch(`/api/accounts/${s.coachId}`)
      .set(auth(s.adminToken))
      .send({ status: 'disabled' });
    const res = await request(app).post('/api/auth/login').send({ username: 'coach1', password: 'pass123456' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('account_disabled');
  });
});

describe('登录限流（同 IP+用户名 连续失败 5 次锁 15 分钟）', () => {
  it('连续失败 5 次 → 第 6 次直接 429', async () => {
    const body = { username: 'lockme', password: 'wrong' };
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/login').send(body);
      expect(r.status).toBe(401);
    }
    const res = await request(app).post('/api/auth/login').send(body);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
  });

  it('锁定只针对同一个用户名，换个用户名不受影响', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ username: 'lockme2', password: 'wrong' });
    }
    const res = await request(app).post('/api/auth/login').send({ username: 'admin1', password: 'pass123456' });
    expect(res.status).toBe(200);
  });

  it('登录成功会清空失败计数', async () => {
    for (let i = 0; i < 4; i++) {
      await request(app).post('/api/auth/login').send({ username: 'player1', password: 'wrong' });
    }
    // 第 5 次成功 → 计数清零，之后再失败 4 次也不会锁
    await request(app).post('/api/auth/login').send({ username: 'player1', password: 'pass123456' });
    for (let i = 0; i < 4; i++) {
      await request(app).post('/api/auth/login').send({ username: 'player1', password: 'wrong' });
    }
    const res = await request(app).post('/api/auth/login').send({ username: 'player1', password: 'pass123456' });
    expect(res.status).toBe(200);
  });
});

describe('token 边界（requireAuth / verifyUser）', () => {
  it('无 token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('格式错误的 Bearer → 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
  });

  it('签名不对的 token → 401 token_expired 语义（重新登录）', async () => {
    const bad = jwt.sign({ uid: s.adminId }, 'other-secret');
    const res = await request(app).get('/api/auth/me').set(auth(bad));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_expired');
  });

  it('过期 token → 401', async () => {
    const expired = jwt.sign({ uid: s.adminId }, SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/api/auth/me').set(auth(expired));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_expired');
  });

  it('uid 指向不存在的账号 → 401', async () => {
    const ghost = jwt.sign({ uid: 'u_ghost' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/me').set(auth(ghost));
    expect(res.status).toBe(401);
  });

  it('uid 缺失 → 401', async () => {
    const noUid = jwt.sign({ foo: 1 }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/me').set(auth(noUid));
    expect(res.status).toBe(401);
  });

  it('有效 token → /me 返回用户 + 球队 + 角色 + 设置', async () => {
    const res = await request(app).get('/api/auth/me').set(auth(s.coachToken));
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('coach1');
    expect(res.body.team.id).toBe(s.teamId);
    expect(res.body.role).toBe('coach');
  });

  it('停用球队：业务接口全员 403 team_disabled', async () => {
    await request(app).patch(`/api/admin/teams/${s.teamId}`).set(auth(s.adminToken)).send({ status: 'disabled' });
    const res = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('team_disabled');
  });

  it('不在任何球队 → 403 no_team', async () => {
    // 直接造一个没有 membership 的账号
    const { db } = await import('../src/db');
    const ts = Date.now();
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
       VALUES ('u_lone', 'lone', 'lone@local', 'x', '无队的人', 0, 'active', NULL, ?)`
    ).run(ts);
    const token = jwt.sign({ uid: 'u_lone' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/players').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_team');
  });
});

describe('X-Team-Id：一人多队的切换', () => {
  it('默认取加入的第一个队；指定 X-Team-Id 后切到对应队', async () => {
    const { db, newId, now } = await import('../src/db');
    const teamB = newId('t');
    db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamB, '二队', now());
    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      s.coachId,
      teamB,
      'coach',
      now()
    );

    const def = await request(app).get('/api/auth/me').set(auth(s.coachToken));
    expect(def.body.team.id).toBe(s.teamId); // 按加入顺序取第一队

    const switched = await request(app).get('/api/auth/me').set(auth(s.coachToken)).set('X-Team-Id', teamB);
    expect(switched.body.team.id).toBe(teamB);
  });

  it('X-Team-Id 指向自己没加入的队 → 403 no_team', async () => {
    const { newId, now } = await import('../src/db');
    const other = newId('t');
    const { db } = await import('../src/db');
    db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(other, '外队', now());
    const res = await request(app).get('/api/auth/me').set(auth(s.coachToken)).set('X-Team-Id', other);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_team');
  });
});

describe('POST /api/auth/password 改密', () => {
  it('旧密码错误 → 400', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .set(auth(s.coachToken))
      .send({ oldPassword: 'nope', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_password');
  });

  it('新旧密码相同 → 400', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .set(auth(s.coachToken))
      .send({ oldPassword: 'pass123456', newPassword: 'pass123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('same_password');
  });

  it('新密码太短 → 400', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .set(auth(s.coachToken))
      .send({ oldPassword: 'pass123456', newPassword: 'abc' });
    expect(res.status).toBe(400);
  });

  it('改密成功：旧密码失效，新密码能登录，must_change_pw 清零', async () => {
    const { db } = await import('../src/db');
    db.prepare('UPDATE users SET must_change_pw = 1 WHERE id = ?').run(s.coachId);

    const res = await request(app)
      .post('/api/auth/password')
      .set(auth(s.coachToken))
      .send({ oldPassword: 'pass123456', newPassword: 'newpass123' });
    expect(res.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set(auth(s.coachToken));
    expect(me.body.user.mustChangePassword).toBe(false);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach1', password: 'pass123456' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'coach1', password: 'newpass123' });
    expect(newLogin.status).toBe(200);
  });

  it('未登录改密 → 401', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .send({ oldPassword: 'x', newPassword: 'xxxxxx' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/teams 我加入的所有队', () => {
  it('返回角色和加入时间，按加入顺序排列', async () => {
    const res = await request(app).get('/api/auth/teams').set(auth(s.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams[0]).toMatchObject({ id: s.teamId, role: 'admin' });
  });
});
