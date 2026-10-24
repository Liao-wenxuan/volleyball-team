/**
 * 数据访问与映射层。
 *
 * 这里是「数据库行」和「接口 JSON」之间唯一转换的地方，
 * 路由只做参数校验 + 调这里，不碰 SQL。
 */
import { db, dateKey, addDays, mondayOf, parseKey, newId, now, SKILL_KEYS } from './db';

export const POSITIONS = ['主攻', '副攻', '二传', '接应', '自由人'];
export const GRADES = ['大一', '大二', '大三', '大四', '研究生'];
export const STATES = ['present', 'late', 'leave', 'absent'] as const;
export type State = (typeof STATES)[number];

export interface TemplateItem {
  id: string;
  day: number;
  label: string;
  start: string;
  end: string;
  venue: string;
}

export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  number: number;
  position: string;
  grade: string;
  height: number;
  serve: number;
  receive: number;
  set_: number;
  spike: number;
  block: number;
  defense: number;
  created_at: number;
  updated_at: number;
}

export interface Player {
  id: string;
  name: string;
  number: number;
  position: string;
  grade: string;
  height: number;
  skills: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export function toPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    name: r.name,
    number: r.number,
    position: r.position,
    grade: r.grade,
    height: r.height,
    skills: {
      serve: r.serve,
      receive: r.receive,
      set: r.set_,
      spike: r.spike,
      block: r.block,
      defense: r.defense
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listPlayers(teamId: string): Player[] {
  const rows = db
    .prepare('SELECT * FROM players WHERE team_id = ? ORDER BY number, created_at')
    .all(teamId) as PlayerRow[];
  return rows.map(toPlayer);
}

export function getPlayer(teamId: string, id: string): Player | null {
  const row = db.prepare('SELECT * FROM players WHERE team_id = ? AND id = ?').get(teamId, id) as
    | PlayerRow
    | undefined;
  return row ? toPlayer(row) : null;
}

/* ══════════ 设置 ══════════ */

export function getSettings(teamId: string): { template: TemplateItem[]; theme: string } {
  const row = db.prepare('SELECT template, theme FROM team_settings WHERE team_id = ?').get(teamId) as
    | { template: string; theme: string }
    | undefined;
  if (!row) return { template: [], theme: 'aurora' };
  let template: TemplateItem[] = [];
  try {
    template = JSON.parse(row.template) as TemplateItem[];
  } catch {
    template = [];
  }
  return { template, theme: row.theme };
}

/* ══════════ 训练 / 出勤 ══════════ */

export interface Session {
  id: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  templateId: string | null;
  status: 'scheduled' | 'cancelled';
  cancelReason: string;
  attendance: Record<string, State>;
}

interface SessionRow {
  id: string;
  date: string;
  start: string;
  end_time: string;
  venue: string;
  template_id: string | null;
  status: 'scheduled' | 'cancelled';
  cancel_reason: string;
}

function hydrate(rows: SessionRow[]): Session[] {
  if (!rows.length) return [];
  const marks = db
    .prepare(
      `SELECT session_id, player_id, state FROM attendance WHERE session_id IN (${rows
        .map(() => '?')
        .join(',')})`
    )
    .all(...rows.map((r) => r.id)) as { session_id: string; player_id: string; state: State }[];

  const bySession = new Map<string, Record<string, State>>();
  for (const m of marks) {
    const bucket = bySession.get(m.session_id) || {};
    bucket[m.player_id] = m.state;
    bySession.set(m.session_id, bucket);
  }

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    start: r.start,
    end: r.end_time,
    venue: r.venue,
    templateId: r.template_id,
    status: r.status,
    cancelReason: r.cancel_reason,
    attendance: bySession.get(r.id) || {}
  }));
}

export function listSessionsBetween(teamId: string, from: string, to: string): Session[] {
  const rows = db
    .prepare(
      'SELECT * FROM sessions WHERE team_id = ? AND date BETWEEN ? AND ? ORDER BY date, start'
    )
    .all(teamId, from, to) as SessionRow[];
  return hydrate(rows);
}

/**
 * 这一周还没建训练的话，按模板生成一遍。
 *
 * 为什么放在服务端：模板的「周几」要换算成具体日期，如果每个客户端各算一遍，
 * 时区或实现差异会导致同一天生成两个不同 id 的训练。服务端算一次、写一次，天然幂等
 * （靠 sessions(team_id, date, template_id) 的唯一约束兜底）。
 */
export function ensureWeek(teamId: string, mondayKey: string): Session[] {
  const monday = mondayOf(parseKey(mondayKey));
  const from = dateKey(monday);
  const to = dateKey(addDays(monday, 6));

  const existing = listSessionsBetween(teamId, from, to);
  if (existing.length) return existing;

  const { template } = getSettings(teamId);
  if (!template.length) return [];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO sessions (id, team_id, date, start, end_time, venue, template_id, status, cancel_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', '', ?)`
  );
  const ts = now();
  const tx = db.transaction(() => {
    for (const t of template) {
      // 模板的 day 用 0=周日；周一是 1，所以偏移是 (day - 1 + 7) % 7
      const offset = ((Number(t.day) - 1 + 7) % 7 + 7) % 7;
      const date = dateKey(addDays(monday, offset));
      insert.run(newId('s'), teamId, date, t.start, t.end, t.venue || '', t.id, ts);
    }
  });
  tx();

  return listSessionsBetween(teamId, from, to);
}

export function getSession(teamId: string, id: string): Session | null {
  const row = db
    .prepare('SELECT * FROM sessions WHERE team_id = ? AND id = ?')
    .get(teamId, id) as SessionRow | undefined;
  return row ? hydrate([row])[0] : null;
}

/* ══════════ 技能记录 ══════════ */

export interface SkillLog {
  id: string;
  playerId: string;
  skill: string;
  before: number;
  after: number;
  delta: number;
  source: string;
  date: string;
  at: number;
}

export function listLogs(teamId: string, limit = 200): SkillLog[] {
  const rows = db
    .prepare(
      'SELECT id, player_id, skill, before, after, delta, source, date, at FROM skill_logs WHERE team_id = ? ORDER BY at DESC LIMIT ?'
    )
    .all(teamId, limit) as {
    id: string;
    player_id: string;
    skill: string;
    before: number;
    after: number;
    delta: number;
    source: string;
    date: string;
    at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    skill: r.skill,
    before: r.before,
    after: r.after,
    delta: r.delta,
    source: r.source,
    date: r.date,
    at: r.at
  }));
}

/** 改一项技能：写新值 + 记一条变更日志，同一个事务里完成 */
export function setSkill(
  teamId: string,
  playerId: string,
  skill: string,
  after: number,
  source: string,
  date: string
): { player: Player; log: SkillLog } | null {
  if (!SKILL_KEYS.includes(skill as never)) return null;
  const col = skill === 'set' ? 'set_' : skill;

  const row = db.prepare('SELECT * FROM players WHERE team_id = ? AND id = ?').get(teamId, playerId) as
    | PlayerRow
    | undefined;
  if (!row) return null;

  const before = row[col as keyof PlayerRow] as number;
  const value = Math.max(0, Math.min(10, Math.round(after * 2) / 2));
  const ts = now();
  const log: SkillLog = {
    id: newId('l'),
    playerId,
    skill,
    before,
    after: value,
    delta: +(value - before).toFixed(1),
    source,
    date,
    at: ts
  };

  const tx = db.transaction(() => {
    db.prepare(`UPDATE players SET ${col === 'set_' ? '"set_"' : col} = ?, updated_at = ? WHERE team_id = ? AND id = ?`).run(
      value,
      ts,
      teamId,
      playerId
    );
    db.prepare(
      'INSERT INTO skill_logs (id, team_id, player_id, skill, before, after, delta, source, date, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(log.id, teamId, playerId, skill, before, value, log.delta, source, date, ts);
  });
  tx();

  return { player: getPlayer(teamId, playerId)!, log };
}

/* ══════════ 阵型 ══════════ */

export function getFormation(teamId: string) {
  const row = db.prepare('SELECT preset, pos, updated_at FROM formations WHERE team_id = ?').get(teamId) as
    | { preset: string; pos: string; updated_at: number }
    | undefined;
  if (!row) return null;
  try {
    return { preset: row.preset, pos: JSON.parse(row.pos), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/* ══════════ 阵型库（命名保存的阵型） ══════════ */

export interface FormationSave {
  id: string;
  name: string;
  pos: Record<string, { x: number; y: number }>;
  at: number;
}

export function listFormationSaves(teamId: string): FormationSave[] {
  const rows = db
    .prepare('SELECT id, name, pos, at FROM formation_saves WHERE team_id = ? ORDER BY at')
    .all(teamId) as { id: string; name: string; pos: string; at: number }[];
  return rows
    .map((r) => {
      try {
        return { id: r.id, name: r.name, pos: JSON.parse(r.pos), at: r.at };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as FormationSave[];
}

/** 整库替换：客户端把整套阵型库推上来，服务端一个事务里删旧写新（简单、幂等、无合并冲突） */
export function replaceFormationSaves(teamId: string, saves: FormationSave[]): void {
  const del = db.prepare('DELETE FROM formation_saves WHERE team_id = ?');
  const ins = db.prepare(
    'INSERT INTO formation_saves (team_id, id, name, pos, at) VALUES (?, ?, ?, ?, ?)'
  );
  const ts = now();
  db.transaction(() => {
    del.run(teamId);
    for (const s of saves) ins.run(teamId, s.id, s.name, JSON.stringify(s.pos), s.at || ts);
  })();
}
