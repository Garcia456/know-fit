import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteAccount, register } from './auth.js';
import { clearTrainingRecords } from './account.js';
import { closeDb, getPool } from './pool.js';

/**
 * 清空训练记录 / 注销 —— 连真库。
 * 关键断言：训练相关清空，但档案与体重历史保留；注销后 user 行与所有数据一起消失。
 */

const PREFIX = 'test-account-';
let userId = '';
let sessionId = '';

beforeAll(async () => {
  const result = await register({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '清空测试',
  });
  userId = result.user.id;

  const pool = getPool();
  await pool.query(
    `INSERT INTO user_profile (user_id, height_cm, goal) VALUES ($1, 178, '增肌')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO body_metric (user_id, date, weight_kg) VALUES ($1, CURRENT_DATE, 72.5)`,
    [userId],
  );
  const session = await pool.query(
    `INSERT INTO workout_session (user_id, date, split_label, status)
     VALUES ($1, CURRENT_DATE, '背日', 'complete') RETURNING id`,
    [userId],
  );
  sessionId = session.rows[0].id;
  await pool.query(
    `INSERT INTO exercise_entry (session_id, "order", raw_name) VALUES ($1, 0, '引体向上')`,
    [sessionId],
  );
  await pool.query(
    `INSERT INTO conversation_turn (user_id, role, content) VALUES ($1, 'user', '今天练背')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO recovery_nudge (user_id, session_id, type) VALUES ($1, $2, '补全')`,
    [userId, session.rows[0].id],
  );
  await pool.query(
    `INSERT INTO assessment
       (user_id, trigger, verdict_json, advice_text, advice_claims, has_source,
        model_version, judge_model_version, pipeline_meta)
     VALUES ($1, 'explicit', '{}', '测试建议', '[]', false, 'test', 'test', '{}')`,
    [userId],
  );
});

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE email LIKE $1', [`${PREFIX}%`]);
  await closeDb();
});

describe('清空训练记录', () => {
  it('删训练 / 动作 / 对话 / 评估 / 提示，保留档案与体重历史', async () => {
    const cleared = await clearTrainingRecords(userId);
    expect(cleared.sessions).toBe(1);
    expect(cleared.assessments).toBe(1);
    expect(cleared.turns).toBe(1);
    expect(cleared.nudges).toBe(1);

    const pool = getPool();
    for (const table of ['workout_session', 'conversation_turn', 'assessment', 'recovery_nudge']) {
      const rows = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [userId]);
      expect(rows.rows[0].n, `${table} 应已清空`).toBe(0);
    }
    const entries = await pool.query('SELECT count(*)::int AS n FROM exercise_entry WHERE session_id = $1', [
      sessionId,
    ]);
    expect(entries.rows[0].n, 'exercise_entry 应已清空').toBe(0);

    const profile = await pool.query('SELECT height_cm FROM user_profile WHERE user_id = $1', [userId]);
    expect(profile.rowCount).toBe(1);
    const weight = await pool.query('SELECT weight_kg FROM body_metric WHERE user_id = $1', [userId]);
    expect(weight.rowCount).toBe(1);
  });
});

describe('注销账号', () => {
  it('删除 user 行后，账号与所有数据一起消失', async () => {
    await deleteAccount(userId);
    const pool = getPool();
    expect((await pool.query('SELECT 1 FROM "user" WHERE id = $1', [userId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM user_profile WHERE user_id = $1', [userId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM body_metric WHERE user_id = $1', [userId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM auth_session WHERE user_id = $1', [userId])).rowCount).toBe(0);
  });
});