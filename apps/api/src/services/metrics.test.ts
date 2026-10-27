import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistExerciseInput, PersistWorkoutInput } from '../graph/deps.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { bodyMetric, user } from '../db/schema.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';
import {
  prevSameSplitVolume,
  sessionVolume,
  statsRange,
  volumeHookFor,
  weeklyVolume,
  weightHistory,
} from './metrics.js';

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
          volume_kg: 2000,
          working_sets: 5,
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

/** 周聚合没有 split 过滤 —— 用独立用户隔离，别让别的测试记录混进来 */
const WEEK_USER = '00000000-0000-4000-8000-0000000000e1';
const WEIGHT_USER = '00000000-0000-4000-8000-0000000000e2';

describe('weeklyVolume：按周一起算的自然周', () => {
  const now = new Date('2026-10-21T12:00:00'); // 周三 → 本周一 = 10-19

  beforeAll(async () => {
    await getDb().insert(user).values({ id: WEEK_USER }).onConflictDoNothing();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM "user" WHERE id = $1', [WEEK_USER]);
  });

  it('空用户 → 全 0，算不出环比', async () => {
    const out = await weeklyVolume({ user_id: WEEK_USER, weeks: 4, now });
    expect(out.weeks.map((w) => w.week_start)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(out.weeks.every((w) => w.total_volume_kg === 0 && w.working_sets === 0)).toBe(true);
    expect(out.this_week_kg).toBe(0);
    expect(out.last_week_kg).toBe(0);
    expect(out.delta_pct).toBeNull();
  });

  it('跨月归到各自自然周；本周与上周差值按上周算', async () => {
    const rows = [
      { date: '2026-09-28', volume: 1000, sets: 2 }, // 周一，窗口第一周
      { date: '2026-10-04', volume: 500, sets: 1 }, // 周日，仍属第一周
      { date: '2026-10-06', volume: 2000, sets: 4 },
      { date: '2026-10-13', volume: 3000, sets: 6 },
      { date: '2026-10-19', volume: 2500, sets: 5 },
    ];
    for (const r of rows) {
      await persistWorkout({ ...workout({ split: `${BASE}周`, ...r }), user_id: WEEK_USER });
    }

    const out = await weeklyVolume({ user_id: WEEK_USER, weeks: 4, now });
    expect(out.weeks.map((w) => w.total_volume_kg)).toEqual([1500, 2000, 3000, 2500]);
    expect(out.weeks.map((w) => w.working_sets)).toEqual([3, 4, 6, 5]);
    expect(out.this_week_kg).toBe(2500);
    expect(out.last_week_kg).toBe(3000);
    expect(out.delta_pct).toBe(-16.67);
  });

  it('窗口外的记录不计入', async () => {
    await persistWorkout({
      ...workout({ split: `${BASE}周`, date: '2026-09-20', volume: 9999, sets: 9 }),
      user_id: WEEK_USER,
    });
    const out = await weeklyVolume({ user_id: WEEK_USER, weeks: 4, now });
    expect(out.weeks[0]?.total_volume_kg).toBe(1500);
  });
});

describe('weightHistory：只取有记录的日子', () => {
  const now = new Date('2026-10-21T12:00:00');

  beforeAll(async () => {
    await getDb().insert(user).values({ id: WEIGHT_USER }).onConflictDoNothing();
    await getDb()
      .insert(bodyMetric)
      .values([
        { userId: WEIGHT_USER, date: '2026-09-30', weightKg: 80 },
        { userId: WEIGHT_USER, date: '2026-10-10', weightKg: 79.2 },
        { userId: WEIGHT_USER, date: '2026-10-20', weightKg: 78.4 },
        { userId: WEIGHT_USER, date: '2026-08-01', weightKg: 82 }, // 窗口外
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM "user" WHERE id = $1', [WEIGHT_USER]);
  });

  it('升序点、最新值、首尾差值；窗口外的不算', async () => {
    const out = await weightHistory({ user_id: WEIGHT_USER, weeks: 8, now });
    expect(out.points.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-10', '2026-10-20']);
    expect(out.latest).toEqual({ date: '2026-10-20', weight_kg: 78.4 });
    expect(out.delta_kg).toBe(-1.6);
  });

  it('单点 → 差值为 null', async () => {
    const one = '00000000-0000-4000-8000-0000000000e3';
    await getDb().insert(user).values({ id: one }).onConflictDoNothing();
    await getDb()
      .insert(bodyMetric)
      .values({ userId: one, date: '2026-10-15', weightKg: 70 })
      .onConflictDoNothing();

    const out = await weightHistory({ user_id: one, weeks: 8, now });
    expect(out.points).toHaveLength(1);
    expect(out.delta_kg).toBeNull();
    await getPool().query('DELETE FROM "user" WHERE id = $1', [one]);
  });

  it('没有点 → latest 为 null', async () => {
    const out = await weightHistory({ user_id: WEEK_USER, weeks: 8, now });
    expect(out.points).toEqual([]);
    expect(out.latest).toBeNull();
    expect(out.delta_kg).toBeNull();
  });
});

/** 统计页范围聚合 —— 独立用户，避免别的记录混进范围 */
const STATS_USER = '00000000-0000-4000-8000-0000000000e4';

describe('statsRange：任意日期范围聚合', () => {
  beforeAll(async () => {
    await getDb().insert(user).values({ id: STATS_USER }).onConflictDoNothing();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM "user" WHERE id = $1', [STATS_USER]);
  });

  it('空范围 → 不补零、无体重点', async () => {
    const out = await statsRange({ user_id: STATS_USER, from: '2026-03-01', to: '2026-03-31' });
    expect(out.days).toEqual([]);
    expect(out.total_volume_kg).toBe(0);
    expect(out.working_sets).toBe(0);
    expect(out.training_days).toBe(0);
    expect(out.weight_points).toEqual([]);
    expect(out.weight_latest).toBeNull();
    expect(out.weight_delta_kg).toBeNull();
  });

  it('跨月：逐日容量、总量、训练天数、肌群分摊、体重首尾差', async () => {
    const rows = [
      { date: '2026-03-31', volume: 1000, sets: 2 },
      { date: '2026-04-02', volume: 1500, sets: 3 },
      { date: '2026-04-02', volume: 500, sets: 1 }, // 同日第二次训练，合到同一天
      { date: '2026-02-27', volume: 9999, sets: 9 }, // 范围外
    ];
    for (const r of rows) {
      await persistWorkout({ ...workout({ split: `${BASE}统计`, ...r }), user_id: STATS_USER });
    }
    await getDb()
      .insert(bodyMetric)
      .values([
        { userId: STATS_USER, date: '2026-03-31', weightKg: 80 },
        { userId: STATS_USER, date: '2026-02-01', weightKg: 85 }, // 范围外
        { userId: STATS_USER, date: '2026-04-02', weightKg: 79 },
      ])
      .onConflictDoNothing();

    const out = await statsRange({ user_id: STATS_USER, from: '2026-03-31', to: '2026-04-02' });
    expect(out.days).toEqual([
      { date: '2026-03-31', total_volume_kg: 1000, working_sets: 2 },
      { date: '2026-04-02', total_volume_kg: 2000, working_sets: 4 },
    ]);
    expect(out.total_volume_kg).toBe(3000);
    expect(out.working_sets).toBe(6);
    expect(out.training_days).toBe(2);
    // 卧推：胸 1.0，前三角 / 三头各 0.5
    expect(out.by_muscle.chest).toBe(3000);
    expect(out.by_muscle.delt_ant).toBe(1500);
    expect(out.by_muscle.triceps).toBe(1500);
    expect(out.weight_points.map((p) => p.date)).toEqual(['2026-03-31', '2026-04-02']);
    expect(out.weight_latest).toEqual({ date: '2026-04-02', weight_kg: 79 });
    expect(out.weight_delta_kg).toBe(-1);
  });

  it('单日范围 + 单个体重点 → 差值为 null', async () => {
    const out = await statsRange({ user_id: STATS_USER, from: '2026-03-31', to: '2026-03-31' });
    expect(out.days).toHaveLength(1);
    expect(out.training_days).toBe(1);
    expect(out.weight_points).toHaveLength(1);
    expect(out.weight_delta_kg).toBeNull();
  });
});