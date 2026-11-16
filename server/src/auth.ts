/**
 * 鉴权：JWT（HS256）放在 Authorization: Bearer 里。
 *
 * 为什么不用 cookie：前端是纯静态页（可能部署在 GitHub Pages 或直接双击打开），
 * 跨域 cookie 要开 SameSite=None + Secure，本地 file:// 还会直接失效。Bearer 最省事。
 *
 * token 里只放 uid，不放 tid —— 一个人可能属于多个队，
 * 队由请求头 X-Team-Id 指定（或回落到默认队）。这样以后加「切换球队」不用重新登录。
 */
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './http';
import { db, type Role } from './db';

/**
 * 开发默认密钥。用它签发的 token 任何人都能伪造，所以**只允许出现在测试里**。
 * 生产环境一旦用了它，等于把全站账号交出去 —— assertSecretConfigured() 会拦下。
 */
export const DEV_DEFAULT_SECRET = 'dev-only-secret-change-me';

const SECRET = process.env.JWT_SECRET || DEV_DEFAULT_SECRET;
const TTL = '7d';

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET 未设置，正在用开发默认值；上线前务必配置');
}

/**
 * 生产环境强制校验 JWT_SECRET，缺失或用了开发默认值就**拒绝启动**。
 *
 * 为什么之前只是 warn：服务能起来、接口全通，看起来没问题。但默认密钥是公开的
 * （写在本仓库里），任何人都能拿它签一个 uid=admin 的 token 直接冒充管理员。
 * 这种「配漏了但系统照常工作」的失败模式，比启动失败危险得多 ——
 * 失败要发生在部署那一刻，而不是被用户发现的那一天。
 *
 * 什么时候必须配置：
 *   - NODE_ENV=production（生产部署的标准姿势）
 *   - 或显式 JWT_REQUIRE_SECRET=1（自建部署不设 NODE_ENV 时用）
 * 测试环境（NODE_ENV=test）不受影响：tests/setup.ts 已固定注入测试密钥。
 *
 * 只在**启动入口**调用（index.ts）。库（auth.ts / repo.ts）被 import 时不抛，
 * 否则 seed、cli/account、backup 这些不签发 token 的工具也会被牵连。
 */
export function assertSecretConfigured(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const required = isProd || process.env.JWT_REQUIRE_SECRET === '1';
  if (!required) return;

  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    throw new Error(
      '[auth] 生产环境必须配置 JWT_SECRET，缺少它已拒绝启动。' +
        '生成方式：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  if (secret === DEV_DEFAULT_SECRET) {
    throw new Error(
      '[auth] JWT_SECRET 仍是开发默认值，这会让任何人都能伪造管理员 token，已拒绝启动。' +
        '请设置一个足够长的随机值。'
    );
  }
  // 太短的密钥挡不住暴力碰撞；16 字节熵起步。
  if (secret.length < 16) {
    throw new Error(`[auth] JWT_SECRET 太短（${secret.length} 位，至少 16 位），已拒绝启动。`);
  }
}

export interface AuthedUser {
  id: string;
  username: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
}

export interface AuthedRequest extends Request {
  user: AuthedUser;
  teamId: string;
  /** 这次请求针对的球队里的身份：admin 管理 / coach 教练 / player 队员（只读） */
  role: Role;
}

export function signToken(userId: string): string {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: TTL });
}

/**
 * 只验「人」：JWT → users 行 → 账号状态。不解析球队。
 *
 * 为什么从 requireAuth 里拆出来：管理端接口是跨队的，不能走「按 X-Team-Id
 * 解析 membership」的逻辑；更关键的是——如果用户唯一加入的队被停用，
 * requireAuth 会在球队状态检查上把他拦死，他自己反而进不了管理端去恢复。
 * 管理端路由（routes/admin.ts）必须只依赖这一层。
 */
export function verifyUser(req: Request): AuthedUser {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, '未登录', 'unauthorized');

  let payload: { uid?: string };
  try {
    payload = jwt.verify(token, SECRET) as { uid?: string };
  } catch {
    throw new HttpError(401, '登录已过期，请重新登录', 'token_expired');
  }
  if (!payload.uid) throw new HttpError(401, '登录信息无效', 'unauthorized');

  const user = db
    .prepare('SELECT id, username, email, name, status, must_change_pw FROM users WHERE id = ?')
    .get(payload.uid) as
    | { id: string; username: string | null; email: string; name: string; status: string; must_change_pw: number }
    | undefined;
  if (!user) throw new HttpError(401, '账号不存在', 'unauthorized');
  if (user.status === 'disabled') {
    throw new HttpError(403, '账号已停用，请联系管理员', 'account_disabled');
  }

  return {
    id: user.id,
    username: user.username || '',
    email: user.email,
    name: user.name,
    mustChangePassword: !!user.must_change_pw
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  let user: AuthedUser;
  try {
    user = verifyUser(req);
  } catch (e) {
    return next(e);
  }

  // 决定这次请求作用于哪个队：请求头优先，否则取加入的第一个队
  const wanted = String(req.headers['x-team-id'] || '');
  const member = wanted
    ? (db
        .prepare('SELECT team_id, role FROM team_members WHERE user_id = ? AND team_id = ?')
        .get(user.id, wanted) as { team_id: string; role: Role } | undefined)
    : (db
        .prepare('SELECT team_id, role FROM team_members WHERE user_id = ? ORDER BY joined_at LIMIT 1')
        .get(user.id) as { team_id: string; role: Role } | undefined);

  if (!member) return next(new HttpError(403, '没有可访问的球队', 'no_team'));

  // 停用的球队全员拦截（管理端 /api/admin/* 不走这里，所以系统管理员仍可恢复球队）
  const team = db.prepare('SELECT status FROM teams WHERE id = ?').get(member.team_id) as
    | { status: string }
    | undefined;
  if (team && team.status === 'disabled') {
    return next(new HttpError(403, '球队已停用，请联系系统管理员', 'team_disabled'));
  }

  const r = req as AuthedRequest;
  r.user = user;
  r.teamId = member.team_id;
  r.role = member.role;
  next();
}

/**
 * 写操作的角色门禁。必须在 requireAuth 之后用（依赖 req.role）。
 * player 只放行读接口，增删改一律 403 —— 前端藏按钮只是体验，权限以这里为准。
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    if (!roles.includes(r.role)) {
      return next(new HttpError(403, '当前身份只有查看权限，如需编辑请联系管理员', 'forbidden'));
    }
    next();
  };
}
