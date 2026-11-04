import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../db/schema.js';
import { answerQuery, rangeIn } from './query.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';

/** 对话内查记录 —— 连真库；每个场景一个独立用户，自清理。 */

const USERS = [
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000b3',
  '00000000-0000-4000-8000-0000000000b5',
];

const NOW = new Date(2026, 10, 1, 9, 0, 0); // 2026-11-01

async function seed(user_id: string, date: string, name: string, weight: number, reps: number) {
  await persistWorkout({
    user_id,
    date,
    split_label: '推日',
    status: 'complete',
    missing_fields: [],
    notes: null,
    exercises: [
      {
        order: 0,
        raw_name: name,
        exercise_id: null,
        name_confidence: 'high',
        region_fallback: null,
        sets: [0, 1].map((order) => ({
          order,
          weight_kg: weight,
          reps,
          set_type: 'working' as const,
          is_inferred: false,
        })),
      },
    ],
  });
}

beforeAll(async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (e) {
    throw new Error(`连不上数据库 —— 本测试要真库：pnpm db:up && pnpm db:migrate。${(e as Error).message}`, {
      cause: e,
    });
  }
  for (const id of USERS) {
    await getDb()
      .insert(user)
      .values({ id, email: `${id}@test.local`, passwordHash: 'scrypt$locked$locked', nickname: '测试' })
      .onConflictDoNothing();
  }
  // 区间查询专用账号：一条本周（10-28）、一条三周内（10-20）
  await seed(USERS[3]!, '2026-10-20', '深蹲', 100, 5);
  await seed(USERS[3]!, '2026-10-28', '卧推', 70, 6);
});

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [USERS]);
  await closeDb();
});

describe('answerQuery：按日期查', () => {
  it('「10月31号」读到当天的动作与容量', async () => {
    const user_id = USERS[0]!;
    await seed(user_id, '2026-10-31', '卧推', 60, 8);
    await seed(user_id, '2026-10-30', '深蹲', 100, 5);

    const card = await answerQuery({
      user_id,
      now: NOW,
      request: { day_hint: '10月31号' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('2026-10-31');
    expect(card.reply).toContain('卧推 60kg×8');
    expect(card.reply).toContain('2 个正式组');
    expect(card.reply).not.toContain('深蹲');
  });

  it('当天没有记录 → 直说没有', async () => {
    const card = await answerQuery({
      user_id: USERS[0]!,
      now: NOW,
      request: { day_hint: '10月1号' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('没有训练记录');
  });

  it('日期认不出 → 追问，不按今天查', async () => {
    const card = await answerQuery({
      user_id: USERS[0]!,
      now: NOW,
      request: { day_hint: '前阵子那次' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('没听清');
  });
});

describe('rangeIn：自然周边界', () => {
  // 2026-11-01 是周日；本周一 = 10-26，上周一 = 10-19
  const now = new Date(2026, 10, 1, 9, 0, 0);

  it('本周 / 这周 → 本周一到今天', () => {
    expect(rangeIn('本周容量', now)).toMatchObject({
      label: '本周',
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(rangeIn('这周练了多少', now)?.label).toBe('本周');
  });

  it('上周 → 上周一到上周日', () => {
    expect(rangeIn('上周容量怎么样', now)).toMatchObject({
      label: '上周',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(rangeIn('上个星期呢', now)?.label).toBe('上周');
  });

  it('最近 N 周 → 含本周在内的 N 个自然周', () => {
    expect(rangeIn('最近 3 周的容量', now)).toMatchObject({
      label: '最近 3 周',
      from: '2026-10-12',
      to: '2026-11-01',
    });
    expect(rangeIn('近两周', now)).toMatchObject({ label: '最近 2 周', from: '2026-10-19' });
    expect(rangeIn('过去十二周', now)?.from).toBe('2026-08-10');
  });

  it('上限夹到 26 周；认不出 → null', () => {
    expect(rangeIn('最近 99 周', now)?.label).toBe('最近 26 周');
    expect(rangeIn('上个季度', now)).toBeNull();
    expect(rangeIn(null, now)).toBeNull();
  });

  it('「上周日」「本周三」是具体某天，不按整周算', () => {
    expect(rangeIn('上周日练了什么', now)).toBeNull();
    expect(rangeIn('本周三', now)).toBeNull();
  });
});

describe('answerQuery：区间容量', () => {
  it('上周没有记录 → 如实说没有，不回「没听清」', async () => {
    const card = await answerQuery({
      user_id: USERS[0]!,
      now: NOW,
      request: { day_hint: '上周容量怎么样' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('上周');
    expect(card.reply).toContain('2026-10-19 至 2026-10-25');
    expect(card.reply).toContain('没有训练记录');
    expect(card.reply).not.toContain('没听清');
  });

  it('本周有记录 → 天数 / 容量 / 正式组数', async () => {
    // USERS[3] 已种 10-28 卧推 70kg×6 两组（840kg）与 10-20 深蹲（不在本周）
    const card = await answerQuery({
      user_id: USERS[3]!,
      now: NOW,
      request: { day_hint: '本周容量' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('本周');
    expect(card.reply).toContain('练了 1 天');
    expect(card.reply).toContain('840kg');
    expect(card.reply).toContain('2 个正式组');
  });

  it('最近 3 周 → 含本周在内的记录一起算', async () => {
    const card = await answerQuery({
      user_id: USERS[3]!,
      now: NOW,
      request: { day_hint: '最近 3 周' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('最近 3 周');
    expect(card.reply).toContain('练了 2 天');
    expect(card.reply).toContain('1840kg');
    expect(card.reply).toContain('4 个正式组');
  });
});

describe('answerQuery：没给日期', () => {
  it('给最近一次训练', async () => {
    const user_id = USERS[1]!;
    await seed(user_id, '2026-10-20', '深蹲', 100, 5);
    await seed(user_id, '2026-10-28', '卧推', 70, 6);

    const card = await answerQuery({ user_id, now: NOW, request: { day_hint: null } });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('2026-10-28');
    expect(card.reply).toContain('卧推');
    expect(card.reply).not.toContain('深蹲');
  });
});