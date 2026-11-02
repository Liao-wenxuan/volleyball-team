import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, requireRole, type AuthedRequest } from '../auth';
import { validInvite } from './auth';
import { getSettings } from '../repo';

/**
 * 球队内部管理：邀请码、入队、成员管理。
 *
 * 权限矩阵（role 存在 team_members，CHECK 约束 owner/editor/viewer）：
 * - 邀请码增删查：owner / editor
 * - 凭码入队：任何已登录用户（这是入队唯一入口）
 * - 改角色 / 移除成员：仅 owner；owner 本身不可被降级或移除
 * - 退出球队：自己可以退，但 owner 不行（先把队长转给别人）
 */
const router = Router();
router.use(requireAuth);

/* ── 邀请码 ── */

// 去掉 0/1/I/L/O 这些易混字符，口头报码不出错
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const MAX_ACTIVE_INVITES = 5;

function genCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

router.get(
  '/invites',
  requireRole('owner', 'editor'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const invites = db
      .prepare(
        `SELECT code, created_at AS createdAt, expires_at AS expiresAt, revoked
         FROM invites WHERE team_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(r.teamId);
    res.json({ invites });
  })
);

router.post(
  '/invites',
  requireRole('owner', 'editor'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const active = db
      .prepare('SELECT COUNT(*) AS n FROM invites WHERE team_id = ? AND revoked = 0 AND expires_at > ?')
      .get(r.teamId, now()) as { n: number };
    if (active.n >= MAX_ACTIVE_INVITES) {
      throw new HttpError(400, `有效邀请码最多 ${MAX_ACTIVE_INVITES} 个，请先撤销不用的`, 'too_many_invites');
    }
    // 撞码重试（6 位 31 进制，空间 ~9 亿，基本不会撞）
    let code = genCode();
    for (let i = 0; i < 5; i++) {
      const dup = db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code);
      if (!dup) break;
      code = genCode();
    }
    const ts = now();
    db.prepare(
      'INSERT INTO invites (code, team_id, created_by, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(code, r.teamId, r.user.id, ts, ts + INVITE_TTL);
    res.status(201).json({ code, expiresAt: ts + INVITE_TTL });
  })
);

router.delete(
  '/invites/:code',
  requireRole('owner', 'editor'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const info = db
      .prepare('UPDATE invites SET revoked = 1 WHERE code = ? AND team_id = ?')
      .run(String(req.params.code).toUpperCase(), r.teamId);
    if (info.changes === 0) throw new HttpError(404, '邀请码不存在', 'not_found');
    res.json({ ok: true });
  })
);

/* ── 凭码入队（已登录用户加第二支队） ── */

router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(z.object({ code: z.string().trim().length(6, '邀请码应为 6 位') }), req.body);
    const inv = validInvite(b.code);
    if (!inv) throw new HttpError(400, '邀请码无效或已过期，请找管理员确认', 'bad_invite');

    const dup = db
      .prepare('SELECT 1 FROM team_members WHERE user_id = ? AND team_id = ?')
      .get(r.user.id, inv.team_id);
    if (dup) throw new HttpError(409, '你已经在这个队里了', 'already_member');

    const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(inv.team_id) as
      | { id: string; name: string }
      | undefined;
    if (!team) throw new HttpError(404, '球队不存在', 'not_found');

    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      r.user.id,
      inv.team_id,
      'viewer',
      now()
    );
    // 直接切到新队，返回完整上下文省一次 round-trip
    res.status(201).json({
      team,
      role: 'viewer',
      settings: getSettings(inv.team_id)
    });
  })
);

/* ── 成员管理 ── */

router.get('/members', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const members = db
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.joined_at AS joinedAt
       FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at`
    )
    .all(r.teamId);
  res.json({ members });
});

const roleSchema = z.object({ role: z.enum(['editor', 'viewer']) });

/** 改角色：仅 owner；不能改自己，也不能动另一个 owner（当前体系每队只有一个 owner） */
router.patch(
  '/members/:userId',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(roleSchema, req.body);
    if (req.params.userId === r.user.id) {
      throw new HttpError(400, '不能修改自己的角色', 'bad_request');
    }
    const target = db
      .prepare("SELECT role FROM team_members WHERE user_id = ? AND team_id = ?")
      .get(req.params.userId, r.teamId) as { role: string } | undefined;
    if (!target) throw new HttpError(404, '成员不存在', 'not_found');
    if (target.role === 'owner') throw new HttpError(400, '队长不能被改角色', 'bad_request');

    db.prepare('UPDATE team_members SET role = ? WHERE user_id = ? AND team_id = ?').run(
      b.role,
      req.params.userId,
      r.teamId
    );
    res.json({ ok: true });
  })
);

/** 移除成员：owner 可移除他人（不能动 owner/自己）；任何人可以自己退队，但 owner 不能退 */
router.delete(
  '/members/:userId',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const isSelf = req.params.userId === r.user.id;
    if (!isSelf && r.role !== 'owner') {
      throw new HttpError(403, '只有队长可以移除成员', 'forbidden');
    }
    const target = db
      .prepare('SELECT role FROM team_members WHERE user_id = ? AND team_id = ?')
      .get(req.params.userId, r.teamId) as { role: string } | undefined;
    if (!target) throw new HttpError(404, '成员不存在', 'not_found');
    if (target.role === 'owner') {
      throw new HttpError(400, isSelf ? '队长不能退出自己创建的球队' : '队长不能被移除', 'bad_request');
    }

    db.prepare('DELETE FROM team_members WHERE user_id = ? AND team_id = ?').run(req.params.userId, r.teamId);
    res.json({ ok: true, left: isSelf });
  })
);

export default router;
