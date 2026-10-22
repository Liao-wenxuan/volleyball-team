import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { getSettings } from '../repo';

const router = Router();
router.use(requireAuth);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const templateSchema = z.object({
  template: z
    .array(
      z.object({
        id: z.string().min(1).max(30),
        day: z.number().int().min(0).max(6),
        label: z.string().trim().min(1).max(10),
        start: z.string().regex(HHMM, '开始时间格式应为 HH:mm'),
        end: z.string().regex(HHMM, '结束时间格式应为 HH:mm'),
        venue: z.string().trim().max(60).default('')
      })
    )
    .max(14)
});

const themeSchema = z.object({
  theme: z.enum([
    'aurora', 'ocean', 'forest', 'sunset', 'sakura', 'graphite',
    'paper', 'sand', 'mint'
  ])
});

router.get('/', (req, res) => {
  const r = req as unknown as AuthedRequest;
  res.json({ settings: getSettings(r.teamId) });
});

/** 更新训练模板（全量替换） */
router.put(
  '/template',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(templateSchema, req.body);
    db.prepare(
      `INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, 'aurora', ?)
       ON CONFLICT(team_id) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at`
    ).run(r.teamId, JSON.stringify(b.template), now());
    res.json({ settings: getSettings(r.teamId) });
  })
);

/** 更新主题 */
router.put(
  '/theme',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(themeSchema, req.body);
    db.prepare(
      `INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, '[]', ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`
    ).run(r.teamId, b.theme, now());
    res.json({ settings: getSettings(r.teamId) });
  })
);

export default router;
