/**
 * 账号命令行：注册口关了以后，这里是「从零开号」和「忘记密码」的唯一入口。
 *
 * 只能在服务器上跑（拿到服务器权限才用得了），所以不需要额外鉴权：
 *   node dist/cli/account.js list
 *   node dist/cli/account.js create --username liao --name 廖文轩 --role admin --team 信工院排球队
 *   node dist/cli/account.js create --username wang --name 王教练 --role coach
 *   node dist/cli/account.js create --username zhang --name 张辰 --role player --player 张辰
 *   node dist/cli/account.js reset  --username zhang            # 重发一个随机密码
 *   node dist/cli/account.js disable --username zhang
 *   node dist/cli/account.js enable  --username zhang
 *
 * 为什么不给 --password：命令行参数会进 shell history 和 ps。要指定就改完密码在账号中心改。
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, newId, now, type Role } from '../db';
import { DEFAULT_TEMPLATE, DEFAULT_FORMATION } from '../defaults';

type Args = Record<string, string>;

function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const cmd = argv[0] || 'list';
  const args: Args = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return { cmd, args };
}

/** 10 位随机密码：去掉 0/O/1/l/I 这些抄错率高的字符 */
function genPassword(len = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

function require1(args: Args, key: string): string {
  const v = (args[key] || '').trim();
  if (!v) {
    console.error(`缺少参数 --${key}`);
    process.exit(1);
  }
  return v;
}

/** 找到目标队；没有就按名字建一个（含默认模板 / 站位 / 设置） */
function ensureTeam(teamName: string): string {
  const found = db.prepare('SELECT id FROM teams WHERE name = ? ORDER BY created_at LIMIT 1').get(teamName) as
    | { id: string }
    | undefined;
  if (found) return found.id;

  const teamId = newId('t');
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, teamName, ts);
    db.prepare('INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, ?, ?)').run(
      teamId,
      JSON.stringify(DEFAULT_TEMPLATE),
      'aurora',
      ts
    );
    db.prepare('INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)').run(
      teamId,
      DEFAULT_FORMATION.preset,
      JSON.stringify(DEFAULT_FORMATION.pos),
      ts
    );
  });
  tx();
  console.log(`[account] 新建球队：${teamName}`);
  return teamId;
}

function list() {
  const rows = db
    .prepare(
      `SELECT u.username, u.name, u.status, u.must_change_pw AS mustChange, u.created_at AS createdAt,
              m.role, t.name AS team
         FROM users u
    LEFT JOIN team_members m ON m.user_id = u.id
    LEFT JOIN teams t ON t.id = m.team_id
     ORDER BY u.created_at`
    )
    .all() as Array<{
    username: string;
    name: string;
    status: string;
    mustChange: number;
    createdAt: number;
    role: string | null;
    team: string | null;
  }>;

  if (!rows.length) {
    console.log('[account] 库里还没有任何账号。用 create 开第一个管理员：');
    console.log('  node dist/cli/account.js create --username <用户名> --name <姓名> --role admin --team <球队名>');
    return;
  }
  console.log(`[account] 共 ${rows.length} 个账号（DB: ${DB_FILE}）`);
  console.log('用户名'.padEnd(16) + '姓名'.padEnd(12) + '身份'.padEnd(8) + '状态'.padEnd(10) + '球队');
  for (const r of rows) {
    const role = r.role === 'admin' ? '管理员' : r.role === 'coach' ? '教练' : r.role === 'player' ? '队员' : '-';
    const st = r.status === 'active' ? (r.mustChange ? '待首登改密' : '正常') : '已停用';
    console.log(String(r.username).padEnd(16) + String(r.name).padEnd(12) + role.padEnd(8) + st.padEnd(10) + (r.team || '-'));
  }
}

function create(args: Args) {
  const username = require1(args, 'username').toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(username)) {
    console.error('用户名只能 2–32 位字母数字下划线点横线（登录时就输这个）');
    process.exit(1);
  }
  const name = (args.name || username).trim().slice(0, 20);
  const role = (args.role || 'coach') as Role;
  if (!['admin', 'coach', 'player'].includes(role)) {
    console.error('--role 只能是 admin / coach / player');
    process.exit(1);
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    console.error(`用户名 ${username} 已存在。要重设密码用：reset --username ${username}`);
    process.exit(1);
  }

  const teamId = ensureTeam((args.team || '信工院排球队').trim());

  // 队员要绑一条球员记录，否则「我的」页没数据。按姓名找，找不到就报错（不自动造球员，避免脏数据）
  let playerId: string | null = null;
  if (role === 'player') {
    const want = (args.player || name).trim();
    const p = db.prepare('SELECT id, user_id FROM players WHERE team_id = ? AND name = ?').get(teamId, want) as
      | { id: string; user_id: string | null }
      | undefined;
    if (!p) {
      console.error(`球队里没有叫「${want}」的球员，先用教练端把人录进去，或用 --player 指定已有球员姓名`);
      process.exit(1);
    }
    if (p.user_id) {
      console.error(`球员「${want}」已经绑过账号了`);
      process.exit(1);
    }
    playerId = p.id;
  }

  const password = genPassword();
  const userId = newId('u');
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?)`
    ).run(userId, username, `${username}@local`, bcrypt.hashSync(password, 10), name, ts);
    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      userId,
      teamId,
      role,
      ts
    );
    if (playerId) db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(userId, playerId);
  });
  tx();

  const roleCn = role === 'admin' ? '管理员' : role === 'coach' ? '教练' : '队员';
  console.log('────────────────────────────────');
  console.log(`  账号已创建：${username}`);
  console.log(`  密码：${password}`);
  console.log(`  身份：${roleCn}　姓名：${name}`);
  console.log('────────────────────────────────');
  console.log('密码只在这一次输出，服务器只存哈希，记下来或立刻登录改掉。');
}

function reset(args: Args) {
  const username = require1(args, 'username').toLowerCase();
  const u = db.prepare('SELECT id, name FROM users WHERE username = ?').get(username) as
    | { id: string; name: string }
    | undefined;
  if (!u) {
    console.error(`没有这个账号：${username}`);
    process.exit(1);
  }
  const password = genPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1, status = \'active\' WHERE id = ?').run(
    bcrypt.hashSync(password, 10),
    u.id
  );
  console.log('────────────────────────────────');
  console.log(`  已重置：${username}（${u.name}）`);
  console.log(`  新密码：${password}`);
  console.log('────────────────────────────────');
  console.log('下次登录会被要求改成自己的密码。');
}

function setStatus(args: Args, status: 'active' | 'disabled') {
  const username = require1(args, 'username').toLowerCase();
  const r = db.prepare('UPDATE users SET status = ? WHERE username = ?').run(status, username);
  if (!r.changes) {
    console.error(`没有这个账号：${username}`);
    process.exit(1);
  }
  console.log(`[account] ${username} → ${status === 'active' ? '已启用' : '已停用'}`);
}

const { cmd, args } = parseArgs(process.argv.slice(2));
switch (cmd) {
  case 'list':
    list();
    break;
  case 'create':
    create(args);
    break;
  case 'reset':
    reset(args);
    break;
  case 'disable':
    setStatus(args, 'disabled');
    break;
  case 'enable':
    setStatus(args, 'active');
    break;
  default:
    console.error(`未知命令：${cmd}`);
    console.error('可用：list | create | reset | disable | enable');
    process.exit(1);
}
