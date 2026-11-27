import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pendingRecord, recoveryNudge, user, workoutSession } from '../db/schema.js';
import { getDb } from './pool.js';
import { recoveryMetrics } from './recovery-metrics.js';

const FROM = '2032-08-01';
const TO = '2032-08-31';
const IN_WINDOW = new Date('2032-08-10T12:00:00');

describe('recoveryMetrics', () => {
  it('新断点分开算训练恢复与数据解决；legacy 只计数', async () => {
    const [u] = await getDb()
      .insert(user)
      .values({ email: `metrics-${randomUUID()}@test.local`, passwordHash: 'x', nickname: 'metrics' })
      .returning({ id: user.id });
    if (!u) throw new Error('测试用户没建出来');

    try {
      await getDb().insert(pendingRecord).values([
        {
          userId: u.id,
          targetDate: '2032-08-02',
          splitLabel: '胸',
          source: 'mentioned',
          status: 'filled',
          createdAt: IN_WINDOW,
          resolvedAt: IN_WINDOW,
        },
        {
          userId: u.id,
          targetDate: '2032-08-03',
          splitLabel: null,
          source: 'gap',
          status: 'rest',
          createdAt: IN_WINDOW,
          resolvedAt: IN_WINDOW,
        },
        {
          userId: u.id,
          targetDate: '2032-08-04',
          splitLabel: '背',
          source: 'mentioned',
          status: 'dismissed',
          createdAt: IN_WINDOW,
          resolvedAt: IN_WINDOW,
        },
        {
          userId: u.id,
          targetDate: '2032-08-05',
          splitLabel: null,
          source: 'gap',
          status: 'open',
          createdAt: IN_WINDOW,
        },
      ]);

      await getDb().insert(recoveryNudge).values([
        { userId: u.id, type: '补记', targetDate: '2032-08-02', shownAt: IN_WINDOW },
        { userId: u.id, type: '补记', targetDate: '2032-08-03', shownAt: IN_WINDOW },
        { userId: u.id, type: '补全', shownAt: IN_WINDOW },
        { userId: u.id, type: '断流', shownAt: IN_WINDOW },
      ]);

      // 08-05 未 filled，但 08-12 有新训练（距 08-05 第 7 天）→ 算训练恢复
      await getDb().insert(workoutSession).values({
        userId: u.id,
        date: '2032-08-12',
        splitLabel: '腿',
        status: 'complete',
        missingFields: [],
      });

      const out = await recoveryMetrics({ from: FROM, to: TO });

      expect(out.breakpoints).toMatchObject({
        detected: 4,
        prompted: 2,
        training_recovered: 2,
        data_resolved: 2,
        dismissed: 1,
      });
      expect(out.rates).toEqual({ training_recovery: 0.5, data_resolution: 0.5 });
      expect(out.by_source.mentioned.detected).toBe(2);
      expect(out.by_source.gap.detected).toBe(2);
      expect(out.legacy).toMatchObject({
        detected: 2,
        by_type: { 补全: 1, 断流: 1 },
      });
    } finally {
      await getDb().delete(user).where(eq(user.id, u.id));
    }
  });
});
