import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse, HttpError } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { SKILL_KEYS } from '../db';
import { listLogs, listPlayers, setSkill } from '../repo';

const router = Router();
router.use(requireAuth);

router.get('/logs', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json({ logs: listLogs(r.teamId, limit) });
});

const batchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(['training', 'match', 'manual']).default('manual'),
  changes: z
    .array(
      z.object({
        playerId: z.string().min(1),
        skill: z.enum(SKILL_KEYS as unknown as [string, ...string[]]),
        after: z.number().min(0).max(10)
      })
    )
    .min(1, '至少一项调整')
    .max(200)
});

/**
 * 批量改技能（训练后一次性给全队加减）。
 *
 * 放在一个事务里：要么全成功，要么全不动 —— 前端是「确认后一次提交」，
 * 半成功会让用户不知道哪些改了、哪些没改。
 */
router.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(batchSchema, req.body);

    const changed: string[] = [];
    const tx = db.transaction(() => {
      for (const c of b.changes) {
        const out = setSkill(r.teamId, c.playerId, c.skill, c.after, b.source, b.date);
        if (!out) throw new HttpError(400, `队员 ${c.playerId} 或技能 ${c.skill} 不存在`, 'bad_request');
        changed.push(out.log.id);
      }
    });
    tx();

    res.json({ updated: changed.length, players: listPlayers(r.teamId), logs: listLogs(r.teamId, 50) });
  })
);

/** 单人单项调整 */
const oneSchema = z.object({
  skill: z.enum(SKILL_KEYS as unknown as [string, ...string[]]),
  after: z.number().min(0).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(['training', 'match', 'manual']).default('manual')
});

router.post(
  '/players/:id',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(oneSchema, req.body);
    const out = setSkill(r.teamId, req.params.id, b.skill, b.after, b.source, b.date);
    if (!out) throw new HttpError(404, '队员不存在', 'not_found');
    res.json({ player: out.player, log: out.log });
  })
);

export default router;
