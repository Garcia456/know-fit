import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register } from './auth.js';
import { toLocalDate } from '../extraction/dates.js';
import { getProfile, saveProfile, saveWeight, weightOn } from './profile.js';
import { getPool, closeDb } from './pool.js';

/** 档案读写 —— 连真库；体重历史同一天覆盖，训练年限按月折算。 */

const PREFIX = 'test-profile-';
let userId = '';

beforeAll(async () => {
  // 不复用演示用户 —— 测试会改写档案，不能用 SINGLE_USER_ID
  const result = await register({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '档案测试',
  });
  userId = result.user.id;
});

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE email LIKE $1', [`${PREFIX}%`]);
  await closeDb();
});

describe('saveProfile / getProfile', () => {
  it('写入后回读一致，体重落在 body_metric 当天一行', async () => {
    await saveProfile({
      user_id: userId,
      profile: {
        height_cm: 180,
        weight_kg: 75,
        goal: '增肌+减脂',
        training_years: 1,
        training_months: 0,
      },
    });

    const read = await getProfile(userId);
    expect(read).toMatchObject({
      height_cm: 180,
      weight_kg: 75,
      goal: '增肌+减脂',
      training_years: 1,
      training_months: 0,
    });
    expect(await weightOn(userId, toLocalDate(new Date()))).toBe(75);
  });

  it('同一天再保存体重是覆盖，不是新增', async () => {
    await saveProfile({
      user_id: userId,
      profile: {
        height_cm: 180,
        weight_kg: 76,
        goal: '增肌',
        training_years: 1,
        training_months: 0,
      },
    });

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM body_metric WHERE user_id = $1 AND date = $2',
      [userId, toLocalDate(new Date())],
    );
    expect(rows.rows[0].n).toBe(1);
    expect((await getProfile(userId)).weight_kg).toBe(76);
  });

  it('saveWeight 按日期写入；同一天再记是覆盖', async () => {
    await saveWeight({ user_id: userId, date: '2020-05-01', weight_kg: 71.2 });
    expect(await weightOn(userId, '2020-05-01')).toBe(71.2);

    await saveWeight({ user_id: userId, date: '2020-05-01', weight_kg: 70.8 });
    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM body_metric WHERE user_id = $1 AND date = $2',
      [userId, '2020-05-01'],
    );
    expect(rows.rows[0].n).toBe(1);
    expect(await weightOn(userId, '2020-05-01')).toBe(70.8);
  });

  it('训练年限按自然月增长：1 年 2 个月过 3 个月变 1 年 5 个月', async () => {
    const saved = await saveProfile({
      user_id: userId,
      profile: {
        height_cm: 180,
        weight_kg: null,
        goal: '增肌',
        training_years: 1,
        training_months: 2,
      },
      now: new Date(2026, 0, 15),
    });
    expect(saved).toMatchObject({ training_years: 1, training_months: 2 });

    const later = await getProfile(userId, new Date(2026, 3, 15));
    expect(later).toMatchObject({ training_years: 1, training_months: 5 });
  });

  it('留空可保存，null 原样回读', async () => {
    await saveProfile({
      user_id: userId,
      profile: {
        height_cm: null,
        weight_kg: null,
        goal: null,
        training_years: null,
        training_months: null,
      },
    });

    const read = await getProfile(userId);
    expect(read).toMatchObject({
      height_cm: null,
      goal: null,
      training_years: null,
      training_months: null,
    });
    // 没填体重不写新行，历史仍取最近一条
    expect(read.weight_kg).toBe(76);
  });
});