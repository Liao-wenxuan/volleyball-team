/**
 * 测试工具：重置数据库、构造带角色的登录态。
 *
 * 约定：db 是文件级单例（每个测试文件一个内存库），文件内用例之间用 resetDb()
 * 清表隔离。种子数据直接写库（不走 API），测试用例只跟被测接口交互。
 */
import request from 'supertest';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { db, newId, now } from '../src/db';
import { signToken } from '../src/auth';

export const app: Express = createApp();

/** 清空所有业务表（外键顺序：先子后父） */
export function resetDb(): void {
  const tables = [
    'attendance',
    'skill_logs',
    'formation_saves',
    'formations',
    'sessions',
    'players',
    'invites',
    'team_members',
    'team_settings',
    'teams',
    'users'
  ];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
}

export interface SeedTeam {
  teamId: string;
  adminId: string;
  coachId: string;
  playerId: string;
  adminToken: string;
  coachToken: string;
  playerToken: string;
  /** 绑定到 player 账号的球员档案 id */
  profileId: string;
}

interface SeedOptions {
  /** 建几个测试用球员档案（不含绑定的那个），默认 2 个 */
  extraPlayers?: number;
}

/** 建一个标准队：admin + coach + 绑定球员档案的 player，返回各自 token */
export function seedTeam(name = '测试排球队', opts: SeedOptions = {}): SeedTeam {
  const ts = now();
  const teamId = newId('t');
  db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, name, ts);
  db.prepare(
    "INSERT INTO team_settings (team_id, template, theme, updated_at) VALUES (?, '[]', 'aurora', ?)"
  ).run(teamId, ts);

  const mkUser = (username: string, role: 'admin' | 'coach' | 'player', playerName?: string) => {
    const userId = newId('u');
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, must_change_pw, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 'active', NULL, ?)`
    ).run(userId, username, `${username}@local`, bcrypt.hashSync('pass123456', 10), playerName || username, ts);
    db.prepare('INSERT INTO team_members (user_id, team_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      userId,
      teamId,
      role,
      ts
    );
    return userId;
  };

  const adminId = mkUser('admin1', 'admin', '管理员');
  const coachId = mkUser('coach1', 'coach', '教练');
  const playerId = mkUser('player1', 'player', '小林');

  const profileId = newId('p');
  db.prepare(
    `INSERT INTO players (id, team_id, user_id, name, number, position, grade, height, gender, note,
                          serve, receive, "set_", spike, block, defense, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 5, 5, 5, 5, 5, 5, ?, ?)`
  ).run(profileId, teamId, playerId, '小林', 7, '主攻', '大一', 180, '男', ts, ts);

  for (let i = 0; i < (opts.extraPlayers ?? 2); i++) {
    db.prepare(
      `INSERT INTO players (id, team_id, user_id, name, number, position, grade, height, gender, note,
                            serve, receive, "set_", spike, block, defense, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, '副攻', '大一', 185, '男', '', 5, 5, 5, 5, 5, 5, ?, ?)`
    ).run(newId('p'), teamId, `队员${i + 1}`, i + 1, ts, ts);
  }

  return {
    teamId,
    adminId,
    coachId,
    playerId,
    adminToken: signToken(adminId),
    coachToken: signToken(coachId),
    playerToken: signToken(playerId),
    profileId
  };
}

/** 建第二支独立的队（不含用户，用于跨队隔离测试） */
export function seedOtherTeam(): string {
  const ts = now();
  const id = newId('t');
  db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(id, '别的队', ts);
  return id;
}

/** 别的队里放一个球员，返回球员 id */
export function seedPlayerIn(teamId: string): string {
  const id = newId('p');
  const ts = now();
  db.prepare(
    `INSERT INTO players (id, team_id, user_id, name, number, position, grade, height, gender, note,
                          serve, receive, "set_", spike, block, defense, created_at, updated_at)
     VALUES (?, ?, NULL, '外队球员', 99, '主攻', '大一', 0, '男', '', 5, 5, 5, 5, 5, 5, ?, ?)`
  ).run(id, teamId, ts, ts);
  return id;
}

/** 六个角色位的合法站位 */
export function fullPos(override: Partial<Record<string, { x: number; y: number }>> = {}) {
  return {
    oh1: { x: 1.8, y: 5.6 },
    oh2: { x: 7.0, y: 5.9 },
    mb: { x: 4.5, y: 0.85 },
    opp: { x: 2.6, y: 1.35 },
    s: { x: 6.3, y: 1.1 },
    lib: { x: 4.5, y: 7.0 },
    ...override
  };
}

/** 带 Bearer 的请求头 */
export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export { request };
