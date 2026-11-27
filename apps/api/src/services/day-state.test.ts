import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gte, lte } from 'drizzle-orm';
import { dayStatus, workoutSession } from '../db/schema.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import type { PersistWorkoutInput } from '../graph/deps.js';
import {
  clearDayStatus,
  deriveDayState,
  getDayStatus,
  listDayStates,
  markRest,
  markUnlogged,
} from './day-state.js';
import { getDb } from './pool.js';
import { persistWorkout } from './record.js';

const FROM = '2032-05-01';
const TO = '2032-05-10';

function workout(date: string): PersistWorkoutInput {
  return {
    user_id: SINGLE_USER_ID,
    date,
    split_label: 'e2e-daystate-背',
    status: 'complete',
    missing_fields: [],
    notes: null,
    exercises: [
      {
        order: 0,
        raw_name: 'e2e-daystate-引体向上',
        exercise_id: null,
        name_confidence: 'low',
        region_fallback: 'region_back',
        sets: [{ order: 0, weight_kg: 70, reps: 8, set_type: 'working', is_inferred: false }],
      },
    ],
  };
}

beforeAll(async () => {
  await persistWorkout(workout('2032-05-02'));
});

afterAll(async () => {
  const db = getDb();
  await db
    .delete(dayStatus)
    .where(
      and(
        eq(dayStatus.userId, SINGLE_USER_ID),
        gte(dayStatus.date, FROM),
        lte(dayStatus.date, TO),
      ),
    );
  await db
    .delete(workoutSession)
    .where(
      and(
        eq(workoutSession.userId, SINGLE_USER_ID),
        gte(workoutSession.date, FROM),
        lte(workoutSession.date, TO),
      ),
    );
});

describe('deriveDayState', () => {
  it('训练优先', () => {
    expect(deriveDayState({ hasSession: true, status: 'rest' })).toBe('trained');
  });

  it('没有训练时按标记；都没有是 unknown', () => {
    expect(deriveDayState({ hasSession: false, status: 'rest' })).toBe('rest');
    expect(deriveDayState({ hasSession: false, status: 'unlogged' })).toBe('unlogged');
    expect(deriveDayState({ hasSession: false, status: null })).toBe('unknown');
  });
});

describe('day-state 服务', () => {
  it('markRest 跳过有训练的日期，其余照写', async () => {
    const out = await markRest({
      user_id: SINGLE_USER_ID,
      dates: ['2032-05-02', '2032-05-03'],
    });
    expect(out.written).toEqual(['2032-05-03']);
    expect(out.conflicts).toEqual(['2032-05-02']);

    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-02')).toBe('trained');
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-03')).toBe('rest');
  });

  it('listDayStates 同时返回训练与标记，训练覆盖标记', async () => {
    const map = await listDayStates({ user_id: SINGLE_USER_ID, from: FROM, to: TO });
    expect(map.get('2032-05-02')?.state).toBe('trained');
    expect(map.get('2032-05-03')?.state).toBe('rest');
  });

  it('markUnlogged 不覆盖已有训练', async () => {
    expect((await markUnlogged({ user_id: SINGLE_USER_ID, date: '2032-05-02' })).written).toBe(false);
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-02')).toBe('trained');

    expect((await markUnlogged({ user_id: SINGLE_USER_ID, date: '2032-05-04' })).written).toBe(true);
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-04')).toBe('unlogged');
  });

  it('训练落库后同日的休息 / 漏记标记被清掉', async () => {
    await persistWorkout(workout('2032-05-04'));
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-04')).toBe('trained');

    const rows = await getDb()
      .select({ id: dayStatus.id })
      .from(dayStatus)
      .where(and(gte(dayStatus.date, '2032-05-04'), lte(dayStatus.date, '2032-05-04')));
    expect(rows).toHaveLength(0);
  });

  it('clearDayStatus 回到 unknown，不动训练', async () => {
    await clearDayStatus(SINGLE_USER_ID, '2032-05-03');
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-03')).toBe('unknown');
    expect(await getDayStatus(SINGLE_USER_ID, '2032-05-02')).toBe('trained');
  });
});
