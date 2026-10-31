import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistWorkoutInput } from '../graph/deps.js';
import { user } from '../db/schema.js';
import { applyEdit } from './edit.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';

/**
 * 对话内修改 —— 连真库。
 * 每个场景一个独立用户，自清理（删 user 级联记录）。
 */

const USERS = [
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3',
  '00000000-0000-4000-8000-0000000000a4',
];

const NOW = new Date('2032-02-10T09:00:00');

function workout(input: {
  user_id: string;
  date: string;
  exercises: { name: string; weight: number; reps: number; sets: number }[];
}): PersistWorkoutInput {
  return {
    user_id: input.user_id,
    date: input.date,
    split_label: 'e2e-edit',
    status: 'complete',
    missing_fields: [],
    notes: null,
    exercises: input.exercises.map((e, i) => ({
      order: i,
      raw_name: e.name,
      exercise_id: e.name === '卧推' ? 'bench_press' : null,
      name_confidence: 'high' as const,
      region_fallback: null,
      sets: Array.from({ length: e.sets }, (_, j) => ({
        order: j,
        weight_kg: e.weight,
        reps: e.reps,
        set_type: 'working' as const,
        is_inferred: false,
      })),
    })),
  };
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

describe('applyEdit：改动作名与重量', () => {
  it('今天的「器械卧推单边」改成「器械卧推」，重量 60kg', async () => {
    const user_id = USERS[0]!;
    await persistWorkout(
      workout({
        user_id,
        date: '2032-02-10',
        exercises: [{ name: '器械卧推单边', weight: 50, reps: 10, sets: 2 }],
      }),
    );

    const card = await applyEdit({
      user_id,
      now: NOW,
      request: {
        target: { day_hint: '今天', exercise_name: '器械卧推单边' },
        changes: { day_hint: null, exercise_name: '器械卧推', weight_kg: 60, reps: null },
      },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('器械卧推');
    expect(card.reply).toContain('60kg');

    const rows = await getPool().query<{ raw_name: string; weight_kg: number }>(
      `SELECT ee.raw_name, se.weight_kg FROM exercise_entry ee
         JOIN set_entry se ON se.exercise_entry_id = ee.id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1 ORDER BY se."order"`,
      [user_id],
    );
    expect(rows.rows.every((r) => r.raw_name === '器械卧推')).toBe(true);
    expect(rows.rows.every((r) => r.weight_kg === 60)).toBe(true);
  });
});

describe('applyEdit：改日期', () => {
  it('「把最上面的训练改成昨天的」→ 最新一条日期前移一天', async () => {
    const user_id = USERS[1]!;
    await persistWorkout(
      workout({ user_id, date: '2032-02-08', exercises: [{ name: '深蹲', weight: 100, reps: 5, sets: 3 }] }),
    );

    const card = await applyEdit({
      user_id,
      now: NOW,
      request: {
        target: { day_hint: null, exercise_name: null },
        changes: { day_hint: '昨天', exercise_name: null, weight_kg: null, reps: null },
      },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('2032-02-09');

    const rows = await getPool().query<{ date: string }>(
      'SELECT date::text AS date FROM workout_session WHERE user_id = $1',
      [user_id],
    );
    expect(rows.rows).toEqual([{ date: '2032-02-09' }]);
  });
});

describe('applyEdit：找不到就不动手', () => {
  it('动作不存在 → 说明，数据不变', async () => {
    const user_id = USERS[2]!;
    await persistWorkout(
      workout({ user_id, date: '2032-02-10', exercises: [{ name: '深蹲', weight: 100, reps: 5, sets: 3 }] }),
    );

    const card = await applyEdit({
      user_id,
      now: NOW,
      request: {
        target: { day_hint: '今天', exercise_name: '硬拉' },
        changes: { day_hint: null, exercise_name: null, weight_kg: 120, reps: null },
      },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('没找到');

    const rows = await getPool().query<{ weight_kg: number }>(
      `SELECT se.weight_kg FROM set_entry se
         JOIN exercise_entry ee ON ee.id = se.exercise_entry_id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1 AND ee.raw_name = $2`,
      [user_id, '深蹲'],
    );
    expect(rows.rows.every((r) => r.weight_kg === 100)).toBe(true);
  });

  it('多个动作都匹配 → 不猜，数据不变', async () => {
    const user_id = USERS[3]!;
    await persistWorkout(
      workout({
        user_id,
        date: '2032-02-10',
        exercises: [
          { name: '卧推', weight: 80, reps: 8, sets: 2 },
          { name: '上斜卧推', weight: 60, reps: 8, sets: 2 },
        ],
      }),
    );

    const card = await applyEdit({
      user_id,
      now: NOW,
      request: {
        target: { day_hint: '今天', exercise_name: '卧推' },
        changes: { day_hint: null, exercise_name: null, weight_kg: 90, reps: null },
      },
    });

    expect(card.kind).toBe('chat');
    if (card.kind !== 'chat') throw new Error('unreachable');
    expect(card.reply).toContain('分不清');

    const rows = await getPool().query<{ weight_kg: number }>(
      `SELECT se.weight_kg FROM set_entry se
         JOIN exercise_entry ee ON ee.id = se.exercise_entry_id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1 ORDER BY se.weight_kg DESC`,
      [user_id],
    );
    expect(rows.rows[0]?.weight_kg).toBe(80);
  });
});