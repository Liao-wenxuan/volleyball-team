import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse } from '../http';
import { requireAuth, requireRole, type AuthedRequest } from '../auth';
import { getSettings, AI_KEY_MASK } from '../repo';

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
    'court', 'aurora', 'ocean', 'forest', 'sunset', 'sakura', 'graphite',
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
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(templateSchema, req.body);
    db.prepare(
      `INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, 'court', ?)
       ON CONFLICT(team_id) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at`
    ).run(r.teamId, JSON.stringify(b.template), now());
    res.json({ settings: getSettings(r.teamId) });
  })
);

/** 更新 AI 助手配置（r30 上云：换设备免重填 Key） */
const aiSchema = z.object({
  ai: z.object({
    base: z.string().trim().max(120).default('https://api.deepseek.com'),
    model: z.string().trim().min(1).max(60).default('deepseek-chat'),
    key: z.string().trim().max(200).default('')
  })
});

router.put(
  '/ai',
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(aiSchema, req.body);
    // 前端交回掩码 = 用户没改 Key（表单里那个 ••• 占位），保留库里的原值
    let key = b.ai.key;
    if (key === AI_KEY_MASK) {
      const cur = db.prepare('SELECT ai FROM team_settings WHERE team_id = ?').get(r.teamId) as
        | { ai: string }
        | undefined;
      try {
        key = String((JSON.parse(cur?.ai || 'null') as { key?: string } | null)?.key || '');
      } catch {
        key = '';
      }
    }
    const aiJson = JSON.stringify({ base: b.ai.base, model: b.ai.model, key });
    db.prepare(
      `INSERT INTO team_settings (team_id, template, theme, ai, updated_at) VALUES (?, '[]', 'court', ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET ai = excluded.ai, updated_at = excluded.updated_at`
    ).run(r.teamId, aiJson, now());
    res.json({ settings: getSettings(r.teamId) });
  })
);

/** 更新主题 */
router.put(
  '/theme',
  requireRole('admin', 'coach'),
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
