import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Request } from 'express';
import { db } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, signToken, type AuthedRequest } from '../auth';
import { getSettings } from '../repo';

const router = Router();

/* ══════════ 限流：同 IP+用户名 连续失败 5 次锁 15 分钟 ══════════
 * 内存计数，重启清零 —— 对一台小服务器足够，不值得为此引 redis。
 * 键用 IP+用户名而不是纯 IP：学生都在校园网同一个出口 IP，
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

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, '请填用户名')
    .max(32, '用户名太长')
    .regex(/^[a-z0-9_.-]+$/, '用户名只能包含字母、数字、下划线'),
  password: z.string().min(1, '请填密码')
});

const passwordSchema = z.object({
  oldPassword: z.string().min(1, '请填当前密码'),
  newPassword: z.string().min(6, '新密码至少 6 位')
});

/* ══════════ 工具 ══════════ */

/** 登录/注册/me 统一返回体：前端拿到就知道该进哪个端 */
function payload(userId: string) {
  const user = db
    .prepare('SELECT id, username, email, name, must_change_pw FROM users WHERE id = ?')
    .get(userId) as {
    id: string;
    username: string | null;
    email: string;
    name: string;
    must_change_pw: number;
  };

  const team = db
    .prepare(
      `SELECT t.id, t.name, t.status FROM teams t JOIN team_members m ON m.team_id = t.id
        WHERE m.user_id = ? ORDER BY m.joined_at LIMIT 1`
    )
    .get(userId) as { id: string; name: string; status: string } | undefined;
  if (!team) throw new HttpError(403, '账号还没有加入任何球队', 'no_team');
  if (team.status === 'disabled') {
    // 登录时就拦下，不发 token —— 停用队的教练连门都进不来
    throw new HttpError(403, '球队已停用，请联系系统管理员', 'team_disabled');
  }

  const m = db
    .prepare('SELECT role FROM team_members WHERE user_id = ? AND team_id = ?')
    .get(userId, team.id) as { role: string };

  return {
    token: signToken(userId),
    user: {
      id: user.id,
      username: user.username || '',
      email: user.email,
      name: user.name
    },
    team,
    role: m.role,
    mustChangePassword: !!user.must_change_pw,
    settings: getSettings(team.id)
  };
}

/* ══════════ 路由 ══════════ */

/* 注册接口已删除：账号一律由管理端发放（见 routes/accounts.ts）。
   公开注册意味着任何人都能建队，对一个只服务本队的系统是纯风险面。 */

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const scope = loginScope(req);
    guardRate(req, scope);
    const body = parse(loginSchema, req.body);

    // 不区分「用户不存在」和「密码错误」，避免被枚举账号
    const row = db
      .prepare('SELECT id, password_hash, status FROM users WHERE username = ?')
      .get(body.username) as { id: string; password_hash: string; status: string } | undefined;

    if (!row || !bcrypt.compareSync(body.password, row.password_hash)) {
      markFail(req, scope);
      throw new HttpError(401, '用户名或密码不对', 'bad_credentials');
    }
    if (row.status === 'disabled') {
      throw new HttpError(403, '账号已停用，请联系管理员', 'account_disabled');
    }

    markOk(req, scope);
    res.json(payload(row.id));
  })
);

/** 登录限流的 scope 取用户名；请求体还没解析时兜底成 '?' */
function loginScope(req: Request): string {
  const b = req.body as { username?: string } | undefined;
  const u = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
  return u || '?';
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

/** 修改密码：验旧密码再写新的。首登强制改密也走这里，改完清 must_change_pw */
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
    if (b.oldPassword === b.newPassword) {
      throw new HttpError(400, '新密码不能和当前密码一样', 'same_password');
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(
      bcrypt.hashSync(b.newPassword, 10),
      r.user.id
    );
    res.json({ ok: true });
  })
);

export default router;
