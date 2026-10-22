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
import { db } from './db';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TTL = '7d';

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET 未设置，正在用开发默认值；上线前务必配置');
}

export interface AuthedRequest extends Request {
  user: { id: string; email: string; name: string };
  teamId: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: TTL });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new HttpError(401, '未登录', 'unauthorized'));

  let payload: { uid?: string };
  try {
    payload = jwt.verify(token, SECRET) as { uid?: string };
  } catch {
    return next(new HttpError(401, '登录已过期，请重新登录', 'token_expired'));
  }
  if (!payload.uid) return next(new HttpError(401, '登录信息无效', 'unauthorized'));

  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(payload.uid) as
    | { id: string; email: string; name: string }
    | undefined;
  if (!user) return next(new HttpError(401, '账号不存在', 'unauthorized'));

  // 决定这次请求作用于哪个队：请求头优先，否则取加入的第一个队
  const wanted = String(req.headers['x-team-id'] || '');
  const member = wanted
    ? (db
        .prepare('SELECT team_id FROM team_members WHERE user_id = ? AND team_id = ?')
        .get(user.id, wanted) as { team_id: string } | undefined)
    : (db
        .prepare('SELECT team_id FROM team_members WHERE user_id = ? ORDER BY joined_at LIMIT 1')
        .get(user.id) as { team_id: string } | undefined);

  if (!member) return next(new HttpError(403, '没有可访问的球队', 'no_team'));

  const r = req as AuthedRequest;
  r.user = user;
  r.teamId = member.team_id;
  next();
}
