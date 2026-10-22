import { Router } from 'express';
import { z } from 'zod';
import { db, newId, now } from '../db';
import { HttpError, asyncHandler, parse } from '../http';
import { requireAuth, type AuthedRequest } from '../auth';
import { GRADES, POSITIONS, getPlayer, listPlayers } from '../repo';

const router = Router();
router.use(requireAuth);

const skillField = z.number().min(0).max(10);

const createSchema = z.object({
  name: z.string().trim().min(1, '请填姓名').max(20),
  number: z.number().int().min(0).max(99).default(0),
  position: z.enum(POSITIONS as [string, ...string[]]).default('主攻'),
  grade: z.enum(GRADES as [string, ...string[]]).default('大一'),
  height: z.number().int().min(0).max(250).default(0),
  skills: z
    .object({
      serve: skillField,
      receive: skillField,
      set: skillField,
      spike: skillField,
      block: skillField,
      defense: skillField
    })
    .partial()
    .optional()
});

const patchSchema = createSchema.partial().extend({
  skills: createSchema.shape.skills
});

router.get('/', (req, res) => {
  const r = req as unknown as AuthedRequest;
  res.json({ players: listPlayers(r.teamId) });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(createSchema, req.body);
    const id = newId('p');
    const ts = now();
    const s = b.skills || {};
    db.prepare(
      `INSERT INTO players (id, team_id, name, number, position, grade, height, serve, receive, "set_", spike, block, defense, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      r.teamId,
      b.name,
      b.number,
      b.position,
      b.grade,
      b.height,
      s.serve ?? 5,
      s.receive ?? 5,
      s.set ?? 5,
      s.spike ?? 5,
      s.block ?? 5,
      s.defense ?? 5,
      ts,
      ts
    );
    res.status(201).json({ player: getPlayer(r.teamId, id) });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(patchSchema, req.body);
    const cur = getPlayer(r.teamId, req.params.id);
    if (!cur) throw new HttpError(404, '队员不存在', 'not_found');

    const next = {
      name: b.name ?? cur.name,
      number: b.number ?? cur.number,
      position: b.position ?? cur.position,
      grade: b.grade ?? cur.grade,
      height: b.height ?? cur.height,
      serve: b.skills?.serve ?? cur.skills.serve,
      receive: b.skills?.receive ?? cur.skills.receive,
      set: b.skills?.set ?? cur.skills.set,
      spike: b.skills?.spike ?? cur.skills.spike,
      block: b.skills?.block ?? cur.skills.block,
      defense: b.skills?.defense ?? cur.skills.defense
    };

    db.prepare(
      `UPDATE players SET name=?, number=?, position=?, grade=?, height=?,
        serve=?, receive=?, "set_"=?, spike=?, block=?, defense=?, updated_at=?
       WHERE team_id=? AND id=?`
    ).run(
      next.name,
      next.number,
      next.position,
      next.grade,
      next.height,
      next.serve,
      next.receive,
      next.set,
      next.spike,
      next.block,
      next.defense,
      now(),
      r.teamId,
      req.params.id
    );

    res.json({ player: getPlayer(r.teamId, req.params.id) });
  })
);

router.delete('/:id', (req, res) => {
  const r = req as unknown as AuthedRequest;
  const info = db.prepare('DELETE FROM players WHERE team_id = ? AND id = ?').run(r.teamId, req.params.id);
  if (info.changes === 0) throw new HttpError(404, '队员不存在', 'not_found');
  res.json({ ok: true });
});

export default router;
