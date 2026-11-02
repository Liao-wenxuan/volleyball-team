/**
 * 账号管理：没有注册了，所有账号由管理端发放。
 *
 * 权限
 *   admin  建教练 / 建队员 / 重置任何人密码 / 改角色 / 停用
 *   coach  只能建队员、只能重置本队队员密码（教练不能造教练，避免权限自己长出来）
 *   player 一律 403
 *
 * 队员账号必须绑定一条 players 记录，否则他登录后「我的」页没有数据可看。
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, newId, now, type Role } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, requireRole, type AuthedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

/* ══════════ 校验 ══════════ */

const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, '用户名至少 2 位')
  .max(32, '用户名最多 32 位')
  .regex(/^[a-z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点或横线');

const createSchema = z.object({
  username: usernameRule,
  name: z.string().trim().min(1, '请填姓名').max(20, '姓名最多 20 字'),
  role: z.enum(['coach', 'player']),
  // 队员必填：绑到哪条球员记录上
  playerId: z.string().trim().optional()
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  role: z.enum(['admin', 'coach', 'player']).optional(),
  status: z.enum(['active', 'disabled']).optional()
});

/* ══════════ 工具 ══════════ */

/** 8 位初始密码：去掉 0/O/1/l/I 这些抄错率高的字符 */
function genPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[buf[i] % chars.length];
  return out;
}

function assertCanManage(me: AuthedRequest, targetRole: Role) {
  if (me.role === 'admin') return;
  if (me.role === 'coach' && targetRole === 'player') return;
  throw new HttpError(403, '只有管理员能做这个操作', 'forbidden');
}

/* ══════════ 列表 ══════════ */

router.get('/', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.status, u.must_change_pw AS mustChangePassword,
              u.created_at AS createdAt, m.role,
              p.id AS playerId, p.name AS playerName, p.number AS playerNumber
         FROM users u
         JOIN team_members m ON m.user_id = u.id AND m.team_id = ?
    LEFT JOIN players p ON p.user_id = u.id
        ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END, u.created_at`
    )
    .all(r.teamId);
  res.json({ accounts: rows });
});

/** 还能发号的球员（没被账号占用） */
router.get('/candidates', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const rows = db
    .prepare('SELECT id, name, number, position FROM players WHERE team_id = ? AND user_id IS NULL ORDER BY number')
    .all(r.teamId);
  res.json({ players: rows });
});

/* ══════════ 建号 ══════════ */

router.post(
  '/',
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const me = req as unknown as AuthedRequest;
    const body = parse(createSchema, req.body);
    assertCanManage(me, body.role);

    if (db.prepare('SELECT id FROM users WHERE username = ?').get(body.username)) {
      throw new HttpError(409, '这个用户名已经被占用了', 'username_taken');
    }

    let playerId: string | null = null;
    if (body.role === 'player') {
      if (!body.playerId) throw new HttpError(400, '请选择这个账号对应的球员', 'need_player');
      const p = db
        .prepare('SELECT id, user_id FROM players WHERE id = ? AND team_id = ?')
        .get(body.playerId, me.teamId) as { id: string; user_id: string | null } | undefined;
      if (!p) throw new HttpError(404, '球员不存在', 'not_found');
      if (p.user_id) throw new HttpError(409, '这个球员已经有账号了', 'player_taken');
      playerId = p.id;
    }

    const userId = newId('u');
    const initialPassword = genPassword();
    const ts = now();

    // email 列还留着 NOT NULL，用 username@local 占位；登录只认 username
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`
      ).run(
        userId,
        body.username,
        `${body.username}@local`,
        bcrypt.hashSync(initialPassword, 10),
        body.name,
        me.user.id,
        ts
      );
      db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        userId,
        me.teamId,
        body.role,
        ts
      );
      if (playerId) db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(userId, playerId);
    });
    tx();

    res.status(201).json({
      account: {
        id: userId,
        username: body.username,
        name: body.name,
        role: body.role,
        status: 'active',
        mustChangePassword: true,
        playerId
      },
      // 只在这个响应里出现一次，之后服务器不存明文
      initialPassword
    });
  })
);

/* ══════════ 重置密码 ══════════ */

router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const me = req as unknown as AuthedRequest;
    const target = db
      .prepare(
        `SELECT u.id, u.name, m.role FROM users u JOIN team_members m ON m.user_id = u.id
          WHERE u.id = ? AND m.team_id = ?`
      )
      .get(req.params.id, me.teamId) as { id: string; name: string; role: Role } | undefined;
    if (!target) throw new HttpError(404, '账号不存在', 'not_found');
    assertCanManage(me, target.role);

    const initialPassword = genPassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(
      bcrypt.hashSync(initialPassword, 10),
      target.id
    );
    res.json({ initialPassword });
  })
);

/* ══════════ 改名 / 改角色 / 停用 ══════════ */

router.patch(
  '/:id',
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const me = req as unknown as AuthedRequest;
    const body = parse(patchSchema, req.body);
    const target = db
      .prepare(
        `SELECT u.id, u.name, m.role, u.status FROM users u JOIN team_members m ON m.user_id = u.id
          WHERE u.id = ? AND m.team_id = ?`
      )
      .get(req.params.id, me.teamId) as
      | { id: string; name: string; role: Role; status: string }
      | undefined;
    if (!target) throw new HttpError(404, '账号不存在', 'not_found');

    // 只能动比自己低的角色；也不能停用/降级自己
    if (body.role !== undefined && body.role !== target.role) {
      if (me.role !== 'admin') throw new HttpError(403, '只有管理员能改角色', 'forbidden');
      if (target.id === me.user.id) throw new HttpError(400, '不能改自己的角色', 'self_role');
      if (target.role === 'admin') throw new HttpError(400, '不能降级管理员账号', 'admin_locked');
    }
    if (body.status === 'disabled') {
      if (target.id === me.user.id) throw new HttpError(400, '不能停用自己的账号', 'self_disable');
      assertCanManage(me, target.role);
      if (target.role === 'admin') throw new HttpError(400, '不能停用管理员账号', 'admin_locked');
    }

    const tx = db.transaction(() => {
      if (body.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, target.id);
      if (body.status !== undefined) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, target.id);
      if (body.role !== undefined && body.role !== target.role) {
        db.prepare('UPDATE team_members SET role = ? WHERE user_id = ? AND team_id = ?').run(
          body.role,
          target.id,
          me.teamId
        );
        // 降成队员但还没绑球员 → 允许，只是队员端会没有数据，管理员之后可在人员页补绑
      }
    });
    tx();

    res.json({ ok: true });
  })
);

export default router;
