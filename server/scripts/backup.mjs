/**
 * 每日数据库备份（服务器 cron 调用）。
 *
 * 用 better-sqlite3 的 .backup() API 而不是直接 cp：
 * .backup() 走 SQLite 的在线备份协议，WAL 模式下也能拿到一致快照，
 * 直接 cp 可能拷到一半的页，恢复时损坏。
 *
 * 用法：node scripts/backup.mjs
 *   DB_PATH       要备份的库（默认 data/app.db）
 *   BACKUP_KEEP   保留份数（默认 14，约两周）
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');
const keep = Number(process.env.BACKUP_KEEP || 14);

if (!fs.existsSync(dbFile)) {
  console.error(`[backup] 找不到数据库：${dbFile}`);
  process.exit(1);
}

const outDir = path.join(path.dirname(dbFile), 'backups');
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const outFile = path.join(outDir, `app-${stamp}.db`);

const db = new Database(dbFile, { readonly: true });
try {
  await db.backup(outFile);
} finally {
  db.close();
}

const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);

/* 只保留最近 keep 份，旧的删掉 */
const all = fs.readdirSync(outDir)
  .filter((f) => /^app-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.test(f))
  .sort();
const removed = [];
for (const f of all.slice(0, Math.max(0, all.length - keep))) {
  fs.unlinkSync(path.join(outDir, f));
  removed.push(f);
}

console.log(`[backup] ${outFile} (${mb} MB)` +
  (removed.length ? `，清理旧备份 ${removed.length} 份` : '') +
  `，现保留 ${Math.min(all.length, keep)} 份`);
