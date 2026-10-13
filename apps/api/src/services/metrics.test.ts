import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistExerciseInput, PersistWorkoutInput } from '../graph/deps.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { closeDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';
import { prevSameSplitVolume, sessionVolume, volumeHookFor } from './metrics.js';

/**
 * 训练量的读与算 —— 必须连真库（现算不落库，基线要从历史记录里挑）。
 * 自清理：写完即删。
 */

// 每个 describe 用各自的 split —— 基线要跨记录挑，共用一个会互相干扰
const BASE = 'e2e-metrics-';
const MISSING = '00000000-0000-4000-8000-0000000000ff';

function workout(input: {
  split: string;
  date: string;
  volume: number;
  sets: number;
  withWarmup?: boolean;
  withAmbiguous?: boolean;
}): PersistWorkoutInput {
  const working = Array.from({ length: input.sets }, (_, j) => ({
    order: j,
    weight_kg: input.volume / input.sets / 5,
    reps: 5,
    set_type: 'working' as const,
    is_inferred: false,
  }));
  const warmup = input.withWarmup
    ? [0, 1].map((j) => ({
        order: j,
        weight_kg: 40,
        reps: 10,
        set_type: 'warmup' as const,
        is_inferred: false,
      }))
    : [];

  const exercises: PersistExerciseInput[] = [
    {
      order: 0,
      raw_name: '卧推',
      exercise_id: 'bench_press',
      name_confidence: 'high' as const,
      region_fallback: null,
      sets: [...warmup, ...working],
    },
  ];
  if (input.withAmbiguous) {
    exercises.push({
      order: 1,
      raw_name: '飞鸟',
      exercise_id: null,
      name_confidence: 'high' as const,
      region_fallback: null,
      sets: [],
    });
  }

  return {
    user_id: SINGLE_USER_ID,
    date: input.date,
    split_label: input.split,
    status: 'complete' as const,
    missing_fields: [],
    notes: '测完即删',
    exercises,
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
});

afterAll(async () => {
  await getPool().query('DELETE FROM workout_session WHERE split_label LIKE $1', [`${BASE}%`]);
  await closeDb();
});

describe('sessionVolume：现算容量与肌群分摊', () => {
  const split = `${BASE}容量`;

  it('热身组被滤掉；主动肌 1.0 / 协同肌 0.5；未识别的动作计数', async () => {
    const { session_id } = await persistWorkout(
      workout({ split, date: '2026-09-01', volume: 2500, sets: 5, withWarmup: true, withAmbiguous: true }),
    );

    const v = await sessionVolume(session_id);
    expect(v).not.toBeNull();
    expect(v?.total_volume_kg).toBe(2500); // 2 组热身（各 400）不算
    expect(v?.working_sets).toBe(5);
    expect(v?.warmup_sets).toBe(2);
    expect(v?.by_muscle.chest).toBe(2500);
    expect(v?.by_muscle.delt_ant).toBe(1250);
    expect(v?.unrecognized_exercises).toBe(1); // 「飞鸟」定不到动作也定不到部位
  });

  it('不存在的记录 → null', async () => {
    expect(await sessionVolume(MISSING)).toBeNull();
  });
});

describe('prevSameSplitVolume：基线取同一个 split 的上一次', () => {
  const split = `${BASE}基线`;

  it('排在后面的那次，基线是前面那次；最早那次没有基线', async () => {
    const a = await persistWorkout(workout({ split, date: '2026-09-15', volume: 3000, sets: 6 }));
    const b = await persistWorkout(workout({ split, date: '2026-09-22', volume: 2000, sets: 5 }));

    expect(await prevSameSplitVolume({ user_id: SINGLE_USER_ID, split_label: split, exclude_session_id: b.session_id })).toBe(3000);
    expect(await prevSameSplitVolume({ user_id: SINGLE_USER_ID, split_label: split, exclude_session_id: a.session_id })).toBeNull();
  });
});

describe('volumeHookFor：给卡片的钩子', () => {
  const split = `${BASE}钩子`;

  it('算出环比差值', async () => {
    const a = await persistWorkout(workout({ split, date: '2026-10-01', volume: 2500, sets: 5 }));
    const b = await persistWorkout(workout({ split, date: '2026-10-08', volume: 2000, sets: 5 }));

    const hook = await volumeHookFor({
      user_id: SINGLE_USER_ID,
      session_id: b.session_id,
      session_date: '2026-10-08',
      split_label: split,
      exercises: [
        {
          raw_name: '卧推',
          exercise_id: 'bench_press',
          name_zh: '杠铃卧推',
          region_fallback: null,
          name_confidence: 'high',
          sets: Array.from({ length: 5 }, () => ({
            weight_kg: 80,
            reps: 5,
            set_type: 'working' as const,
            is_inferred: false,
          })),
        },
      ],
    });

    expect(hook.current).toBe(2000);
    expect(hook.baseline).toBe(2500);
    expect(hook.delta_pct).toBe(-20);
    expect(hook.baseline_kind).toBe('prev_same_split');
    void a;
  });
});