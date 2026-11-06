/**
 * 备份导入：merge 认人规则、replace 清场与账号绑定保留、事务性、清洗兜底。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, seedTeam, seedOtherTeam, seedPlayerIn, fullPos, auth, type SeedTeam } from './helpers';

let s: SeedTeam;
beforeEach(() => {
  resetDb();
  s = seedTeam();
});

function backupPlayer(over: Record<string, unknown> = {}) {
  return {
    id: 'bk_p1',
    name: '张三',
    number: 11,
    position: '二传',
    grade: '大二',
    height: 188,
    gender: '男',
    note: '有潜力',
    skills: { serve: 6, receive: 6, set: 6, spike: 8, block: 6, defense: 6 },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...over
  };
}

async function postImport(token: string, body: object) {
  return request(app).post('/api/import').set(auth(token)).send(body);
}

describe('导入权限', () => {
  it('队员身份 → 403', async () => {
    const res = await postImport(s.playerToken, { mode: 'merge', data: { players: [] } });
    expect(res.status).toBe(403);
  });

  it('未登录 → 401', async () => {
    expect((await request(app).post('/api/import').send({ mode: 'merge', data: { players: [] } })).status).toBe(401);
  });

  it('mode 不合法 → 400', async () => {
    const res = await postImport(s.coachToken, { mode: 'overwrite', data: { players: [] } });
    expect(res.status).toBe(400);
  });

  it('players 超上限（301）→ 400', async () => {
    const players = Array.from({ length: 301 }, (_, i) => backupPlayer({ id: `p${i}`, name: `n${i}` }));
    const res = await postImport(s.coachToken, { mode: 'merge', data: { players } });
    expect(res.status).toBe(400);
  });
});

describe('merge 模式：认人与合并', () => {
  it('全新名单 → 全部按新增处理', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ name: '新队员', number: 20 })] }
    });
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ added: 1, matched: 0 });
  });

  it('同名同号命中 → 覆盖位置/年级/身高/技能，姓名号码性别保持本机', async () => {
    // 种子队里有 队员1/号码1；备份里同号但名字不同的属性
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [
          backupPlayer({ id: 'bk_x', name: '队员1', number: 1, position: '自由人', height: 199, note: '备注' })
        ]
      }
    });
    expect(res.body.stats.matched).toBe(1);

    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const p = players.body.players.find((x: { number: number }) => x.number === 1);
    expect(p.name).toBe('队员1'); // 姓名保持本机（也一致）
    expect(p.position).toBe('自由人');
    expect(p.height).toBe(199);
    expect(p.note).toBe('备注');
    expect(p.skills.spike).toBe(8);
  });

  it('号码没对上但双方姓名唯一 → 按姓名合并', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ name: '队员1', number: 42 })] }
    });
    expect(res.body.stats.matched).toBe(1);
    expect(res.body.stats.added).toBe(0);
  });

  it('姓名不唯一（本机有两个同名）→ 不按姓名认，避免误合并', async () => {
    // 手动造两个同名队员
    await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '同名', number: 30 });
    await request(app).post('/api/players').set(auth(s.coachToken)).send({ name: '同名', number: 31 });

    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ name: '同名', number: 99 })] }
    });
    // 号码 99 对不上 + 姓名两边不唯一 → 走新增
    expect(res.body.stats.added).toBe(1);
    expect(res.body.stats.matched).toBe(0);
  });

  it('本机独有的人，备份里没有 → 原样保留', async () => {
    await postImport(s.coachToken, { mode: 'merge', data: { players: [backupPlayer({ name: '外来户', number: 50 })] } });
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const total = players.body.players.length;
    expect(total).toBeGreaterThanOrEqual(4); // 3 种子 + 1 导入

    await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ name: '另一个人', number: 51 })] }
    });
    const players2 = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(players2.body.players.some((p: { name: string }) => p.name === '外来户')).toBe(true);
  });

  it('备份多出来的训练 + 考勤：按「日期+开始时间」合并，考勤 id 正确翻译', async () => {
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const pid = players.body.players[0].id;
    // 备份里的 playerId 是备份 id，需要能被翻译 —— 用 merge 先建人拿到映射？
    // 简化：考勤挂在一个已存在且按姓名+号码能认出来的人身上
    const known = players.body.players.find((p: { name: string }) => p.name === '队员1');

    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [backupPlayer({ id: 'bk_player1', name: '队员1', number: 1 })],
        weeks: {
          '2026-01-05': [
            {
              id: 'bk_s1',
              date: '2026-01-06',
              start: '19:00',
              end: '21:00',
              venue: '备份馆',
              status: 'scheduled',
              attendance: { bk_player1: 'present' }
            }
          ]
        }
      }
    });
    expect(res.status).toBe(200);
    expect(res.body.stats.sAdd).toBe(1);

    const weeks = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    const session = weeks.body.weeks['2026-01-05'].find((x: { date: string }) => x.date === '2026-01-06');
    expect(session.venue).toBe('备份馆');
    // 孤儿考勤会被丢弃；这里的考勤属于命中的人，应该翻译成功
    expect(session.attendance[known.id]).toBe('present');
    // 备份 id 不应直接出现在服务端
    expect(session.attendance['bk_player1']).toBeUndefined();
  });

  it('孤儿考勤（指向备份里不存在的人）直接丢弃，不 500', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [backupPlayer({ name: '只有他', number: 21 })],
        weeks: {
          '2026-01-05': [
            {
              id: 'bk_s2',
              date: '2026-01-07',
              start: '19:00',
              end: '21:00',
              attendance: { bk_ghost: 'present' }
            }
          ]
        }
      }
    });
    expect(res.status).toBe(200);
    const weeks = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    const session = weeks.body.weeks['2026-01-05'].find((x: { date: string }) => x.date === '2026-01-07');
    expect(session).toBeTruthy();
    expect(session.attendance).toEqual({});
  });

  it('同一场训练 merge：备份考勤整格覆盖', async () => {
    // 先在 2026-01-06 建一场训练并给队员1登记 present
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const known = players.body.players.find((p: { name: string }) => p.name === '队员1');
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(s.coachToken))
      .send({ date: '2026-01-06', start: '19:00', end: '21:00' });
    const sid = created.body.session.id;
    await request(app)
      .put(`/api/sessions/${sid}/attendance/${known.id}`)
      .set(auth(s.coachToken))
      .send({ state: 'absent' });

    await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [backupPlayer({ id: 'bk_p9', name: '队员1', number: 1 })],
        weeks: {
          '2026-01-05': [
            { id: 'bk_s3', date: '2026-01-06', start: '19:00', end: '21:30', attendance: { bk_p9: 'late' } }
          ]
        }
      }
    });

    const weeks = await request(app).get('/api/weeks/all').set(auth(s.coachToken));
    const session = weeks.body.weeks['2026-01-05'].find((x: { id: string }) => x.id === sid);
    expect(session.end).toBe('21:30'); // 备份覆盖了结束时间
    expect(session.attendance[known.id]).toBe('late'); // 整格覆盖
  });

  it('技能日志只追加不覆盖，重复的按五元组去重', async () => {
    const log = {
      id: 'bk_l1',
      playerId: 'bk_p1',
      skill: 'spike',
      before: 5,
      after: 7,
      source: 'training',
      date: '2026-11-01',
      at: 1700000000000
    };
    await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer()], skillLogs: [log] }
    });
    // 完全相同的一条再来一次 → 去重，不产生第二条
    const res2 = await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer()], skillLogs: [{ ...log }] }
    });
    expect(res2.body.stats.lAdd).toBe(0);

    const logs = await request(app).get('/api/skills/logs').set(auth(s.coachToken));
    expect(logs.body.logs).toHaveLength(1);
  });

  it('非法技能/无 playerId 的日志被清洗掉', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [backupPlayer()],
        skillLogs: [
          { id: 'l1', playerId: 'bk_p1', skill: 'cooking', before: 5, after: 6, date: '2026-11-01' },
          { id: 'l2', skill: 'spike', before: 5, after: 6, date: '2026-11-01' }
        ]
      }
    });
    expect(res.status).toBe(200);
    expect(res.body.stats.lAdd).toBe(0);
  });
});

describe('清洗兜底：宁可变默认值也不整包失败', () => {
  it('身高带单位、技能是字符串、性别为空 → 全部兜底', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: {
        players: [
          backupPlayer({
            name: '脏数据',
            height: '188cm',
            gender: '',
            skills: { spike: '9', serve: 'abc' }
          })
        ]
      }
    });
    expect(res.status).toBe(200);
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const p = players.body.players.find((x: { name: string }) => x.name === '脏数据');
    expect(p.height).toBe(0); // Number('188cm') 非 finite → 0
    expect(p.gender).toBe('');
    expect(p.skills.spike).toBe(9); // 字符串 '9' 能转数字
    expect(p.skills.serve).toBe(5); // 'abc' → 默认 5
  });

  it('技能越界被夹到 0~10，分数归到 0.5 步长', async () => {
    await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ skills: { spike: 99, serve: 3.3 } })] }
    });
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    const p = players.body.players.find((x: { name: string }) => x.name === '张三');
    expect(p.skills.spike).toBe(10);
    expect(p.skills.serve).toBe(3.5);
  });

  it('没名字的行直接丢弃', async () => {
    const res = await postImport(s.coachToken, {
      mode: 'merge',
      data: { players: [backupPlayer({ name: '', number: 77 }), backupPlayer({ id: 'bk_ok', name: '有名字', number: 78 })] }
    });
    expect(res.body.stats.incPlayers).toBe(1);
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(players.body.players.some((p: { number: number }) => p.number === 77)).toBe(false);
    expect(players.body.players.some((p: { number: number }) => p.number === 78)).toBe(true);
  });
});

describe('replace 模式：清场重建', () => {
  it('清空本队再按备份重建；本机独有的人被删掉', async () => {
    await postImport(s.coachToken, {
      mode: 'replace',
      data: { players: [backupPlayer({ name: '新全队', number: 1 })] }
    });
    const players = await request(app).get('/api/players').set(auth(s.coachToken));
    expect(players.body.players).toHaveLength(1);
    expect(players.body.players[0].name).toBe('新全队');
  });

  it('队员账号的绑定关系在 replace 后保留（凭姓名+号码找回）', async () => {
    // 种子 player1 绑定 profile：队员1 名字、号码 7
    const res = await postImport(s.coachToken, {
      mode: 'replace',
      data: { players: [backupPlayer({ name: '小林', number: 7 })] }
    });
    expect(res.status).toBe(200);

    // 队员账号登录后仍能看到自己的数据
    const me = await request(app).get('/api/me/summary').set(auth(s.playerToken));
    expect(me.status).toBe(200);
    expect(me.body.player).not.toBeNull();
    expect(me.body.player.name).toBe('小林');
  });

  it('replace 带模板和主题 → 设备偏好跟着备份走', async () => {
    await postImport(s.coachToken, {
      mode: 'replace',
      data: {
        players: [backupPlayer()],
        settings: { theme: 'ocean', template: [{ id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '' }] },
        formation: { preset: 'custom', pos: fullPos() },
        formations: [{ id: 'f1', name: '接发球', pos: fullPos() }]
      }
    });
    const settings = await request(app).get('/api/settings').set(auth(s.coachToken));
    expect(settings.body.settings.theme).toBe('ocean');
    expect(settings.body.settings.template).toHaveLength(1);

    const f = await request(app).get('/api/formation').set(auth(s.coachToken));
    expect(f.body.formation.preset).toBe('custom');

    const lib = await request(app).get('/api/formation/library').set(auth(s.coachToken));
    expect(lib.body.formations).toHaveLength(1);
    expect(lib.body.formations[0].name).toBe('接发球');
  });

  it('跨队隔离：replace 只清本队，别的队毫发无损', async () => {
    const other = seedOtherTeam();
    const foreignId = seedPlayerIn(other);
    await postImport(s.coachToken, {
      mode: 'replace',
      data: { players: [backupPlayer({ name: '重建队', number: 1 })] }
    });
    // 直接查库确认外队球员还在
    const { db } = await import('../src/db');
    const row = db.prepare('SELECT id FROM players WHERE id = ?').get(foreignId);
    expect(row).toBeTruthy();
  });
});
