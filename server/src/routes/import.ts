/**
 * 批量导入：把一份本机备份整体写进云端（「导入备份」的第四种落地方式）
 *
 * 为什么需要这个接口（2026-11-02 用户发现的问题）：
 *   前端「导入备份」一直只做 `db = ...; save(); location.reload()`，写的是 localStorage。
 *   可云端模式下 reload 会触发 cloud.js 的 pullCore()，用服务器数据整份覆盖本机 ——
 *   导入的内容在刷新那一瞬间就被抹掉，用户看到的是「提示成功了但数据没变」。
 *   逐条调现有 REST 也不合适：20 人一学期的备份要发上千个请求，中途失败就是半截脏数据。
 *   所以这里一个事务写完，要么全成、要么一行不动。
 *
 * 语义对齐前端 mergeBackup()（app.js），不搞两套规则：
 *   - merge：按「姓名::号码」认人；号码没对上时，只有两边这个姓名都唯一才按姓名认。
 *            命中的只覆盖 位置/年级/身高/技能（姓名、号码、性别保持本机），备份多出来的人补上，
 *            本机独有、备份里没有的人原样保留。
 *            训练按「日期 + 开始时间」认同一场，同场用备份的考勤整格覆盖。
 *            技能记录只追加不覆盖，按「人 + 项 + 日期 + 前后分」去重。
 *            模板/主题/阵型库属于设备偏好，merge 时不动（跟本地版完全一致）。
 *   - replace：先清空本队，再照备份重建，模板/主题/阵型一并替换。
 *
 * id 一律由服务端重新生成（newId），不吃备份里的 id：
 *   players.id 是全局主键（不是 team 内联合主键），别的队可能已经占了同一个值，
 *   直接插会撞主键。备份 id → 新 id 的映射走 idMap，考勤和技能记录跟着翻译；
 *   翻译不到的目标（孤儿考勤）直接丢弃，否则外键约束会让整个事务回滚。
 *
 * 清洗而不是硬 reject：备份是历史数据，字段缺失/脏值很常见（身高带 cm、性别为空、
 * 技能是字符串）。这里按前端 normalizeDB 的口径逐字段兜底，宁可变默认值也不要整包失败。
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, newId, now, SKILL_KEYS, type SkillKey } from '../db';
import { asyncHandler, parse } from '../http';
import { requireAuth, requireRole, type AuthedRequest } from '../auth';
import { GRADES, POSITIONS } from '../repo';

const router = Router();
router.use(requireAuth);

/* ══════════ 上限（防误传整个浏览器存储 / 恶意大包） ══════════ */

const MAX_PLAYERS = 300;
const MAX_SESSIONS = 3000;
const MAX_LOGS = 20000;
const MAX_FORMATIONS = 30;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ['present', 'late', 'leave', 'absent'] as const;
const THEMES = ['aurora', 'ocean', 'forest', 'sunset', 'sakura', 'graphite', 'paper', 'sand', 'mint'];
const ROLES6 = ['oh1', 'oh2', 'mb', 'opp', 's', 'lib'];

/** 只校验外层结构与规模，内层交给下面的清洗函数逐字段兜底 */
const importSchema = z.object({
  mode: z.enum(['merge', 'replace']),
  data: z
    .object({
      players: z.array(z.unknown()).max(MAX_PLAYERS, `最多导入 ${MAX_PLAYERS} 名队员`),
      weeks: z.record(z.string(), z.array(z.unknown())).optional(),
      skillLogs: z.array(z.unknown()).max(MAX_LOGS).optional(),
      settings: z.unknown().optional(),
      formation: z.unknown().optional(),
      formations: z.array(z.unknown()).max(MAX_FORMATIONS).optional()
    })
    .passthrough()
});

/* ══════════ 清洗 ══════════ */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const roundHalf = (v: number): number => Math.round(v * 2) / 2;
const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

interface CleanPlayer {
  id: string;
  name: string;
  number: number;
  position: string;
  grade: string;
  height: number;
  gender: string;
  skills: Record<SkillKey, number>;
  createdAt: number;
  updatedAt: number;
}

function cleanPlayer(raw: unknown): CleanPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const name = str(p.name, 20);
  if (!name) return null; // 没名字的人没法认，直接丢（前端 normalizeDB 也是这么做的）

  const num = Number(p.number);
  const height = Number(p.height);
  const skillsRaw = (p.skills && typeof p.skills === 'object' ? p.skills : {}) as Record<string, unknown>;
  const skills = {} as Record<SkillKey, number>;
  for (const k of SKILL_KEYS) {
    const v = Number(skillsRaw[k]);
    skills[k] = Number.isFinite(v) ? clamp(roundHalf(v), 0, 10) : 5;
  }

  const created = Number(p.createdAt) || now();
  return {
    id: String(p.id ?? ''),
    name,
    number: Number.isFinite(num) ? clamp(Math.trunc(num), 0, 99) : 0,
    position: POSITIONS.includes(String(p.position)) ? String(p.position) : '主攻',
    grade: GRADES.includes(String(p.grade)) ? String(p.grade) : '大一',
    height: Number.isFinite(height) ? clamp(Math.trunc(height), 0, 250) : 0,
    gender: p.gender === '男' || p.gender === '女' ? p.gender : '',
    skills,
    createdAt: created,
    updatedAt: Number(p.updatedAt) || created
  };
}

interface CleanSession {
  id: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  templateId: string | null;
  status: 'scheduled' | 'cancelled';
  cancelReason: string;
  attendance: Record<string, string>;
}

function cleanSession(raw: unknown): CleanSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const date = str(s.date, 10);
  if (!DATE.test(date)) return null;
  const attendance: Record<string, string> = {};
  if (s.attendance && typeof s.attendance === 'object') {
    for (const [pid, state] of Object.entries(s.attendance as Record<string, unknown>)) {
      if (STATES.includes(state as (typeof STATES)[number])) attendance[pid] = String(state);
    }
  }
  return {
    id: String(s.id ?? ''),
    date,
    start: HHMM.test(String(s.start)) ? String(s.start) : '16:30',
    end: HHMM.test(String(s.end)) ? String(s.end) : '18:30',
    venue: str(s.venue, 60),
    templateId: s.templateId ? str(s.templateId, 30) : null,
    status: s.status === 'cancelled' ? 'cancelled' : 'scheduled',
    cancelReason: str(s.cancelReason, 60),
    attendance
  };
}

interface CleanLog {
  id: string;
  playerId: string;
  skill: SkillKey;
  before: number;
  after: number;
  source: string;
  date: string;
  at: number;
}

function cleanLog(raw: unknown): CleanLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const playerId = String(l.playerId ?? '');
  if (!playerId) return null;
  const skill = String(l.skill ?? '') as SkillKey;
  if (!SKILL_KEYS.includes(skill)) return null;
  const before = Number(l.before);
  const after = Number(l.after);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const b = clamp(roundHalf(before), 0, 10);
  const a = clamp(roundHalf(after), 0, 10);
  return {
    id: String(l.id ?? ''),
    playerId,
    skill,
    before: b,
    after: a,
    source: ['training', 'match', 'manual'].includes(String(l.source)) ? String(l.source) : 'manual',
    date: DATE.test(String(l.date)) ? String(l.date) : new Date().toISOString().slice(0, 10),
    at: Number(l.at) || now()
  };
}

function cleanTemplate(raw: unknown): { id: string; day: number; label: string; start: string; end: string; venue: string }[] {
  const list = Array.isArray(raw) ? raw.slice(0, 3) : [];
  const out: { id: string; day: number; label: string; start: string; end: string; venue: string }[] = [];
  list.forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const o = t as Record<string, unknown>;
    const day = Number(o.day);
    const safeDay = Number.isFinite(day) ? clamp(Math.trunc(day), 0, 6) : [2, 5, 0][i] ?? 2;
    out.push({
      id: str(o.id, 30) || ['tue', 'fri', 'sun'][i] || `t${i}`,
      day: safeDay,
      label: str(o.label, 10) || ['周二', '周五', '周日'][i] || '训练',
      start: HHMM.test(String(o.start)) ? String(o.start) : '16:30',
      end: HHMM.test(String(o.end)) ? String(o.end) : '18:30',
      venue: str(o.venue, 60)
    });
  });
  return out;
}

type PosMap = Record<string, { x: number; y: number }>;

/** 六个角色位必须齐全，少一个前端画不出来（跟 routes/formation.ts 同一口径） */
function cleanPos(raw: unknown): PosMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: PosMap = {};
  for (const role of ROLES6) {
    const v = src[role] as { x?: unknown; y?: unknown } | undefined;
    if (!v || typeof v !== 'object') return null;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 9 || y < 0 || y > 9) return null;
    out[role] = { x, y };
  }
  return out;
}

/* ══════════ 主逻辑 ══════════ */

router.post(
  '/',
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const body = parse(importSchema, req.body);
    const data = body.data as Record<string, unknown>;

    const incPlayers = (data.players as unknown[]).map(cleanPlayer).filter((p): p is CleanPlayer => !!p);
    const incSessions: CleanSession[] = [];
    if (data.weeks && typeof data.weeks === 'object') {
      for (const arr of Object.values(data.weeks as Record<string, unknown>)) {
        if (!Array.isArray(arr)) continue;
        for (const s of arr) {
          const c = cleanSession(s);
          if (c) incSessions.push(c);
        }
      }
    }
    if (incSessions.length > MAX_SESSIONS) incSessions.length = MAX_SESSIONS;
    const incLogs = ((data.skillLogs as unknown[]) || []).map(cleanLog).filter((l): l is CleanLog => !!l);

    const teamId = r.teamId;
    const mode = body.mode;
    const ts = now();

    const insPlayer = db.prepare(
      `INSERT INTO players (id, team_id, user_id, name, number, position, grade, height, gender,
                            serve, receive, "set_", spike, block, defense, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updPlayer = db.prepare(
      `UPDATE players SET position = ?, grade = ?, height = ?,
              serve = ?, receive = ?, "set_" = ?, spike = ?, block = ?, defense = ?, updated_at = ?
        WHERE team_id = ? AND id = ?`
    );
    const insSession = db.prepare(
      `INSERT INTO sessions (id, team_id, date, start, end_time, venue, template_id, status, cancel_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updSession = db.prepare(
      `UPDATE sessions SET end_time = ?, venue = ?, status = ?, cancel_reason = ?
        WHERE team_id = ? AND id = ?`
    );
    const insAtt = db.prepare(
      'INSERT OR REPLACE INTO attendance (session_id, player_id, state, updated_at) VALUES (?, ?, ?, ?)'
    );
    const delAtt = db.prepare('DELETE FROM attendance WHERE session_id = ?');
    const insLog = db.prepare(
      `INSERT INTO skill_logs (id, team_id, player_id, skill, before, after, delta, source, date, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const templateTaken = db.prepare(
      'SELECT 1 FROM sessions WHERE team_id = ? AND date = ? AND template_id = ?'
    );

    /** 同一场训练的模板 id 可能已经被占用（UNIQUE(team_id,date,template_id)），占用就降级为加练 */
    const pickTemplateId = (date: string, wanted: string | null): string | null => {
      if (!wanted) return null;
      return templateTaken.get(teamId, date, wanted) ? null : wanted;
    };

    const run = db.transaction(() => {
      const noKey = (name: string, number: number): string => `${name}::${number || 0}`;

      /* ── 1. 清场（replace） ──
       * 删球员行之前先记下「姓名+号码 → 绑定的登录账号」：
       * 队员账号的绑定关系存在 players.user_id 上，行一删就没，
       * 重建后不迁回去的话，队员登录「我的」会看不到自己。 */
      const keepBind = new Map<string, string>();
      if (mode === 'replace') {
        const rows = db
          .prepare('SELECT name, number, user_id FROM players WHERE team_id = ? AND user_id IS NOT NULL')
          .all(teamId) as { name: string; number: number; user_id: string }[];
        for (const p of rows) keepBind.set(noKey(p.name, p.number), p.user_id);

        db.prepare('DELETE FROM attendance WHERE session_id IN (SELECT id FROM sessions WHERE team_id = ?)').run(teamId);
        db.prepare('DELETE FROM sessions WHERE team_id = ?').run(teamId);
        db.prepare('DELETE FROM skill_logs WHERE team_id = ?').run(teamId);
        db.prepare('DELETE FROM players WHERE team_id = ?').run(teamId);
      }

      /* ── 2. 队员：认人 + 写入，产出 备份id → 服务器id 的映射 ── */
      const cur = db
        .prepare('SELECT id, name, number FROM players WHERE team_id = ?')
        .all(teamId) as { id: string; name: string; number: number }[];

      const countName = (list: { name: string }[]): Map<string, number> => {
        const m = new Map<string, number>();
        for (const p of list) m.set(p.name, (m.get(p.name) || 0) + 1);
        return m;
      };
      const curByName = countName(cur);
      const incByName = countName(incPlayers);
      const curByNo = new Map(cur.map((p) => [noKey(p.name, p.number), p]));
      const usedIds = new Set(cur.map((p) => p.id));

      const idMap = new Map<string, string>(); // 备份 id → 服务器 id
      let matched = 0;
      let added = 0;

      for (const p of incPlayers) {
        let hit = mode === 'replace' ? undefined : curByNo.get(noKey(p.name, p.number));
        if (!hit && mode !== 'replace') {
          // 号码一方没录（0）时按姓名认，但要求两边这个名字都唯一，避免同名误合并
          if (curByName.get(p.name) === 1 && incByName.get(p.name) === 1) {
            hit = cur.find((x) => x.name === p.name);
          }
        }

        if (hit) {
          idMap.set(p.id, hit.id);
          updPlayer.run(
            p.position, p.grade, p.height,
            p.skills.serve, p.skills.receive, p.skills.set, p.skills.spike, p.skills.block, p.skills.defense,
            p.updatedAt, teamId, hit.id
          );
          matched += 1;
        } else {
          const nid = newId('p');
          usedIds.add(nid);
          idMap.set(p.id, nid);
          // 一个账号只能绑一行：备份里万一有同名同号的重复行，第二行不抢绑（否则唯一索引会炸整个事务）
          let bind: string | null = null;
          if (mode === 'replace') {
            const key = noKey(p.name, p.number);
            bind = keepBind.get(key) || null;
            if (bind) keepBind.delete(key);
          }
          insPlayer.run(
            nid, teamId, bind,
            p.name, p.number, p.position, p.grade, p.height, p.gender,
            p.skills.serve, p.skills.receive, p.skills.set, p.skills.spike, p.skills.block, p.skills.defense,
            p.createdAt, p.updatedAt
          );
          added += 1;
        }
      }

      /* ── 3. 训练 + 考勤：按「日期 + 开始时间」认同一场 ── */
      const existing = mode === 'replace'
        ? []
        : (db.prepare('SELECT id, date, start FROM sessions WHERE team_id = ?').all(teamId) as
            { id: string; date: string; start: string }[]);
      const byDateStart = new Map(existing.map((s) => [`${s.date}|${s.start}`, s.id]));

      let sOver = 0;
      let sAdd = 0;
      for (const s of incSessions) {
        const key = `${s.date}|${s.start}`;
        const sid = byDateStart.get(key);

        const att: [string, string][] = [];
        for (const [pid, state] of Object.entries(s.attendance)) {
          const nid = idMap.get(pid);
          if (nid) att.push([nid, state]); // 翻译不到就是孤儿考勤，丢弃（否则外键失败）
        }

        if (sid) {
          updSession.run(s.end, s.venue, s.status, s.cancelReason, teamId, sid);
          delAtt.run(sid); // 备份的考勤整格覆盖：先清后写
          for (const [pid, state] of att) insAtt.run(sid, pid, state, ts);
          sOver += 1;
        } else {
          const nid = newId('s');
          insSession.run(
            nid, teamId, s.date, s.start, s.end, s.venue,
            pickTemplateId(s.date, s.templateId), s.status, s.cancelReason, ts
          );
          for (const [pid, state] of att) insAtt.run(nid, pid, state, ts);
          byDateStart.set(key, nid);
          sAdd += 1;
        }
      }

      /* ── 4. 技能记录：只追加，按「人 + 项 + 日期 + 前后分」去重 ── */
      const seen = new Set<string>();
      if (mode !== 'replace') {
        const rows = db
          .prepare('SELECT player_id, skill, date, before, after FROM skill_logs WHERE team_id = ?')
          .all(teamId) as { player_id: string; skill: string; date: string; before: number; after: number }[];
        for (const l of rows) seen.add(`${l.player_id}|${l.skill}|${l.date}|${l.before}|${l.after}`);
      }
      let lAdd = 0;
      for (const l of incLogs) {
        const pid = idMap.get(l.playerId);
        if (!pid) continue;
        const key = `${pid}|${l.skill}|${l.date}|${l.before}|${l.after}`;
        if (seen.has(key)) continue;
        seen.add(key);
        insLog.run(
          newId('log'), teamId, pid, l.skill, l.before, l.after,
          Number((l.after - l.before).toFixed(1)), l.source, l.date, l.at
        );
        lAdd += 1;
      }

      /* ── 5. 模板 / 主题 / 阵型：replace 才跟备份走，merge 保留本机偏好 ── */
      let prefs = 0;
      if (mode === 'replace') {
        const settings = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Record<string, unknown>;
        const template = cleanTemplate(settings.template);
        const theme = THEMES.includes(String(settings.theme)) ? String(settings.theme) : null;
        if (template.length || theme) {
          const curSet = db.prepare('SELECT template, theme FROM team_settings WHERE team_id = ?').get(teamId) as
            | { template: string; theme: string }
            | undefined;
          const tpl = template.length ? JSON.stringify(template) : curSet?.template || '[]';
          const th = theme || curSet?.theme || 'aurora';
          db.prepare(
            `INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(team_id) DO UPDATE SET template = excluded.template, theme = excluded.theme, updated_at = excluded.updated_at`
          ).run(teamId, tpl, th, ts);
          prefs += 1;
        }

        const formation = data.formation as Record<string, unknown> | undefined;
        const pos = cleanPos(formation?.pos);
        if (pos) {
          const preset = str(formation?.preset, 20) || 'custom';
          db.prepare(
            `INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(team_id) DO UPDATE SET preset = excluded.preset, pos = excluded.pos, updated_at = excluded.updated_at`
          ).run(teamId, preset, JSON.stringify(pos), ts);
          prefs += 1;
        }

        const saves = Array.isArray(data.formations) ? data.formations.slice(0, MAX_FORMATIONS) : [];
        if (saves.length) {
          db.prepare('DELETE FROM formation_saves WHERE team_id = ?').run(teamId);
          const insSave = db.prepare(
            'INSERT OR REPLACE INTO formation_saves (team_id, id, name, pos, at) VALUES (?, ?, ?, ?, ?)'
          );
          let n = 0;
          for (const f of saves) {
            const o = f as Record<string, unknown>;
            const p2 = cleanPos(o.pos);
            if (!p2) continue;
            const name = str(o.name, 12) || '未命名';
            const fid = str(o.id, 40) || `f${n}`;
            if (n >= MAX_FORMATIONS) break;
            insSave.run(teamId, fid, name, JSON.stringify(p2), Number(o.at) || ts);
            n += 1;
          }
          prefs += n ? 1 : 0;
        }
      }

      return {
        matched,
        added,
        kept: cur.length - matched,
        sOver,
        sAdd,
        lAdd,
        prefs,
        incPlayers: incPlayers.length,
        incSessions: incSessions.length,
        incLogs: incLogs.length
      };
    });

    const stats = run();
    res.json({ mode, stats });
  })
);

export default router;
