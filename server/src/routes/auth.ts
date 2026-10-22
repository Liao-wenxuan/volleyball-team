import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, newId, now } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, signToken, type AuthedRequest } from '../auth';
import { DEFAULT_FORMATION, DEFAULT_TEMPLATE } from '../defaults';
import { getSettings } from '../repo';

const router = Router();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(6, '密码至少 6 位'),
  name: z.string().trim().min(1, '请填名字').max(20),
  teamName: z.string().trim().min(1, '请填球队名').max(30)
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(1, '请填密码')
});

function payload(userId: string) {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId) as {
    id: string;
    email: string;
    name: string;
  };
  const team = db
    .prepare(
      'SELECT t.id, t.name FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY m.joined_at LIMIT 1'
    )
    .get(userId) as { id: string; name: string };
  return { token: signToken(userId), user, team, settings: getSettings(team.id) };
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = parse(registerSchema, req.body);

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (exists) throw new HttpError(409, '这个邮箱已经注册过了', 'email_taken');

    const userId = newId('u');
    const teamId = newId('t');
    const ts = now();
    const hash = bcrypt.hashSync(body.password, 10);

    // 建号 + 建队 + 默认模板 + 默认站位，一次性事务，别留半成品账号
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
        userId,
        body.email,
        hash,
        body.name,
        ts
      );
      db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, body.teamName, ts);
      db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        userId,
        teamId,
        'owner',
        ts
      );
      db.prepare('INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, ?, ?)').run(
        teamId,
        JSON.stringify(DEFAULT_TEMPLATE),
        'aurora',
        ts
      );
      db.prepare('INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)').run(
        teamId,
        DEFAULT_FORMATION.preset,
        JSON.stringify(DEFAULT_FORMATION.pos),
        ts
      );
    });
    tx();

    res.status(201).json(payload(userId));
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(body.email) as
      | { id: string; password_hash: string }
      | undefined;
    // 不区分「邮箱不存在」和「密码错误」，避免被枚举账号
    if (!row || !bcrypt.compareSync(body.password, row.password_hash)) {
      throw new HttpError(401, '邮箱或密码不对', 'bad_credentials');
    }
    res.json(payload(row.id));
  })
);

router.get('/me', requireAuth, (req, res) => {
  const r = req as unknown as AuthedRequest;
  res.json({ user: r.user, teamId: r.teamId, settings: getSettings(r.teamId) });
});

export default router;
