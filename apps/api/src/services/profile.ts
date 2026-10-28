import { and, desc, eq, lte } from 'drizzle-orm';
import type { Profile, ProfileInput } from '../contracts/sessions.js';
import { bodyMetric, userProfile } from '../db/schema.js';
import { monthsSince, toLocalDate } from '../extraction/dates.js';
import { getDb } from './pool.js';

/**
 * 档案读与写。
 * 体重不存 user_profile —— 唯一真相在 body_metric，读时取最近一行。
 * 训练年限存开始月份，读时按自然月折算。
 */

export async function getProfile(user_id: string, now: Date = new Date()): Promise<Profile> {
  const db = getDb();
  const rows = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, user_id))
    .limit(1);
  const row = rows[0];
  const weight = await latestWeight(user_id);
  const training = experience(row?.trainingStartedOn ?? null, now);

  return {
    height_cm: row?.heightCm ?? null,
    weight_kg: weight?.weight_kg ?? null,
    weight_date: weight?.date ?? null,
    goal: asGoal(row?.goal),
    ...training,
    updated_at: (row?.updatedAt ?? now).toISOString(),
  };
}

/** 开始月份 → 年月；未填原样返回 null。 */
function experience(
  start: string | null,
  now: Date,
): { training_years: number | null; training_months: number | null } {
  if (!start) return { training_years: null, training_months: null };
  const total = monthsSince(start, now);
  return { training_years: Math.floor(total / 12), training_months: total % 12 };
}

/** 年月 → 开始月份（当月 1 日）；用于保存时重锚。 */
function startMonth(training_years: number, training_months: number, now: Date): string {
  return toLocalDate(new Date(now.getFullYear(), now.getMonth() - training_years * 12 - training_months, 1));
}

async function latestWeight(user_id: string): Promise<{ weight_kg: number; date: string } | null> {
  const rows = await getDb()
    .select({ weightKg: bodyMetric.weightKg, date: bodyMetric.date })
    .from(bodyMetric)
    .where(eq(bodyMetric.userId, user_id))
    .orderBy(desc(bodyMetric.date))
    .limit(1);
  const row = rows[0];
  return row ? { weight_kg: row.weightKg, date: row.date } : null;
}

/** 落库是 text —— 读出来只认契约里的枚举，别的当没填。 */
function asGoal(v: string | null | undefined): Profile['goal'] {
  return v === '增肌' || v === '减脂' || v === '维持' || v === '增肌+减脂' ? v : null;
}

/** 留空也允许保存：null 表示「没填」，不表示「清空历史」。 */
export async function saveProfile(input: {
  user_id: string;
  profile: ProfileInput;
  now?: Date;
}): Promise<Profile> {
  const db = getDb();
  const now = input.now ?? new Date();
  const trainingStartedOn =
    input.profile.training_years === null || input.profile.training_months === null
      ? null
      : startMonth(input.profile.training_years, input.profile.training_months, now);

  await db.transaction(async (tx) => {
    await tx
      .insert(userProfile)
      .values({
        userId: input.user_id,
        heightCm: input.profile.height_cm,
        goal: input.profile.goal,
        trainingStartedOn,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: {
          heightCm: input.profile.height_cm,
          goal: input.profile.goal,
          trainingStartedOn,
          updatedAt: now,
        },
      });

    // 同一天覆盖，跨天保留 —— 体重历史是数据页与后续评估的底料
    if (input.profile.weight_kg !== null) {
      const date = toLocalDate(now);
      await tx
        .insert(bodyMetric)
        .values({ userId: input.user_id, date, weightKg: input.profile.weight_kg })
        .onConflictDoUpdate({
          target: [bodyMetric.userId, bodyMetric.date],
          set: { weightKg: input.profile.weight_kg },
        });
    }
  });

  return getProfile(input.user_id, now);
}

/** 某天的体重 —— 数据页以后要用；没有当天记录就返回 null，不拿最近值冒充。 */
export async function weightOn(user_id: string, date: string): Promise<number | null> {
  const rows = await getDb()
    .select({ weightKg: bodyMetric.weightKg })
    .from(bodyMetric)
    .where(and(eq(bodyMetric.userId, user_id), eq(bodyMetric.date, date)))
    .limit(1);
  return rows[0]?.weightKg ?? null;
}

/**
 * 算自重动作容量用的体重：训练日当天或之前最近一次记录。
 * 没有体重记录时返回 null —— 不拿「之后的体重」倒推历史。
 */
export async function bodyweightOn(user_id: string, date: string): Promise<number | null> {
  const rows = await getDb()
    .select({ weightKg: bodyMetric.weightKg })
    .from(bodyMetric)
    .where(and(eq(bodyMetric.userId, user_id), lte(bodyMetric.date, date)))
    .orderBy(desc(bodyMetric.date))
    .limit(1);
  return rows[0]?.weightKg ?? null;
}