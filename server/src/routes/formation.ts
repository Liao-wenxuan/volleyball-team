import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { getFormation } from '../repo';

const router = Router();
router.use(requireAuth);

const ROLES = ['oh1', 'oh2', 'mb', 'opp', 's', 'lib'] as const;

const posSchema = z.object({
  preset: z.string().max(20).default('custom'),
  pos: z.record(
    z.enum(ROLES),
    z.object({ x: z.number().min(0).max(9), y: z.number().min(0).max(9) })
  )
});

router.get('/', (req, res) => {
  const r = req as unknown as AuthedRequest;
  res.json({ formation: getFormation(r.teamId) });
});

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(posSchema, req.body);
    // 六个位置必须齐全，少一个前端画不出来
    for (const role of ROLES) {
      if (!b.pos[role]) {
        throw new HttpError(400, `缺少角色位 ${role}`, 'bad_request');
      }
    }
    db.prepare(
      `INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET preset = excluded.preset, pos = excluded.pos, updated_at = excluded.updated_at`
    ).run(r.teamId, b.preset, JSON.stringify(b.pos), now());
    res.json({ formation: getFormation(r.teamId) });
  })
);

import { HttpError } from '../http';

export default router;
