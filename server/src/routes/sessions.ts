import { Router } from 'express';
import { z } from 'zod';
import { db, newId, now, dateKey, mondayOf, parseKey } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { STATES, ensureWeek, getSession } from '../repo';

const router = Router();
router.use(requireAuth);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 拿一周的训练；这一周还没建过就按模板生成 */
router.get('/weeks/:key', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const key = String(req.params.key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new HttpError(400, '日期格式应为 YYYY-MM-DD', 'bad_request');
  const monday = dateKey(mondayOf(parseKey(key)));
  res.json({ weekKey: monday, sessions: ensureWeek(r.teamId, monday) });
});

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  start: z.string().regex(HHMM, '开始时间格式应为 HH:mm'),
  end: z.string().regex(HHMM, '结束时间格式应为 HH:mm'),
  venue: z.string().trim().max(60).default('')
});

/** 加练：模板以外的临时训练 */
router.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(createSchema, req.body);
    const id = newId('s');
    // template_id 留空：加练不占模板位，同一天可以有多条
    db.prepare(
      `INSERT INTO sessions (id, team_id, date, start, end_time, venue, template_id, status, cancel_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'scheduled', '', ?)`
    ).run(id, r.teamId, b.date, b.start, b.end, b.venue, now());
    res.status(201).json({ session: getSession(r.teamId, id) });
  })
);

const patchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional(),
  start: z.string().regex(HHMM).optional(),
  end: z.string().regex(HHMM).optional(),
  venue: z.string().trim().max(60).optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  cancelReason: z.string().trim().max(30).optional()
});

/** 改某一次训练：时间、地点、取消（只影响这一周，不动模板） */
router.patch(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(patchSchema, req.body);
    const cur = getSession(r.teamId, req.params.id);
    if (!cur) throw new HttpError(404, '训练不存在', 'not_found');

    db.prepare(
      'UPDATE sessions SET date=?, start=?, end_time=?, venue=?, status=?, cancel_reason=? WHERE team_id=? AND id=?'
    ).run(
      b.date ?? cur.date,
      b.start ?? cur.start,
      b.end ?? cur.end,
      b.venue ?? cur.venue,
      b.status ?? cur.status,
      b.cancelReason ?? cur.cancelReason,
      r.teamId,
      req.params.id
    );
    res.json({ session: getSession(r.teamId, req.params.id) });
  })
);

router.delete('/sessions/:id', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const info = db.prepare('DELETE FROM sessions WHERE team_id = ? AND id = ?').run(r.teamId, req.params.id);
  if (info.changes === 0) throw new HttpError(404, '训练不存在', 'not_found');
  res.json({ ok: true });
});

const attSchema = z.object({ state: z.enum([...STATES] as [string, ...string[]]) });

/**
 * 登记一个人的出勤。
 *
 * 用 UPSERT 而不是「先查再插」：两次请求同时到达时不会撞主键，
 * 状态直接以最后一次为准（考勤这种场景不需要冲突合并）。
 */
router.put(
  '/sessions/:id/attendance/:playerId',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(attSchema, req.body);
    const session = getSession(r.teamId, req.params.id);
    if (!session) throw new HttpError(404, '训练不存在', 'not_found');

    const player = db
      .prepare('SELECT id FROM players WHERE team_id = ? AND id = ?')
      .get(r.teamId, req.params.playerId);
    if (!player) throw new HttpError(404, '队员不存在', 'not_found');

    db.prepare(
      `INSERT INTO attendance (session_id, player_id, state, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, player_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
    ).run(req.params.id, req.params.playerId, b.state, now());

    res.json({ session: getSession(r.teamId, req.params.id) });
  })
);

/** 清除一个人的考勤（考勤格循环回「未登记」时调用） */
router.delete('/sessions/:id/attendance/:playerId', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const session = getSession(r.teamId, req.params.id);
  if (!session) throw new HttpError(404, '训练不存在', 'not_found');
  db.prepare('DELETE FROM attendance WHERE session_id = ? AND player_id = ?').run(
    req.params.id,
    req.params.playerId
  );
  res.json({ session: getSession(r.teamId, req.params.id) });
});

export default router;
