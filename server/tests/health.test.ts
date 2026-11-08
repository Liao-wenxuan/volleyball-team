/**
 * 健康检查：浅接口契约不能变（部署脚本和探活都依赖它），深度检查的四项判定用纯函数测。
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from './helpers';
import { collectHealth, LIMITS } from '../src/health';

const tmpDirs: string[] = [];
function tmpBackupDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-health-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('保持部署脚本依赖的轻量契约', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('volleyball-team-server');
    expect(typeof res.body.time).toBe('number');
    expect(res.body.checks).toBeUndefined();
  });
});

describe('GET /api/health/deep', () => {
  it('返回四项检查、写锁验证与聚合状态', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.failures).toEqual([]);
    expect(Object.keys(res.body.checks)).toEqual(['database', 'disk', 'memory', 'backup']);
    expect(res.body.checks.database.writable).toBe(true);
    expect(typeof res.body.durationMs).toBe('number');
  });
});

describe('备份新鲜度判定', () => {
  const now = Date.now();

  it('目录为空 → backup 失败并进入 failures', () => {
    const r = collectHealth({ backupDir: tmpBackupDir(), now });
    expect(r.checks.backup.ok).toBe(false);
    expect(r.checks.backup.reason).toBe('no_backup_file');
    expect(r.failures).toContain('backup');
    expect(r.ok).toBe(false);
  });

  it('只有 72 小时前的旧备份 → 失败', () => {
    const d = tmpBackupDir();
    const f = path.join(d, 'app-old.db');
    fs.writeFileSync(f, 'x');
    const old = new Date(now - 72 * 3_600_000);
    fs.utimesSync(f, old, old);
    const r = collectHealth({ backupDir: d, now });
    expect(r.checks.backup.ok).toBe(false);
    expect(r.checks.backup.ageHours).toBeGreaterThan(LIMITS.maxBackupAgeHours);
  });

  it('有新鲜备份 → 通过，且忽略 -wal / -shm', () => {
    const d = tmpBackupDir();
    fs.writeFileSync(path.join(d, 'app-new.db'), 'x');
    fs.writeFileSync(path.join(d, 'app-new.db-wal'), 'x');
    fs.writeFileSync(path.join(d, 'app-new.db-shm'), 'x');
    const r = collectHealth({ backupDir: d, now });
    expect(r.checks.backup.ok).toBe(true);
    expect(r.checks.backup.latest).toBe('app-new.db');
    expect(r.failures).toEqual([]);
  });

  it('未配置备份目录 → 跳过，不算故障', () => {
    const r = collectHealth({ backupDir: null, now });
    expect(r.checks.backup.skipped).toBe(true);
    expect(r.failures).not.toContain('backup');
    expect(r.ok).toBe(true);
  });
});
