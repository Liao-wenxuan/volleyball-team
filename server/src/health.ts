/**
 * 深度健康检查：只读 / 轻量，给外部探活与运维排障用。
 *
 * 单独成模块是因为 app.ts 只负责装配；collectHealth(opts) 是纯函数，
 * 不开端口就能测，也不用 mock 一台机器出来。
 *
 * 刻意不做的事：
 * - 不写业务数据。「可写」只验证能不能拿到写锁：BEGIN IMMEDIATE 后立刻 ROLLBACK，
 *   既证明主库可写，又不留下任何一行。
 * - 不跑 PRAGMA integrity_check：全库扫描会把 health 自己拖超时，那是备份演练该干的事。
 * - 不返回绝对路径、库内容、账号信息：这是公网可达接口。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from './db';

export interface HealthCheck {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  [k: string]: unknown;
}

export interface HealthReport {
  ok: boolean;
  name: string;
  time: number;
  durationMs: number;
  checks: Record<string, HealthCheck>;
  failures: string[];
}

const MB = 1024 * 1024;
export const LIMITS = {
  minDiskFreeMB: 512,
  minSystemAvailableMB: 128,
  maxBackupAgeHours: 36
};

export interface HealthOptions {
  now?: number;
  dbPath?: string;
  /** 传 null 可强制跳过备份检查（测试用） */
  backupDir?: string | null;
}

function checkDatabase(): HealthCheck {
  const t = Date.now();
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) return { ok: false, reason: 'select_failed', ms: Date.now() - t };
    // WAL 下 BEGIN IMMEDIATE 需要拿 RESERVED 写锁；拿不到就说明主库此刻不可写。
    // ROLLBACK 后库内容零变化，不会污染业务数据。
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    const journal = db.pragma('journal_mode', { simple: true }) as string;
    return { ok: true, writable: true, journal, ms: Date.now() - t };
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 本来就没开成事务 */
    }
    return { ok: false, reason: 'db_unavailable', ms: Date.now() - t };
  }
}

function checkDisk(dbPath: string): HealthCheck {
  try {
    const st = fs.statfsSync(path.dirname(path.resolve(dbPath)));
    const freeMB = Math.round((Number(st.bavail) * Number(st.bsize)) / MB);
    return { ok: freeMB >= LIMITS.minDiskFreeMB, freeMB, minFreeMB: LIMITS.minDiskFreeMB };
  } catch {
    // 少数平台没有 statfs：跳过，而不是把「查不到」误判成「磁盘满」
    return { ok: true, skipped: true, reason: 'statfs_unavailable' };
  }
}

function checkMemory(): HealthCheck {
  const availableMB = Math.round(os.freemem() / MB);
  return {
    ok: availableMB >= LIMITS.minSystemAvailableMB,
    systemAvailableMB: availableMB,
    systemTotalMB: Math.round(os.totalmem() / MB),
    processRssMB: Math.round(process.memoryUsage().rss / MB),
    minAvailableMB: LIMITS.minSystemAvailableMB
  };
}

function checkBackup(dir: string | null | undefined, now: number): HealthCheck {
  if (!dir) return { ok: true, skipped: true, reason: 'no_backup_dir' };
  try {
    // 备份目录里会混着 SQLite 的 -wal / -shm，只认真正的 .db 快照
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^app-.*\.db$/.test(f))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return { ok: false, reason: 'no_backup_file' };
    const ageHours = Math.round(((now - files[0].mtime) / 3_600_000) * 10) / 10;
    return {
      ok: ageHours <= LIMITS.maxBackupAgeHours,
      latest: files[0].name,
      ageHours,
      maxAgeHours: LIMITS.maxBackupAgeHours
    };
  } catch {
    return { ok: true, skipped: true, reason: 'backup_dir_unreadable' };
  }
}

export function collectHealth(opts: HealthOptions = {}): HealthReport {
  const started = Date.now();
  const now = opts.now ?? started;
  const dbPath = opts.dbPath ?? process.env.DB_PATH ?? '';
  const backupDir =
    opts.backupDir !== undefined
      ? opts.backupDir
      : process.env.HEALTH_BACKUP_DIR ||
        (dbPath && dbPath !== ':memory:' ? path.join(path.dirname(dbPath), 'backups') : null);

  const checks: Record<string, HealthCheck> = {
    database: checkDatabase(),
    disk: checkDisk(dbPath || path.join(__dirname, '..', 'data', 'app.db')),
    memory: checkMemory(),
    backup: checkBackup(backupDir, now)
  };
  const failures = Object.entries(checks)
    .filter(([, c]) => !c.ok)
    .map(([k]) => k);

  return {
    ok: failures.length === 0,
    name: 'volleyball-team-server',
    time: now,
    durationMs: Date.now() - started,
    checks,
    failures
  };
}
