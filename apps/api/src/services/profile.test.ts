import { afterAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '../graph/state.js';
import { toLocalDate } from '../extraction/dates.js';
import { getProfile, saveProfile, weightOn } from './profile.js';
import { getPool, closeDb } from './pool.js';

/** 档案读写 —— 连真库；体重历史同一天覆盖，训练年限按月折算。 */

afterAll(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM body_metric WHERE user_id = $1', [SINGLE_USER_ID]);
  await pool.query(
    `UPDATE user_profile SET height_cm = NULL, goal = NULL, training_started_on = NULL
      WHERE user_id = $1`,
    [SINGLE_USER_ID],
  );
  await closeDb();
});

describe('saveProfile / getProfile', () => {
  it('写入后回读一致，体重落在 body_metric 当天一行', async () => {
    await saveProfile({
      user_id: SINGLE_USER_ID,
      profile: {
        height_cm: 180,
        weight_kg: 75,
        goal: '增肌+减脂',
        training_years: 1,
        training_months: 0,
      },
    });

    const read = await getProfile(SINGLE_USER_ID);
    expect(read).toMatchObject({
      height_cm: 180,
      weight_kg: 75,
      goal: '增肌+减脂',
      training_years: 1,
      training_months: 0,
    });
    expect(await weightOn(SINGLE_USER_ID, toLocalDate(new Date()))).toBe(75);
  });

  it('同一天再保存体重是覆盖，不是新增', async () => {
    await saveProfile({
      user_id: SINGLE_USER_ID,
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
      [SINGLE_USER_ID, toLocalDate(new Date())],
    );
    expect(rows.rows[0].n).toBe(1);
    expect((await getProfile(SINGLE_USER_ID)).weight_kg).toBe(76);
  });

  it('训练年限按自然月增长：1 年 2 个月过 3 个月变 1 年 5 个月', async () => {
    const saved = await saveProfile({
      user_id: SINGLE_USER_ID,
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

    const later = await getProfile(SINGLE_USER_ID, new Date(2026, 3, 15));
    expect(later).toMatchObject({ training_years: 1, training_months: 5 });
  });

  it('留空可保存，null 原样回读', async () => {
    await saveProfile({
      user_id: SINGLE_USER_ID,
      profile: {
        height_cm: null,
        weight_kg: null,
        goal: null,
        training_years: null,
        training_months: null,
      },
    });

    const read = await getProfile(SINGLE_USER_ID);
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