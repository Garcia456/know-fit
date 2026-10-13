import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from './pool.js';
import { logTurn, loadTrainingBand, persistWorkout } from './record.js';
import { SINGLE_USER_ID } from '../graph/state.js';

/**
 * 落库往返 —— 与图测试相反：这里**必须连真库**。
 *
 * 读回用的是裸 SQL 而不是 ORM：拿同一套映射读回来只能证明「映射自洽」，
 * 证不了「表里真是这么写的」。
 *
 * 前置：pnpm db:up && pnpm db:migrate（check-dev.sh 的顺序保证）。
 * 自清理：写完即删，测试不留痕。
 */

const MARK = 'e2e-roundtrip-标记';
const BAD_MARK = 'e2e-roundtrip-回滚标记';

beforeAll(async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (e) {
    throw new Error(
      `连不上数据库 —— 本测试要真库：pnpm db:up && pnpm db:migrate。原始错误：${(e as Error).message}`,
      { cause: e },
    );
  }
});

afterAll(async () => {
  const db = getPool();
  await db.query("DELETE FROM workout_session WHERE split_label LIKE 'e2e-roundtrip%'");
  await db.query('DELETE FROM conversation_turn WHERE content LIKE $1', ['%e2e-roundtrip%']);
  await closeDb();
});

const INPUT = {
  user_id: SINGLE_USER_ID,
  date: '2026-10-13',
  split_label: MARK,
  status: 'complete' as const,
  missing_fields: [],
  notes: '测完即删',
  exercises: [
    {
      order: 0,
      raw_name: '卧推',
      exercise_id: 'bench_press',
      name_confidence: 'high' as const,
      region_fallback: null,
      sets: [
        { order: 0, weight_kg: 70, reps: 8, set_type: 'working' as const, is_inferred: false },
        { order: 1, weight_kg: 70, reps: 8, set_type: 'working' as const, is_inferred: false },
      ],
    },
    {
      order: 1,
      raw_name: '飞鸟',
      exercise_id: null,
      name_confidence: 'high' as const,
      region_fallback: null,
      sets: [],
    },
  ],
};

describe('persistWorkout：三步落库', () => {
  it('会话 / 动作 / 组都写进去了，且能按裸 SQL 读回来', async () => {
    const { session_id } = await persistWorkout(INPUT);
    const db = getPool();

    const s = await db.query(
      "SELECT user_id, to_char(date, 'YYYY-MM-DD') AS date, status, missing_fields, notes FROM workout_session WHERE id = $1",
      [session_id],
    );
    expect(s.rowCount).toBe(1);
    expect(s.rows[0].user_id).toBe(SINGLE_USER_ID);
    expect(s.rows[0].status).toBe('complete');
    expect(s.rows[0].missing_fields).toEqual([]);
    expect(s.rows[0].notes).toBe('测完即删');
    // 原样读回字符串 —— 日期列经 Date 对象会带上时区偏移，容易差一天
    expect(s.rows[0].date).toBe('2026-10-13');

    const ex = await db.query(
      'SELECT "order", raw_name, exercise_id, region_fallback FROM exercise_entry WHERE session_id = $1 ORDER BY "order"',
      [session_id],
    );
    expect(ex.rowCount).toBe(2);
    expect(ex.rows[0]).toMatchObject({ raw_name: '卧推', exercise_id: 'bench_press' });
    // 歧义动作照写，只是 id 为 null —— null 不是「没写进去」
    expect(ex.rows[1]).toMatchObject({ raw_name: '飞鸟', exercise_id: null });

    const sets = await db.query(
      'SELECT s.weight_kg, s.reps, s.set_type, s.is_inferred FROM set_entry s JOIN exercise_entry e ON e.id = s.exercise_entry_id WHERE e.session_id = $1',
      [session_id],
    );
    expect(sets.rowCount).toBe(2);
    expect(Number(sets.rows[0].weight_kg)).toBe(70);
    expect(sets.rows[0].reps).toBe(8);

    // 零组的动作不写 set_entry（写了就是脏数据）
    const empty = await db.query(
      'SELECT id FROM exercise_entry WHERE session_id = $1 AND raw_name = $2',
      [session_id, '飞鸟'],
    );
    const flySets = await db.query('SELECT id FROM set_entry WHERE exercise_entry_id = $1', [
      empty.rows[0].id,
    ]);
    expect(flySets.rowCount).toBe(0);
  });

  it('中途失败整笔回滚 —— 不留半条记录', async () => {
    const db = getPool();
    const bad = {
      ...INPUT,
      split_label: BAD_MARK, // 自己一个标记，免得把上一条成功的记录认成残留
      exercises: [
        { ...INPUT.exercises[0]!, sets: [{ order: 0, weight_kg: 70, reps: 1.5 /* integer 列收不下 */, set_type: 'working' as const, is_inferred: false }] },
      ],
    };

    await expect(persistWorkout(bad)).rejects.toThrow();

    // 会话行不该留下（它是在失败之前插进去的）
    const left = await db.query('SELECT id FROM workout_session WHERE split_label = $1', [BAD_MARK]);
    expect(left.rowCount).toBe(0);
  });
});

describe('logTurn：轮次留痕', () => {
  it('返回的 id 就是 turn_id，intent 与定位锚都存下来', async () => {
    const { session_id } = await persistWorkout(INPUT);
    const turn_id = await logTurn({
      user_id: SINGLE_USER_ID,
      message: 'e2e-roundtrip 说一句',
      intent: 'record',
      linked_record_id: session_id,
    });
    expect(turn_id).toMatch(/^[0-9a-f-]{36}$/);

    const row = await getPool().query(
      'SELECT role, intent, linked_record_id, content FROM conversation_turn WHERE id = $1',
      [turn_id],
    );
    expect(row.rows[0]).toMatchObject({
      role: 'user',
      intent: 'record',
      linked_record_id: session_id,
    });
    expect(row.rows[0].content).toBe('e2e-roundtrip 说一句');
  });
});

describe('loadTrainingBand：读不到就按 3m_2y 算', () => {
  it('锚点用户档案里是 3m_2y（0002 种的那行）', async () => {
    expect(await loadTrainingBand(SINGLE_USER_ID)).toBe('3m_2y');
  });

  it('不存在的用户 → 兜底 3m_2y（少拦比多拦轻）', async () => {
    expect(await loadTrainingBand('00000000-0000-4000-8000-00000000ffff')).toBe('3m_2y');
  });
});