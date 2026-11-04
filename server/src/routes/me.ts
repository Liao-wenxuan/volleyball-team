/**
 * 队员端「我的」页（/m/）的数据源。
 *
 * player 账号发号时绑定了一条 players 记录（players.user_id），
 * 这里按这个绑定取数据：只看自己，别人的数据一个字不出接口。
 * 教练/管理员账号没绑球员记录时返回 player: null（页面给出提示）。
 */
import { Router } from 'express';
import { db, dateKey, now } from '../db';
import { HttpError } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { listAllSessions, listLogs, toPlayer, getSession, type PlayerRow } from '../repo';

const router = Router();
router.use(requireAuth);

const SKILL_LABEL: Record<string, string> = {
  serve: '发球',
  receive: '一传',
  set: '二传',
  spike: '扣球',
  block: '拦网',
  defense: '防守'
};

router.get('/summary', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(r.teamId) as
    | { name: string }
    | undefined;

  const row = db
    .prepare('SELECT * FROM players WHERE team_id = ? AND user_id = ?')
    .get(r.teamId, r.user.id) as PlayerRow | undefined;
  if (!row) {
    res.json({ team: team ? team.name : '', player: null });
    return;
  }
  const player = toPlayer(row);

  const sessions = listAllSessions(r.teamId);
  const today = dateKey(new Date());
  const past = sessions
    .filter((s) => s.date < today)
    .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
  // 出勤率口径与教练端一致：只算没取消的训练
  const counted = past.filter((s) => s.status === 'scheduled');

  let present = 0;
  let late = 0;
  let leave = 0;
  let absent = 0;
  for (const s of counted) {
    const st = s.attendance[player.id];
    if (st === 'present') present++;
    else if (st === 'late') late++;
    else if (st === 'leave') leave++;
    else if (st === 'absent') absent++;
  }
  const marked = present + late + leave + absent;
  const rate = marked ? Math.round(((present + late) / marked) * 100) : null;

  // 下一次训练：今天及以后、未取消的最早一场（今天已过的场次按时间算）
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && (s.date > today || (s.date === today && s.end >= nowHHMM())))
    .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)))[0] || null;

  // 近 5 次记录（倒序）：取消的场次也列出，标「因雨取消」之类
  const recent = past
    .slice(-5)
    .reverse()
    .map((s) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      venue: s.venue,
      status: s.status,
      cancelReason: s.cancelReason,
      state: s.attendance[player.id] || null
    }));

  // 技能调整记录：最近 10 条自己的
  const logs = listLogs(r.teamId, 100)
    .filter((l) => l.playerId === player.id)
    .slice(0, 10)
    .map((l) => ({ ...l, skillLabel: SKILL_LABEL[l.skill] || l.skill }));

  const next = upcoming
    ? {
        id: upcoming.id,
        date: upcoming.date,
        start: upcoming.start,
        end: upcoming.end,
        venue: upcoming.venue,
        state: upcoming.attendance[player.id] || null
      }
    : null;

  res.json({
    team: team ? team.name : '',
    player,
    stats: { total: counted.length, present, late, leave, absent, marked, rate },
    next,
    recent,
    logs
  });
});

/**
 * 队员请假 / 取消请假。队员唯一的写权限口子，规则收紧：
 * - 只能动「下一场还没开始的训练」（date > 今天，或今天但还没到开始时间）
 * - 请假 = 把自己的考勤标成 leave；取消 = 删掉自己那条考勤，
 *   且只有当前还是 leave（队员自己标的）时才允许删——教练已经改成别的状态就不能动
 */
router.post('/leave', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const row = db
    .prepare('SELECT id FROM players WHERE team_id = ? AND user_id = ?')
    .get(r.teamId, r.user.id) as { id: string } | undefined;
  if (!row) throw new HttpError(400, '账号没有绑定球员档案', 'no_player');

  const session = getSession(r.teamId, String(req.body?.sessionId || ''));
  if (!session) throw new HttpError(404, '训练不存在', 'not_found');
  if (session.status !== 'scheduled') throw new HttpError(400, '这场训练已取消，不用请假', 'cancelled');
  const today = dateKey(new Date());
  const started = session.date < today || (session.date === today && session.start <= nowHHMM());
  if (started) throw new HttpError(400, '训练已经开始或结束，不能请假了', 'too_late');

  const cur = session.attendance[row.id] || null;
  if (req.body?.cancel === true) {
    if (cur !== 'leave') throw new HttpError(400, '只能取消你自己请的假', 'not_mine');
    db.prepare('DELETE FROM attendance WHERE session_id = ? AND player_id = ?').run(session.id, row.id);
  } else {
    if (cur === 'present' || cur === 'late') {
      throw new HttpError(400, '教练已把你登记为出勤，要请假直接联系教练', 'already_marked');
    }
    db.prepare(
      `INSERT INTO attendance (session_id, player_id, state, updated_at) VALUES (?, ?, 'leave', ?)
       ON CONFLICT(session_id, player_id) DO UPDATE SET state = 'leave', updated_at = excluded.updated_at`
    ).run(session.id, row.id, now());
  }

  res.json({ ok: true, state: req.body?.cancel === true ? null : 'leave' });
});

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default router;
