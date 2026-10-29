import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { user, workoutSession } from '../db/schema.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import type { PersistWorkoutInput } from '../graph/deps.js';
import {
  appendToSession,
  deleteSession,
  getSessionDetail,
  listHistory,
  listSessions,
  updateSession,
} from './history.js';
import { getDb, getPool, closeDb } from './pool.js';
import { persistWorkout } from './record.js';

/**
 * 历史读 + 追加式补全 —— 连真库。
 * 用 2031-03 这段未来日期隔离，自清理。
 */

const FROM = '2031-03-01';
const TO = '2031-03-31';
let sessionId = '';

function incomplete(): PersistWorkoutInput {
  return {
    user_id: SINGLE_USER_ID,
    date: '2031-03-02',
    split_label: 'e2e-history-背日',
    status: 'incomplete',
    missing_fields: ['reps'],
    notes: null,
    exercises: [
      {
        order: 0,
        raw_name: 'e2e-history-引体向上',
        exercise_id: null,
        name_confidence: 'low',
        region_fallback: 'region_back',
        sets: [
          { order: 0, weight_kg: 70, reps: null, set_type: 'working', is_inferred: false },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  ({ session_id: sessionId } = await persistWorkout(incomplete()));
});

afterAll(async () => {
  await getDb().delete(workoutSession).where(eq(workoutSession.id, sessionId));
  await closeDb();
});

describe('listSessions', () => {
  it('按日期区间过滤，且带 split / status', async () => {
    const rows = await listSessions({ user_id: SINGLE_USER_ID, from: FROM, to: TO });
    const hit = rows.find((r) => r.session_id === sessionId);
    expect(hit).toMatchObject({
      date: '2031-03-02',
      split_label: 'e2e-history-背日',
      status: 'incomplete',
    });
  });

  it('区间外不返回', async () => {
    const rows = await listSessions({ user_id: SINGLE_USER_ID, from: '2031-04-01', to: '2031-04-30' });
    expect(rows.some((r) => r.session_id === sessionId)).toBe(false);
  });
});

describe('getSessionDetail', () => {
  it('给动作、组、缺失字段与容量', async () => {
    const detail = await getSessionDetail({ user_id: SINGLE_USER_ID, session_id: sessionId });
    expect(detail?.missing_fields).toEqual(['reps']);
    expect(detail?.exercises[0]?.raw_name).toBe('e2e-history-引体向上');
    expect(detail?.exercises[0]?.sets[0]?.reps).toBeNull();
    // 次数缺失的组不计容量（dev-003 口径），算被跳过的组
    expect(detail?.volume.total_volume_kg).toBe(0);
    expect(detail?.volume.skipped_sets).toBe(1);
  });

  it('不存在返回 null', async () => {
    const detail = await getSessionDetail({
      user_id: SINGLE_USER_ID,
      session_id: '00000000-0000-4000-8000-0000000000ff',
    });
    expect(detail).toBeNull();
  });
});

describe('appendToSession', () => {
  it('追加缺失的组后重算 status，写成 complete', async () => {
    const result = await appendToSession({
      user_id: SINGLE_USER_ID,
      session_id: sessionId,
      patch: {
        exercises: [
          {
            raw_name: 'e2e-history-引体向上',
            sets: [{ weight_kg: 70, reps: 8, set_type: 'working', is_inferred: false }],
          },
        ],
        note: '补记',
      },
    });
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('complete');
    if (typeof result === 'string') throw new Error('unreachable');

    expect(result.status).toBe('complete');
    expect(result.missing_fields).toEqual([]);
    // 原来的空次数被补上（null → 8），不是追加一条重复组
    expect(result.exercises[0]?.sets).toHaveLength(1);
    expect(result.exercises[0]?.sets[0]?.reps).toBe(8);
    expect(result.note).toBe('补记');
  });

  it('已完整的记录拒绝追加', async () => {
    const result = await appendToSession({
      user_id: SINGLE_USER_ID,
      session_id: sessionId,
      patch: {
        exercises: [
          {
            raw_name: 'e2e-history-引体向上',
            sets: [{ weight_kg: 70, reps: 5, set_type: 'working', is_inferred: false }],
          },
        ],
      },
    });
    expect(result).toBe('complete');
  });

  it('不存在返回 not_found', async () => {
    const result = await appendToSession({
      user_id: SINGLE_USER_ID,
      session_id: '00000000-0000-4000-8000-0000000000ff',
      patch: {
        exercises: [
          {
            raw_name: 'x',
            sets: [{ weight_kg: 1, reps: 1, set_type: 'working', is_inferred: false }],
          },
        ],
      },
    });
    expect(result).toBe('not_found');
  });
});

describe('updateSession', () => {
  it('按顺序覆盖重量与次数，status / missing_fields 重算', async () => {
    const detail = await updateSession({
      user_id: SINGLE_USER_ID,
      session_id: sessionId,
      patch: {
        exercises: [
          {
            raw_name: 'e2e-history-引体向上',
            sets: [{ weight_kg: 72.5, reps: null }],
          },
        ],
        note: '手动改到 72.5',
      },
    });
    if (detail === 'not_found') throw new Error('session 不见了');

    expect(detail.status).toBe('incomplete');
    expect(detail.missing_fields).toEqual(['reps']);
    expect(detail.exercises[0]?.sets[0]?.weight_kg).toBe(72.5);
    expect(detail.exercises[0]?.sets[0]?.reps).toBeNull();
    expect(detail.note).toBe('手动改到 72.5');
  });

  it('不存在返回 not_found', async () => {
    const detail = await updateSession({
      user_id: SINGLE_USER_ID,
      session_id: '00000000-0000-4000-8000-0000000000ff',
      patch: {
        exercises: [{ raw_name: 'x', sets: [{ weight_kg: 1, reps: 1 }] }],
      },
    });
    expect(detail).toBe('not_found');
  });
});

describe('deleteSession', () => {
  it('删掉训练后详情读不到，再删返回 false', async () => {
    expect(await deleteSession({ user_id: SINGLE_USER_ID, session_id: sessionId })).toBe(true);
    expect(
      await getSessionDetail({ user_id: SINGLE_USER_ID, session_id: sessionId }),
    ).toBeNull();
    expect(await deleteSession({ user_id: SINGLE_USER_ID, session_id: sessionId })).toBe(false);
  });
});

/** 抽屉列表没有 split 过滤 —— 用独立用户隔离 */
const HIST_USER = '00000000-0000-4000-8000-0000000000e4';

describe('listHistory', () => {
  beforeAll(async () => {
    await getDb().insert(user).values({ id: HIST_USER, email: `${HIST_USER}@test.local`, passwordHash: 'scrypt$locked$locked', nickname: '测试' }).onConflictDoNothing();

    await persistWorkout({
      user_id: HIST_USER,
      date: '2031-03-10',
      split_label: '背日',
      status: 'complete',
      missing_fields: [],
      notes: null,
      exercises: [
        {
          order: 0,
          raw_name: '引体向上',
          exercise_id: null,
          name_confidence: 'high',
          region_fallback: 'region_back',
          sets: [
            { order: 0, weight_kg: 50, reps: 10, set_type: 'working', is_inferred: false },
            { order: 1, weight_kg: 50, reps: 10, set_type: 'working', is_inferred: false },
          ],
        },
      ],
    });

    await persistWorkout({
      user_id: HIST_USER,
      date: '2031-03-12',
      split_label: '推日',
      status: 'incomplete',
      missing_fields: ['weight_kg'],
      notes: null,
      exercises: [
        {
          order: 0,
          raw_name: '卧推',
          exercise_id: 'bench_press',
          name_confidence: 'high',
          region_fallback: null,
          sets: [{ order: 0, weight_kg: null, reps: 8, set_type: 'working', is_inferred: false }],
        },
      ],
    });
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM "user" WHERE id = $1', [HIST_USER]);
  });

  it('按日期倒序，带状态、组数、容量与动作名', async () => {
    const items = await listHistory({ user_id: HIST_USER, limit: 10 });
    expect(items.map((i) => i.date)).toEqual(['2031-03-12', '2031-03-10']);

    const [pushed, pull] = items;
    expect(pushed).toMatchObject({
      split_label: '推日',
      status: 'incomplete',
      missing_fields: ['weight_kg'],
      exercise_count: 1,
      working_sets: 0, // 缺重量的组不计入容量
      volume_kg: 0,
      exercise_names: ['卧推'], // 展示按用户原话
    });
    expect(pull).toMatchObject({
      split_label: '背日',
      status: 'complete',
      exercise_count: 1,
      working_sets: 2,
      volume_kg: 1000,
      exercise_names: ['引体向上'],
    });
  });

  it('limit 截断', async () => {
    const items = await listHistory({ user_id: HIST_USER, limit: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]?.date).toBe('2031-03-12');
  });
});