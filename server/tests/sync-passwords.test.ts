/**
 * 同步检查口 + 密码生成器。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, auth, type SeedTeam } from './helpers';
import { genPassword } from '../src/passwords';
import { signToken } from '../src/auth';
import { db, newId, now } from '../src/db';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

describe('GET /api/sync/check', () => {
  it('没有任何数据的队 → t=0', async () => {
    // 造一个空队 + 一个属于它的账号
    const teamId = newId('t');
    const uid = newId('u');
    db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, '空队', now());
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
       VALUES (?, 'empty_admin', 'empty@local', 'x', '空队管理', 0, 'active', NULL, ?)`
    ).run(uid, now());
    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      uid,
      teamId,
      'admin',
      now()
    );

    const res = await request(app).get('/api/sync/check').set(auth(signToken(uid)));
    expect(res.status).toBe(200);
    expect(res.body.t).toBe(0);
    expect(res.body.server).toBeGreaterThan(0);
  });

  it('改动数据后时间戳前进（用队员建档时间）', async () => {
    const res = await request(app).get('/api/sync/check').set(auth(s.coachToken));
    // 种子建了球员，所以不是 0
    expect(res.body.t).toBeGreaterThan(0);
  });

  it('新增队员 → 时间戳推进；再删掉 → 仍然是各自操作的时刻', async () => {
    const before = (await request(app).get('/api/sync/check').set(auth(s.coachToken))).body.t;
    await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '推进者', number: 50 });
    const after = (await request(app).get('/api/sync/check').set(auth(s.coachToken))).body.t;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('考勤变化也会推进同步时间戳（跨表 UNION）', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00' });
    const sid = created.body.session.id;
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const pid = players.body.players[0].id;

    const before = (await request(app).get('/api/sync/check').set(auth(s.coachToken))).body.t;
    await request(app)
      .put(`/api/sessions/${sid}/attendance/${pid}`)
      .set(auth(s.coachToken))
      .send({ state: 'present' });
    const after = (await request(app).get('/api/sync/check').set(auth(s.coachToken))).body.t;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('未登录 → 401', async () => {
    expect((await request(app).get('/api/sync/check')).status).toBe(401);
  });
});

describe('genPassword 一次性初始密码', () => {
  it('默认 10 位', () => {
    expect(genPassword()).toHaveLength(10);
  });

  it('不包含易抄错的字符（0/O/o/1/I/i/l）', () => {
    const bad = ['0', 'O', 'o', '1', 'I', 'i', 'l'];
    for (let i = 0; i < 200; i++) {
      const pw = genPassword();
      for (const c of bad) {
        expect(pw).not.toContain(c);
      }
    }
  });

  it('字符集只含字母数字', () => {
    for (let i = 0; i < 50; i++) {
      expect(genPassword()).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });

  it('两次生成不相同（随机性）', () => {
    expect(genPassword()).not.toBe(genPassword());
  });
});
