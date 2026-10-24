import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { getFormation, listFormationSaves, replaceFormationSaves } from '../repo';

const router = Router();
router.use(requireAuth);

const ROLES = ['oh1', 'oh2', 'mb', 'opp', 's', 'lib'] as const;

const posMapSchema = z.record(
  z.enum(ROLES),
  z.object({ x: z.number().min(0).max(9), y: z.number().min(0).max(9) })
);

const posSchema = z.object({
  preset: z.string().max(20).default('custom'),
  pos: posMapSchema
});

/** 阵型库整库推送的校验：最多 30 套，名字 ≤12 字，六个角色位必须齐全 */
const librarySchema = z.object({
  formations: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().min(1).max(12),
        pos: posMapSchema,
        at: z.number().int().nonnegative().optional()
      })
    )
    .max(30)
});

function assertFullPos(pos: Record<string, { x: number; y: number }>): void {
  for (const role of ROLES) {
    if (!pos[role]) throw new HttpError(400, `缺少角色位 ${role}`, 'bad_request');
  }
}

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
    assertFullPos(b.pos);
    db.prepare(
      `INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET preset = excluded.preset, pos = excluded.pos, updated_at = excluded.updated_at`
    ).run(r.teamId, b.preset, JSON.stringify(b.pos), now());
    res.json({ formation: getFormation(r.teamId) });
  })
);

/* ── 阵型库（命名保存，整库同步） ── */

router.get('/library', (req, res) => {
  const r = req as unknown as AuthedRequest;
  res.json({ formations: listFormationSaves(r.teamId) });
});

router.put(
  '/library',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(librarySchema, req.body);
    for (const f of b.formations) assertFullPos(f.pos);
    replaceFormationSaves(
      r.teamId,
      b.formations.map((f) => ({ id: f.id, name: f.name, pos: f.pos, at: f.at ?? now() }))
    );
    res.json({ formations: listFormationSaves(r.teamId) });
  })
);

import { HttpError } from '../http';

export default router;
