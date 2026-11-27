import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, gte, lte } from 'drizzle-orm';
import { dayStatus, pendingRecord, recoveryNudge, workoutSession } from '../db/schema.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { applyBackfillAction, backfillFor } from './backfill.js';
import { markRest } from './day-state.js';
import { rememberMention } from './pending-record.js';
import { getDb } from './pool.js';

const FROM = '2032-07-01';
const TO = '2032-07-31';

async function clean(): Promise<void> {
  const db = getDb();
  await db
    .delete(recoveryNudge)
    .where(
      and(
        eq(recoveryNudge.userId, SINGLE_USER_ID),
        gte(recoveryNudge.targetDate, FROM),
        lte(recoveryNudge.targetDate, TO),
      ),
    );
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
}

beforeEach(clean);
afterAll(async () => {
  await clean();
});

describe('backfillFor', () => {
  it('昨天空白 → 建 gap 槽并给提示；同一天不重复', async () => {
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    expect(prompt).toMatchObject({
      target_date: '2032-07-09',
      source: 'gap',
      message_code: 'gap',
      split_label: null,
    });

    const again = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    expect(again).toBeNull();
  });

  it('用户提过昨天练胸 → 提示带部位', async () => {
    await rememberMention({
      user_id: SINGLE_USER_ID,
      target_date: '2032-07-09',
      split_label: '胸',
    });
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    expect(prompt).toMatchObject({
      target_date: '2032-07-09',
      source: 'mentioned',
      split_label: '胸',
    });
  });

  it('昨天已标休息 → 不提示', async () => {
    await markRest({ user_id: SINGLE_USER_ID, dates: ['2032-07-09'] });
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    expect(prompt).toBeNull();
  });

  it('记录的不是今天 → 不提示', async () => {
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-08',
      today: '2032-07-10',
    });
    expect(prompt).toBeNull();
  });
});

describe('applyBackfillAction', () => {
  it('补记只返回 prefill，pending 保持 open', async () => {
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    if (!prompt) throw new Error('缺少提示');

    const result = await applyBackfillAction({
      user_id: SINGLE_USER_ID,
      nudge_id: prompt.nudge_id,
      action: '补记',
    });
    expect(result).toMatchObject({
      ok: true,
      prefill: { target_date: '2032-07-09', split_label: null },
    });

    const marks = await getDb()
      .select({ status: dayStatus.status })
      .from(dayStatus)
      .where(and(eq(dayStatus.userId, SINGLE_USER_ID), eq(dayStatus.date, '2032-07-09')));
    expect(marks[0]?.status).toBe('unlogged');
  });

  it('休息 → pending rest + day_status rest', async () => {
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    if (!prompt) throw new Error('缺少提示');

    const result = await applyBackfillAction({
      user_id: SINGLE_USER_ID,
      nudge_id: prompt.nudge_id,
      action: '休息',
    });
    expect(result).toEqual({ ok: true });

    const marks = await getDb()
      .select({ status: dayStatus.status })
      .from(dayStatus)
      .where(and(eq(dayStatus.userId, SINGLE_USER_ID), eq(dayStatus.date, '2032-07-09')));
    expect(marks[0]?.status).toBe('rest');
  });

  it('忽略 → pending dismissed；之后 gap 不再建槽', async () => {
    const prompt = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    if (!prompt) throw new Error('缺少提示');

    const result = await applyBackfillAction({
      user_id: SINGLE_USER_ID,
      nudge_id: prompt.nudge_id,
      action: '忽略',
    });
    expect(result).toEqual({ ok: true });

    const again = await backfillFor({
      user_id: SINGLE_USER_ID,
      session_date: '2032-07-10',
      today: '2032-07-10',
    });
    expect(again).toBeNull();
  });

  it('不存在的提示 → null', async () => {
    const result = await applyBackfillAction({
      user_id: SINGLE_USER_ID,
      nudge_id: '00000000-0000-4000-8000-000000009999',
      action: '补记',
    });
    expect(result).toBeNull();
  });
});
