/**
 * 管理端 API：多球队运营（只有系统管理员能用）。
 *
 * 鉴权模型和业务路由完全不同：
 *   业务路由（/api/players 等）= requireAuth，按 X-Team-Id 解析「人属于哪个队」，
 *   一旦那个队被停用，整个请求面都被 403 —— 这是停用语义的执行点。
 *   管理端 = verifyUser（只验人不验队）+ requireSysAdmin（存在 role='admin' 的 membership）。
 *   原因：系统管理员唯一加入的队如果被自己停用，他必须还能进管理端把它恢复，
 *   否则「停用球队」就等于「把钥匙锁进保险柜」。
 *
 * 权限边界：
 *   - coach / player 账号可以管（重置/停用/改名），admin 账号一律 403 —— 防自锁、防提权；
 *   - 队员账号由各队教练自己开，这里不管到队员层；
 *   - 只停用球队，不提供删除。
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Request } from 'express';
import { db, newId, now, mondayOf, addDays, dateKey } from '../db';
import { DEFAULT_TEMPLATE, DEFAULT_FORMATION } from '../defaults';
import { HttpError, asyncHandler, parse } from '../http';
import { verifyUser, type AuthedUser } from '../auth';
import { genPassword } from '../passwords';

const router = Router();

/* ══════════ 鉴权 ══════════ */

interface AdminRequest extends Request {
  user: AuthedUser;
}

function requireSysAdmin(req: Request, _res: unknown, next: (e?: unknown) => void) {
  try {
    const user = verifyUser(req);
    const ok = db
      .prepare("SELECT 1 FROM team_members WHERE user_id = ? AND role = 'admin' LIMIT 1")
      .get(user.id);
    if (!ok) throw new HttpError(403, '只有系统管理员能访问管理端', 'forbidden');
    (req as AdminRequest).user = user;
    next();
  } catch (e) {
    next(e);
  }
}

router.use(requireSysAdmin);

/* ══════════ 校验 ══════════ */

const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, '用户名至少 2 位')
  .max(32, '用户名最多 32 位')
  .regex(/^[a-z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点或横线');

const createTeamSchema = z.object({
  teamName: z.string().trim().min(1, '请填队名').max(30, '队名最多 30 字'),
  coachName: z.string().trim().min(1, '请填教练姓名').max(20, '姓名最多 20 字'),
  coachUsername: usernameRule
});

const teamStatusSchema = z.object({
  status: z.enum(['active', 'disabled'])
});

const accountPatchSchema = z.object({
  name: z.string().trim().min(1, '请填姓名').max(20, '姓名最多 20 字').optional(),
  status: z.enum(['active', 'disabled']).optional()
});

/* ══════════ 工具 ══════════ */

/** 出勤率口径：取消的训练整体排除；present/late 算出勤（与教练端一致） */
interface SessionAgg {
  date: string;
  ok: number;
  total: number;
}

function attendanceBySession(teamId: string): SessionAgg[] {
  return db
    .prepare(
      `SELECT s.date AS date,
              SUM(CASE WHEN a.state IN ('present','late') THEN 1 ELSE 0 END) AS ok,
              COUNT(*) AS total
         FROM sessions s JOIN attendance a ON a.session_id = s.id
        WHERE s.team_id = ? AND s.status = 'scheduled'
        GROUP BY s.id`
    )
    .all(teamId) as SessionAgg[];
}

function rateOf(rows: SessionAgg[]): number | null {
  const ok = rows.reduce((s, r) => s + r.ok, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return total ? Math.round((ok / total) * 1000) / 10 : null;
}

/** 近 4 周趋势：以周一为界，每周 {week, rate}，无出勤记录的周 rate=null（前端画空点） */
function trendOf(rows: SessionAgg[]): Array<{ week: string; rate: number | null }> {
  const weeks: Array<{ week: string; rate: number | null }> = [];
  const thisMonday = mondayOf(new Date());
  for (let i = 3; i >= 0; i--) {
    const start = addDays(thisMonday, -7 * i);
    const end = addDays(start, 6);
    const inWeek = rows.filter((r) => r.date >= dateKey(start) && r.date <= dateKey(end));
    weeks.push({ week: dateKey(start), rate: inWeek.length ? rateOf(inWeek) : null });
  }
  return weeks;
}

/** 目标账号必须存在且不是 admin 角色（admin 账号只能在服务器 CLI 上处理） */
function getManageableAccount(id: string): { id: string; name: string; username: string | null; status: string } {
  const u = db.prepare('SELECT id, name, username, status FROM users WHERE id = ?').get(id) as
    | { id: string; name: string; username: string | null; status: string }
    | undefined;
  if (!u) throw new HttpError(404, '账号不存在', 'not_found');
  const isAdmin = db
    .prepare("SELECT 1 FROM team_members WHERE user_id = ? AND role = 'admin' LIMIT 1")
    .get(id);
  if (isAdmin) throw new HttpError(403, '管理员账号不能在管理端修改', 'admin_locked');
  return u;
}

/* ══════════ 当前管理员（管理端自己的 /me，不走 requireAuth 的球队解析） ══════════ */

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: (req as AdminRequest).user });
  })
);

/* ══════════ 球队概览 ══════════ */

router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const teams = db
      .prepare(
        `SELECT t.id, t.name, t.status, t.created_at AS createdAt,
                (SELECT COUNT(*) FROM players p WHERE p.team_id = t.id) AS playerCount,
                (SELECT COUNT(*) FROM sessions s
                  WHERE s.team_id = t.id AND s.status = 'scheduled'
                    AND s.date >= ? AND s.date <= ?) AS weekSessions,
                (SELECT MAX(x.at) FROM (
                    SELECT s.created_at AS at FROM sessions s WHERE s.team_id = t.id
                    UNION ALL
                    SELECT a.updated_at AS at FROM attendance a
                      JOIN sessions s2 ON s2.id = a.session_id WHERE s2.team_id = t.id
                    UNION ALL
                    SELECT l.at AS at FROM skill_logs l WHERE l.team_id = t.id
                 ) x) AS lastActive
           FROM teams t ORDER BY t.created_at`
      )
      .all(dateKey(mondayOf(new Date())), dateKey(addDays(mondayOf(new Date()), 6))) as Array<{
      id: string;
      name: string;
      status: string;
      createdAt: number;
      playerCount: number;
      weekSessions: number;
      lastActive: number | null;
    }>;

    // 出勤率和趋势按队补查（队伍数量级是个位数，N 次小查询比一条巨型 SQL 可读得多）
    const result = teams.map((t) => {
      const rows = attendanceBySession(t.id);
      return { ...t, attendanceRate: rateOf(rows), trend: trendOf(rows) };
    });

    res.json({ teams: result });
  })
);

/* ══════════ 一键建队 ══════════ */

router.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const body = parse(createTeamSchema, req.body);

    if (db.prepare('SELECT id FROM teams WHERE name = ?').get(body.teamName)) {
      throw new HttpError(409, '已经有同名的球队了', 'team_taken');
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(body.coachUsername)) {
      throw new HttpError(409, '这个用户名已经被占用了', 'username_taken');
    }

    const teamId = newId('t');
    const userId = newId('u');
    const initialPassword = genPassword();
    const ts = now();

    // 建队即建 coach 账号；模板/站位用系统默认（教练登录后可自己改）
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, body.teamName, ts);
      db.prepare('INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, ?, ?)').run(
        teamId,
        JSON.stringify(DEFAULT_TEMPLATE),
        'court',
        ts
      );
      db.prepare('INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)').run(
        teamId,
        DEFAULT_FORMATION.preset,
        JSON.stringify(DEFAULT_FORMATION.pos),
        ts
      );
      // email 列还留着 NOT NULL，用 username@local 占位（同 accounts.ts）
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`
      ).run(
        userId,
        body.coachUsername,
        `${body.coachUsername}@local`,
        bcrypt.hashSync(initialPassword, 10),
        body.coachName,
        (req as AdminRequest).user.id,
        ts
      );
      db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        userId,
        teamId,
        'coach',
        ts
      );
    });
    tx();

    res.status(201).json({
      team: { id: teamId, name: body.teamName, status: 'active' },
      account: { id: userId, username: body.coachUsername, name: body.coachName, role: 'coach' },
      // 只在这个响应里出现一次，之后服务器不存明文
      initialPassword
    });
  })
);

/* ══════════ 停用 / 恢复球队 ══════════ */

router.patch(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const body = parse(teamStatusSchema, req.body);
    const team = db.prepare('SELECT id, name, status FROM teams WHERE id = ?').get(req.params.id) as
      | { id: string; name: string; status: string }
      | undefined;
    if (!team) throw new HttpError(404, '球队不存在', 'not_found');
    if (team.status === body.status) {
      res.json({ ok: true, unchanged: true });
      return;
    }

    db.prepare('UPDATE teams SET status = ? WHERE id = ?').run(body.status, team.id);
    res.json({ ok: true });
  })
);

/* ══════════ 某队账号列表 ══════════ */

router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const teamId = String(req.query.teamId || '');
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) throw new HttpError(404, '球队不存在', 'not_found');

    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.name, u.status, u.must_change_pw AS mustChangePassword,
                u.created_at AS createdAt, m.role,
                p.id AS playerId, p.name AS playerName
           FROM users u
           JOIN team_members m ON m.user_id = u.id AND m.team_id = ?
      LEFT JOIN players p ON p.user_id = u.id
          ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END, u.created_at`
      )
      .all(teamId);
    res.json({ accounts: rows });
  })
);

/* ══════════ 重置教练密码 ══════════ */

router.post(
  '/accounts/:id/reset-password',
  asyncHandler(async (req, res) => {
    const target = getManageableAccount(req.params.id);
    const initialPassword = genPassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(
      bcrypt.hashSync(initialPassword, 10),
      target.id
    );
    res.json({ initialPassword });
  })
);

/* ══════════ 教练改名 / 停用 / 启用 ══════════ */

router.patch(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const body = parse(accountPatchSchema, req.body);
    const target = getManageableAccount(req.params.id);

    const tx = db.transaction(() => {
      if (body.name !== undefined) {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, target.id);
      }
      if (body.status !== undefined) {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, target.id);
      }
    });
    tx();
    res.json({ ok: true });
  })
);

export default router;
