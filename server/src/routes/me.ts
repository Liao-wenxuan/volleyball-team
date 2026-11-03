/**
 * 队员端「我的」页（/m/）的数据源。
 *
 * player 账号发号时绑定了一条 players 记录（players.user_id），
 * 这里按这个绑定取数据：只看自己，别人的数据一个字不出接口。
 * 教练/管理员账号没绑球员记录时返回 player: null（页面给出提示）。
 */
import { Router } from 'express';
import { db, dateKey } from '../db';
import { requireAuth, type AuthedRequest } from '../auth';
import { listAllSessions, listLogs, toPlayer, type PlayerRow } from '../repo';

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

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default router;
