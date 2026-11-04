/**
 * 多端准实时同步的检查口。
 *
 * 设计取舍（为什么不推 WebSocket / SSE）：
 * 单队规模的数据变更频率极低（一天几十次写），15 秒一轮询的成本可以忽略，
 * 但实现和维护成本几乎为零。接口只返回一个「本队数据最后一次被改动的时刻」，
 * 客户端拿它跟自己上次看到的比，变了才去拉全量——不传数据本体，包极小。
 */
import { Router } from 'express';
import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

// 这几张表覆盖了所有会同步的数据：名单/技能、场次、考勤、站位、阵型库、训练模板和主题。
// skill_logs 用 at（创建即不改），formations 表没有 name 之前的老库也能查（updated_at 一直在）。
const TOUCH_SQL = `
  SELECT MAX(t) AS t FROM (
    SELECT MAX(updated_at) AS t FROM players WHERE team_id = @team
    UNION ALL SELECT MAX(at) AS t FROM skill_logs WHERE team_id = @team
    UNION ALL SELECT MAX(s.created_at) AS t FROM sessions s WHERE s.team_id = @team
    UNION ALL SELECT MAX(a.updated_at) AS t FROM attendance a
      JOIN sessions s ON s.id = a.session_id WHERE s.team_id = @team
    UNION ALL SELECT MAX(updated_at) AS t FROM formations WHERE team_id = @team
    UNION ALL SELECT MAX(at) AS t FROM formation_saves WHERE team_id = @team
    UNION ALL SELECT MAX(updated_at) AS t FROM team_settings WHERE team_id = @team
  )`;

router.get('/check', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const row = db.prepare(TOUCH_SQL).get({ team: r.teamId }) as { t: number | null };
  res.json({ t: row.t || 0, server: Date.now() });
});

export default router;
