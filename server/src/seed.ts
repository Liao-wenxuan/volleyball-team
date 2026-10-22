/**
 * 开发种子：造一个演示账号 + 几名队员，方便联调。
 * 正式环境不需要跑这个脚本。
 * 用法：npm run seed  →  demo@xgy.com / demo123456
 */
import bcrypt from 'bcryptjs';
import { db, newId, now } from './db';
import { DEFAULT_TEMPLATE, DEFAULT_FORMATION } from './defaults';

const EMAIL = 'demo@xgy.com';

const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL);
if (exists) {
  console.log('[seed] 演示账号已存在，跳过');
  process.exit(0);
}

const userId = newId('u');
const teamId = newId('t');
const ts = now();

const players = [
  { name: '张辰', number: 1, position: '主攻', grade: '大三', height: 188 },
  { name: '李响', number: 3, position: '副攻', grade: '大二', height: 192 },
  { name: '王泽', number: 6, position: '二传', grade: '大四', height: 182 },
  { name: '陈默', number: 7, position: '接应', grade: '大二', height: 186 },
  { name: '刘一帆', number: 9, position: '主攻', grade: '大一', height: 185 },
  { name: '赵启', number: 12, position: '自由人', grade: '大三', height: 176 }
];

const tx = db.transaction(() => {
  db.prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    EMAIL,
    bcrypt.hashSync('demo123456', 10),
    '演示账号',
    ts
  );
  db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, '信工院排球队', ts);
  db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
    userId, teamId, 'owner', ts
  );
  db.prepare('INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, ?, ?, ?)').run(
    teamId, JSON.stringify(DEFAULT_TEMPLATE), 'aurora', ts
  );
  db.prepare('INSERT INTO formations (team_id, preset, pos, updated_at) VALUES (?, ?, ?, ?)').run(
    teamId, DEFAULT_FORMATION.preset, JSON.stringify(DEFAULT_FORMATION.pos), ts
  );
  const ins = db.prepare(
    `INSERT INTO players (id, team_id, name, number, position, grade, height, serve, receive, "set_", spike, block, defense, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 5, 5, 5, 5, 5, 5, ?, ?)`
  );
  for (const p of players) {
    ins.run(newId('p'), teamId, p.name, p.number, p.position, p.grade, p.height, ts, ts);
  }
});
tx();

console.log('[seed] 完成：demo@xgy.com / demo123456，含 6 名队员');
