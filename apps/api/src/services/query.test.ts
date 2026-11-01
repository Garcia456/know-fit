import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from '../db/schema.js';
import { answerQuery } from './query.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';

/** 对话内查记录 —— 连真库；每个场景一个独立用户，自清理。 */

const USERS = [
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b2',
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
      request: { day_hint: '上周那次' },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('没听清');
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