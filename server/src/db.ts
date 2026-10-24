/**
 * 数据库层：连接 + 建表 + 通用工具
 *
 * 设计原则
 * 1. 每张业务表都带 team_id，所有查询强制按 team 作用域过滤（多租户隔离靠 SQL 保证，不靠应用层记得写）。
 * 2. 技能存 6 个 REAL 列而不是 JSON —— 要能直接写 AVG(spike) 这种统计，也能加索引。
 *    JSON 只留给「结构灵活、不需要聚合」的字段（队形坐标、训练模板）。
 * 3. 出勤用 (session_id, player_id) 复合主键，天然去重，改状态就是 UPSERT。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 一个用户可以属于多个队，角色区分；v1 只会用到 owner
CREATE TABLE IF NOT EXISTS team_members (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id)
);

-- 每队一份：训练模板 + 界面主题
CREATE TABLE IF NOT EXISTS team_settings (
  team_id    TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  template   TEXT NOT NULL DEFAULT '[]',
  theme      TEXT NOT NULL DEFAULT 'aurora',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  number     INTEGER NOT NULL DEFAULT 0,
  position   TEXT NOT NULL DEFAULT '主攻',
  grade      TEXT NOT NULL DEFAULT '大一',
  height     INTEGER NOT NULL DEFAULT 0,
  serve      REAL NOT NULL DEFAULT 5,
  receive    REAL NOT NULL DEFAULT 5,
  set_       REAL NOT NULL DEFAULT 5,
  spike      REAL NOT NULL DEFAULT 5,
  block      REAL NOT NULL DEFAULT 5,
  defense    REAL NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,              -- YYYY-MM-DD
  start         TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  venue         TEXT NOT NULL DEFAULT '',
  template_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  UNIQUE (team_id, date, template_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_team_date ON sessions(team_id, date);

CREATE TABLE IF NOT EXISTS attendance (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  state      TEXT NOT NULL CHECK (state IN ('present','late','leave','absent')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS skill_logs (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill     TEXT NOT NULL,
  before    REAL NOT NULL,
  after     REAL NOT NULL,
  delta     REAL NOT NULL,
  source    TEXT NOT NULL DEFAULT 'manual',
  date      TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_team ON skill_logs(team_id, date);

CREATE TABLE IF NOT EXISTS formations (
  team_id    TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  preset     TEXT NOT NULL DEFAULT 'base',
  pos        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 阵型库：用户自己存命名阵型，每队最多 30 套（和当前站位 formations 分开）
CREATE TABLE IF NOT EXISTS formation_saves (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  pos     TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);
`);

export const SKILL_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'defense'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** 跟前端一致的短 id：p_xxx / s_xxx / l_xxx */
export function newId(prefix: string): string {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function now(): number {
  return Date.now();
}

/** 日期 YYYY-MM-DD（用本地时间，不用 UTC，避免跨时区错一天） */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 传进来的任意日期 → 那一周的周一 */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
