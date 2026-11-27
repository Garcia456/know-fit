import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, gte, lte } from 'drizzle-orm';
import { dayStatus, pendingRecord, workoutSession } from '../db/schema.js';
import { bindPendingDate } from '../extraction/pending.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import type { PersistWorkoutInput } from '../graph/deps.js';
import {
  getPendingByDate,
  markFilledForDate,
  nextPending,
  pendingContextForExtraction,
  rememberGap,
  rememberMention,
  resolveDismissed,
  resolveRest,
} from './pending-record.js';
import { getDb } from './pool.js';
import { persistWorkout } from './record.js';

const FROM = '2032-06-01';
const TO = '2032-06-10';
const NOW = new Date('2032-06-10T09:00:00');

function workout(date: string): PersistWorkoutInput {
  return {
    user_id: SINGLE_USER_ID,
    date,
    split_label: 'e2e-pending-背',
    status: 'complete',
    missing_fields: [],
    notes: null,
    exercises: [
      {
        order: 0,
        raw_name: 'e2e-pending-引体向上',
        exercise_id: null,
        name_confidence: 'low',
        region_fallback: 'region_back',
        sets: [{ order: 0, weight_kg: 70, reps: 8, set_type: 'working', is_inferred: false }],
      },
    ],
  };
}

afterAll(async () => {
  const db = getDb();
  await db
    .delete(pendingRecord)
    .where(
      and(
        eq(pendingRecord.userId, SINGLE_USER_ID),
        gte(pendingRecord.targetDate, FROM),
        lte(pendingRecord.targetDate, TO),
      ),
    );
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

describe('bindPendingDate', () => {
  const pending = { id: 'p1', target_date: '2032-06-09', split_label: '胸' };

  it('有明确日期就不绑', () => {
    expect(
      bindPendingDate({
        dayHint: '今天',
        extractedSplit: '胸',
        pending,
        now: NOW,
      }),
    ).toEqual({ date: '2032-06-10', split_label: '胸', bound: false });
  });

  it('无日期 + 部位相同 → 绑到 pending', () => {
    expect(
      bindPendingDate({
        dayHint: null,
        extractedSplit: '胸',
        pending,
        now: NOW,
      }),
    ).toEqual({ date: '2032-06-09', split_label: '胸', bound: true });
  });

  it('无日期 + 部位不同 → 不绑，落今天', () => {
    expect(
      bindPendingDate({
        dayHint: null,
        extractedSplit: '背',
        pending,
        now: NOW,
      }),
    ).toEqual({ date: '2032-06-10', split_label: '背', bound: false });
  });

  it('没有 pending → 正常兜底', () => {
    expect(
      bindPendingDate({
        dayHint: null,
        extractedSplit: null,
        pending: null,
        now: NOW,
      }),
    ).toEqual({ date: '2032-06-10', split_label: null, bound: false });
  });
});

describe('pending-record 服务', () => {
  it('提及建槽；重复提及升级部位但不新增行', async () => {
    const first = await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-06-02',
      split_label: '胸',
    });
    expect(first).toMatchObject({ source: 'mentioned', status: 'open', split_label: '胸' });

    const second = await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-06-02',
      split_label: '背',
    });
    expect(second.id).toBe(first.id);
    expect(second.split_label).toBe('背');

    const rows = await getDb()
      .select({ id: pendingRecord.id })
      .from(pendingRecord)
      .where(
        and(
          eq(pendingRecord.userId, SINGLE_USER_ID),
          eq(pendingRecord.targetDate, '2032-06-02'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('gap 不覆盖已有 open 槽', async () => {
    const gap = await rememberGap({ user_id: SINGLE_USER_ID, target_date: '2032-06-02' });
    expect(gap?.id).not.toBeNull();
    expect(gap?.source).toBe('mentioned');
  });

  it('nextPending 只看 3 天窗口内的 open 槽', async () => {
    const hit = await nextPending({
      user_id: SINGLE_USER_ID,
      before_date: '2032-06-05',
    });
    expect(hit?.target_date).toBe('2032-06-02');

    const expired = await nextPending({
      user_id: SINGLE_USER_ID,
      before_date: '2032-06-10',
      max_age_days: 3,
    });
    expect(expired).toBeNull();
  });

  it('图前上下文包含今天', async () => {
    const context = await pendingContextForExtraction({
      user_id: SINGLE_USER_ID,
      today: '2032-06-02',
    });
    expect(context?.target_date).toBe('2032-06-02');
  });

  it('忽略后不再提示；再次提及会重新打开', async () => {
    const pending = await getPendingByDate({ user_id: SINGLE_USER_ID, date: '2032-06-02' });
    if (!pending) throw new Error('缺少测试槽');

    expect(await resolveDismissed({ user_id: SINGLE_USER_ID, id: pending.id })).toBe(true);
    expect(await rememberGap({ user_id: SINGLE_USER_ID, target_date: '2032-06-02' })).toBeNull();

    const reopened = await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-06-02',
      split_label: '胸',
    });
    expect(reopened.status).toBe('open');
  });

  it('休息解决同时写 day_status', async () => {
    const pending = await getPendingByDate({ user_id: SINGLE_USER_ID, date: '2032-06-02' });
    if (!pending) throw new Error('缺少测试槽');

    expect(await resolveRest({ user_id: SINGLE_USER_ID, id: pending.id })).toBe(true);
    expect((await getPendingByDate({ user_id: SINGLE_USER_ID, date: '2032-06-02' }))?.status).toBe('rest');

    const marks = await getDb()
      .select({ status: dayStatus.status })
      .from(dayStatus)
      .where(and(eq(dayStatus.userId, SINGLE_USER_ID), eq(dayStatus.date, '2032-06-02')));
    expect(marks[0]?.status).toBe('rest');
  });

  it('训练落库后 pending 自动 filled', async () => {
    await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-06-03',
      split_label: '腿',
    });
    const { session_id } = await persistWorkout(workout('2032-06-03'));

    const pending = await getPendingByDate({ user_id: SINGLE_USER_ID, date: '2032-06-03' });
    expect(pending?.status).toBe('filled');
    expect(pending?.session_id).toBe(session_id);
  });

  it('markFilledForDate 收敛 dismissed 槽', async () => {
    const pending = await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-06-04',
      split_label: '胸',
    });
    await resolveDismissed({ user_id: SINGLE_USER_ID, id: pending.id });
    const { session_id } = await persistWorkout(workout('2032-06-04'));
    await markFilledForDate({
      user_id: SINGLE_USER_ID,
      date: '2032-06-04',
      session_id,
    });
    expect((await getPendingByDate({ user_id: SINGLE_USER_ID, date: '2032-06-04' }))?.status).toBe('filled');
  });
});
