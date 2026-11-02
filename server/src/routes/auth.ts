import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Request } from 'express';
import { db, newId, now } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, signToken, type AuthedRequest } from '../auth';
import { DEFAULT_FORMATION, DEFAULT_TEMPLATE } from '../defaults';
import { getSettings } from '../repo';

const router = Router();

/* ══════════ 限流：同 IP+邮箱 连续失败 5 次锁 15 分钟 ══════════
 * 内存计数，重启清零 —— 对一台小服务器足够，不值得为此引 redis。
 * 键用 IP+邮箱而不是纯 IP：学生都在校园网同一个出口 IP，
 * 纯 IP 计数会让「一个人输错密码」锁掉整个宿舍网。
 * 服务端在 Caddy 反代后面，真实 IP 取 x-forwarded-for 第一段。 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const attempts = new Map<string, { fails: number; lockUntil: number }>();

function attemptKey(req: Request, scope: string): string {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  const ip = fwd.split(',')[0].trim() || req.ip || 'unknown';
  return `${ip}|${scope}`;
}

function guardRate(req: Request, scope: string) {
  const a = attempts.get(attemptKey(req, scope));
  if (a && a.lockUntil > Date.now()) {
    const mins = Math.ceil((a.lockUntil - Date.now()) / 60000);
    throw new HttpError(429, `尝试次数过多，请 ${mins} 分钟后再试`, 'rate_limited');
  }
}

function markFail(req: Request, scope: string) {
  const k = attemptKey(req, scope);
  const a = attempts.get(k) || { fails: 0, lockUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockUntil = Date.now() + WINDOW_MS;
    a.fails = 0;
  }
  attempts.set(k, a);
}

function markOk(req: Request, scope: string) {
  attempts.delete(attemptKey(req, scope));
}

/* ══════════ 校验 ══════════ */

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(6, '密码至少 6 位'),
  name: z.string().trim().min(1, '请填名字').max(20),
  teamName: z.string().trim().max(30).optional(),
  // 填了邀请码 → 加入已有球队（队员身份）；不填 → 自建新队当队长
  inviteCode: z.string().trim().length(6, '邀请码应为 6 位').optional()
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(1, '请填密码')
});

const passwordSchema = z.object({
  oldPassword: z.string().min(1, '请填当前密码'),
  newPassword: z.string().min(6, '新密码至少 6 位')
});

/* ══════════ 工具 ══════════ */

function getRole(userId: string, teamId: string): 'owner' | 'editor' | 'viewer' {
  const m = db
    .prepare('SELECT role FROM team_members WHERE user_id = ? AND team_id = ?')
    .get(userId, teamId) as { role: 'owner' | 'editor' | 'viewer' } | undefined;
  return m ? m.role : 'viewer';
}

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
  const res = {
    token: signToken(userId),
    user,
    team,
    role: getRole(userId, team.id),
    settings: getSettings(team.id)
  };
  return res;
}

/** 校验邀请码：不存在 / 已撤销 / 已过期 都返回 null（不区分原因，避免被探测） */
export function validInvite(code: string) {
  const row = db
    .prepare('SELECT code, team_id, expires_at, revoked FROM invites WHERE code = ?')
    .get(code.toUpperCase()) as
    | { code: string; team_id: string; expires_at: number; revoked: number }
    | undefined;
  if (!row || row.revoked) return null;
  if (row.expires_at < now()) return null;
  return row;
}

/* ══════════ 路由 ══════════ */

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    guardRate(req, 'reg');
    const body = parse(registerSchema, req.body);

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (exists) {
      markFail(req, 'reg');
      throw new HttpError(409, '这个邮箱已经注册过了', 'email_taken');
    }

    // 凭邀请码：加入已有球队，角色是队员（只读）；否则自建新队当队长
    let joinTeamId: string | null = null;
    if (body.inviteCode) {
      const inv = validInvite(body.inviteCode);
      if (!inv) throw new HttpError(400, '邀请码无效或已过期，请找管理员确认', 'bad_invite');
      joinTeamId = inv.team_id;
    } else if (!body.teamName) {
      throw new HttpError(400, '请填球队名，或填写邀请码加入已有球队', 'bad_request');
    }

    const userId = newId('u');
    const teamId = joinTeamId || newId('t');
    const role = joinTeamId ? 'viewer' : 'owner';
    const ts = now();

    // 建号 + 入队（或建队 + 默认模板 + 默认站位），一次性事务，别留半成品账号
    // 顺序有讲究：teams 必须先于 team_members（外键指向它）
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
        userId,
        body.email,
        bcrypt.hashSync(body.password, 10),
        body.name,
        ts
      );
      if (!joinTeamId) {
        db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, body.teamName, ts);
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
      }
      db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        userId,
        teamId,
        role,
        ts
      );
    });
    tx();

    markOk(req, 'reg');
    res.status(201).json(payload(userId));
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    guardRate(req, loginScope(req));
    const body = parse(loginSchema, req.body);
    // 不区分「邮箱不存在」和「密码错误」，避免被枚举账号
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(body.email) as
      | { id: string; password_hash: string }
      | undefined;
    if (!row || !bcrypt.compareSync(body.password, row.password_hash)) {
      markFail(req, loginScope(req));
      throw new HttpError(401, '邮箱或密码不对', 'bad_credentials');
    }
    markOk(req, loginScope(req));
    res.json(payload(row.id));
  })
);

/** 登录限流的 scope 取邮箱；请求体没带邮箱时兜底成 '?' */
function loginScope(req: Request): string {
  const b = req.body as { email?: string } | undefined;
  const e = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  return e || '?';
}

router.get('/me', requireAuth, (req, res) => {
  const r = req as unknown as AuthedRequest;
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(r.teamId) as { id: string; name: string };
  res.json({ user: r.user, team, role: r.role, settings: getSettings(r.teamId) });
});

/** 我加入的所有队（顶栏切换用） */
router.get('/teams', requireAuth, (req, res) => {
  const r = req as unknown as AuthedRequest;
  const teams = db
    .prepare(
      `SELECT t.id, t.name, m.role, m.joined_at AS joinedAt
       FROM teams t JOIN team_members m ON m.team_id = t.id
       WHERE m.user_id = ? ORDER BY m.joined_at`
    )
    .all(r.user.id);
  res.json({ teams });
});

/** 修改密码：验旧密码再写新的，和登录一样不分旧密码错/账号错以外的情况 */
router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(passwordSchema, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(r.user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !bcrypt.compareSync(b.oldPassword, row.password_hash)) {
      throw new HttpError(400, '当前密码不对', 'bad_password');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(b.newPassword, 10),
      r.user.id
    );
    res.json({ ok: true });
  })
);

export default router;
