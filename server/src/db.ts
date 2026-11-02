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
  id             TEXT PRIMARY KEY,
  username       TEXT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_by     TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 一个用户可以属于多个队，角色决定他落到哪个端：
-- admin 管理（只有队主）/ coach 教练（平板全读写）/ player 队员（手机只读）
CREATE TABLE IF NOT EXISTS team_members (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('admin','coach','player')),
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
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL, -- 绑定的登录账号（队员端靠它知道「我是谁」）
  name       TEXT NOT NULL,
  number     INTEGER NOT NULL DEFAULT 0,
  position   TEXT NOT NULL DEFAULT '主攻',
  grade      TEXT NOT NULL DEFAULT '大一',
  height     INTEGER NOT NULL DEFAULT 0,
  gender     TEXT NOT NULL DEFAULT '',   -- ''/男/女；号码查重只在同性别内做，所以必须跟着同步
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

-- 邀请码：管理员生成，新队员凭码入队。撤销用 revoked 标记，保留记录可追溯
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invites_team ON invites(team_id);
`);

export const SKILL_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'defense'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/* ══════════════════════════════════════════════════════════════════
 * 迁移：v2 账号体系（三端角色 + 用户名登录）
 *
 * 为什么不用「重建 users 表」的标准姿势：
 *   users 被 team_members / invites 外键引用，foreign_keys=ON 时 DROP TABLE
 *   会走 ON DELETE CASCADE 把成员关系一起删干净 —— 那是数据丢失，不是迁移。
 *   所以 users 只 ADD COLUMN（不能加 NOT NULL 且无默认值的列，这里都有默认值）。
 *
 * team_members 的 CHECK 约束绕不过去，必须重建；但它没有被任何表引用，
 *   先建新表 → 搬数据顺便映射角色 → drop 旧表 → 改名，全程安全。
 *
 * 幂等：靠 username 列 / team_members 的 DDL 文本判断是否已经迁过。
 * ══════════════════════════════════════════════════════════════════ */
export const ROLES = ['admin', 'coach', 'player'] as const;
export type Role = (typeof ROLES)[number];

function columnNames(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function migrateAccountV2() {
  // 1. users 补列 + 回填 username
  if (!columnNames('users').includes('username')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN username TEXT;
      ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE users ADD COLUMN created_by TEXT;
    `);

    // 老账号没有用户名：取邮箱 @ 前面那段，重名加数字后缀
    const rows = db
      .prepare('SELECT id, email FROM users ORDER BY created_at')
      .all() as { id: string; email: string }[];
    const used = new Set<string>();
    const upd = db.prepare('UPDATE users SET username = ? WHERE id = ?');
    for (const r of rows) {
      const base = String(r.email).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
      let u = base;
      let n = 2;
      while (used.has(u)) u = base + n++;
      used.add(u);
      upd.run(u, r.id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    console.log(`[db] 账号体系迁移：${rows.length} 个老账号已分配用户名`);
  }

  // 2. team_members 换 CHECK + 角色值映射
  const ddl =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='team_members'").get() as
      | { sql: string }
      | undefined)?.sql || '';
  if (ddl.includes("'owner'")) {
    db.exec(`
      CREATE TABLE team_members_new (
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        role      TEXT NOT NULL CHECK (role IN ('admin','coach','player')),
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, team_id)
      );
      INSERT INTO team_members_new (user_id, team_id, role, joined_at)
        SELECT user_id, team_id,
               CASE role WHEN 'owner' THEN 'admin' WHEN 'editor' THEN 'coach' ELSE 'player' END,
               joined_at
          FROM team_members;
      DROP TABLE team_members;
      ALTER TABLE team_members_new RENAME TO team_members;
    `);
    console.log('[db] 角色迁移完成：owner→admin / editor→coach / viewer→player');
  }

  // 3. players 补 gender（前端 10-31 加的字段，服务端一直漏了，云端模式性别会被丢掉）
  if (!columnNames('players').includes('gender')) {
    db.exec("ALTER TABLE players ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
  }

  // 4. players 绑定登录账号
  if (!columnNames('players').includes('user_id')) {
    db.exec('ALTER TABLE players ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }

  // 4. 索引统一在最后建：老库走到这里时列才刚补齐（放建表语句里会因缺列直接炸）
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_players_user ON players(user_id) WHERE user_id IS NOT NULL;
  `);
}

migrateAccountV2();

/**
 * 迁移：管理端（多球队运营）
 *
 * teams 加 status 列（'active' | 'disabled'）。为什么只 ADD COLUMN 不重建：
 * teams 被 team_members / players / sessions / team_settings / formations /
 * formation_saves / invites / skill_logs 八处外键引用，foreign_keys=ON 时
 * DROP TABLE 会级联清空全库 —— 那是数据丢失，不是迁移（同 users 的教训）。
 * 停用语义在 auth.ts 执行：requireAuth 解析出 membership 后查这里的状态。
 */
function migrateAdminV2() {
  if (!columnNames('teams').includes('status')) {
    db.exec("ALTER TABLE teams ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    console.log('[db] 管理端迁移：teams 已补 status 列');
  }
}

migrateAdminV2();

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
