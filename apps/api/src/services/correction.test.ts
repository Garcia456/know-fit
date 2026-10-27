import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistWorkoutInput } from '../graph/deps.js';
import { user } from '../db/schema.js';
import { applyWeightCorrection, parseWeightCorrection } from './correction.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';

/**
 * 窄修正 —— 解析是纯函数，写路径连真库。
 * 每个场景一个独立用户，自清理（删 user 级联记录）。
 */

const USERS = [
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000f4',
];

function workout(input: {
  user_id: string;
  date: string;
  exercises: { name: string; weight: number; reps: number; sets: number }[];
}): PersistWorkoutInput {
  return {
    user_id: input.user_id,
    date: input.date,
    split_label: 'e2e-correction',
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
    await getDb().insert(user).values({ id }).onConflictDoNothing();
  }
});

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [USERS]);
  await closeDb();
});

describe('parseWeightCorrection：只认带两个数值的更正句', () => {
  it('「刚才是 75kg 不是 70」→ 旧 70 新 75', () => {
    expect(parseWeightCorrection('刚才是 75kg 不是 70')).toEqual({ old_kg: 70, new_kg: 75 });
  });

  it('「刚才不是 70 是 75」→ 旧 70 新 75', () => {
    expect(parseWeightCorrection('刚才的不是 70kg，是 75kg')).toEqual({ old_kg: 70, new_kg: 75 });
  });

  it('「70 说错了，应该是 75」→ 旧 70 新 75', () => {
    expect(parseWeightCorrection('上一组 70 说错了，应该是 75')).toEqual({ old_kg: 70, new_kg: 75 });
  });

  it('小数与全角单位也认', () => {
    expect(parseWeightCorrection('刚才 77.5 公斤不是 75')).toEqual({ old_kg: 75, new_kg: 77.5 });
  });

  it('没有更正线索 → null（普通录入不能被当成修正）', () => {
    expect(parseWeightCorrection('卧推 75kg 8 次 4 组')).toBeNull();
  });

  it('只有一个数 / 两个数相同 → null', () => {
    expect(parseWeightCorrection('刚才 75kg 少记了一组')).toBeNull();
    expect(parseWeightCorrection('刚才是 75 不是 75')).toBeNull();
  });
});

describe('applyWeightCorrection：命中一个才动手', () => {
  it('唯一命中 → 改组、重算容量，返回 correction 卡', async () => {
    const user_id = USERS[0]!;
    await persistWorkout(
      workout({
        user_id,
        date: '2032-01-10',
        exercises: [
          { name: '卧推', weight: 70, reps: 8, sets: 4 },
          { name: '飞鸟', weight: 30, reps: 10, sets: 2 },
        ],
      }),
    );

    const result = await applyWeightCorrection({ user_id, old_kg: 70, new_kg: 75 });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error('unreachable');

    expect(result.card).toMatchObject({
      kind: 'correction',
      exercise_index: 0,
      old_weight_kg: 70,
      new_weight_kg: 75,
      corrected_sets: 4,
      volume_kg: 3000, // 75×8×4 + 30×10×2
      working_sets: 6,
    });
    expect(result.card.exercises[0]?.sets.every((s) => s.weight_kg === 75)).toBe(true);
    expect(result.card.exercises[1]?.sets.every((s) => s.weight_kg === 30)).toBe(true);

    const rows = await getPool().query<{ weight_kg: number }>(
      `SELECT se.weight_kg FROM set_entry se
         JOIN exercise_entry ee ON ee.id = se.exercise_entry_id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1 ORDER BY se.order`,
      [user_id],
    );
    expect(rows.rows.filter((r) => r.weight_kg === 75)).toHaveLength(4);
  });

  it('零命中 → 不改数据，返回说明', async () => {
    const user_id = USERS[1]!;
    await persistWorkout(
      workout({ user_id, date: '2032-01-11', exercises: [{ name: '卧推', weight: 70, reps: 8, sets: 2 }] }),
    );

    const result = await applyWeightCorrection({ user_id, old_kg: 100, new_kg: 105 });
    expect(result.status).toBe('no_match');
    if (result.status !== 'no_match') throw new Error('unreachable');
    expect(result.reply).toContain('没找到');

    const rows = await getPool().query<{ weight_kg: number }>(
      `SELECT se.weight_kg FROM set_entry se
         JOIN exercise_entry ee ON ee.id = se.exercise_entry_id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1`,
      [user_id],
    );
    expect(rows.rows.every((r) => r.weight_kg === 70)).toBe(true);
  });

  it('多命中 → 不猜，数据不动', async () => {
    const user_id = USERS[2]!;
    await persistWorkout(
      workout({
        user_id,
        date: '2032-01-12',
        exercises: [
          { name: '卧推', weight: 70, reps: 8, sets: 2 },
          { name: '上斜卧推', weight: 70, reps: 8, sets: 2 },
        ],
      }),
    );

    const result = await applyWeightCorrection({ user_id, old_kg: 70, new_kg: 75 });
    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') throw new Error('unreachable');
    expect(result.reply).toContain('2 个动作');

    const rows = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM set_entry se
         JOIN exercise_entry ee ON ee.id = se.exercise_entry_id
         JOIN workout_session ws ON ws.id = ee.session_id
        WHERE ws.user_id = $1 AND se.weight_kg = 75`,
      [user_id],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('没有记录 → no_session', async () => {
    const result = await applyWeightCorrection({ user_id: USERS[3]!, old_kg: 70, new_kg: 75 });
    expect(result.status).toBe('no_session');
  });
});