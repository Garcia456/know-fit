#!/usr/bin/env node
/**
 * dev-007 端到端：读聚合 / 范围统计 / 历史 / 评估缺失 / 窄修正
 *
 * 走 HTTP（vite 代理 → api），再用裸 SQL 断言落库与收尾：
 *   A. GET /api/metrics/weekly → 4 周、本周含测试记录、对外无全文键
 *   B. GET /api/metrics/weight → 多点折线、最新值与差值
 *   B2. GET /api/stats → 范围逐日容量 / 肌群量 / 体重；拒绝非法范围
 *   C. GET /api/history → 记录级字段（动作数 / 组数 / 容量 / 状态 / 动作名）
 *   D. POST /api/assessments → 空记录返回 insufficient 与 missing
 *   E. POST /api/turns → 「刚才…不是…」走确定性修正，只改重量并重算容量
 *
 * 自清理：测试 session（级联动作与组）、体重行、修正轮次全部删除 / 还原。
 *
 * 用法： node scripts/e2e-dev007.mjs      （先起 pnpm dev）
 * 退出码：0 = 通过；1 = 失败
 */
import pg from 'pg';
import { loginDemo } from './lib/login.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const USER = '00000000-0000-4000-8000-000000000001';
const FORBIDDEN_KEYS = new Set(['text', 'content', 'transcript', 'transcript_segments']);

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = 1;
};

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoLocal(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hasForbiddenKey(value, path = '$') {
  if (Array.isArray(value)) {
    return value.some((v, i) => hasForbiddenKey(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) return `${path}.${k}`;
      const hit = hasForbiddenKey(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

let cookie = '';

async function call(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
      cookie,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  cookie = await loginDemo(BASE);
} catch (e) {
  console.error(`  \x1b[31m✗\x1b[0m ${e.message}`);
  process.exit(1);
}
const today = todayLocal();
const oldDate = daysAgoLocal(10);
const correctionDate = '2099-01-05';
let sessionToday = null;
let sessionEmpty = null;
let sessionCorrection = null;
let metricTodayBefore = null;
let metricOldBefore = null;
let correctionTurnId = null;
const straySessionIds = [];

try {
  await client.connect();
} catch (e) {
  console.error(`  \x1b[31m✗\x1b[0m 连不上数据库：${e.message}`);
  process.exit(1);
}

async function insertExercise(sessionId, rawName, sets) {
  // exercise_id 必须给，否则肌群量恒为 0（由 seed 里的 id 决定，不靠 raw_name 反查）
  const entry = await client.query(
    `INSERT INTO exercise_entry (session_id, "order", raw_name, exercise_id, name_confidence)
     VALUES ($1, 0, $2, 'bench_press', 'high') RETURNING id`,
    [sessionId, rawName],
  );
  const entryId = entry.rows[0].id;
  for (const [i, s] of sets.entries()) {
    await client.query(
      `INSERT INTO set_entry (exercise_entry_id, "order", weight_kg, reps, set_type, is_inferred)
       VALUES ($1, $2, $3, $4, 'working', false)`,
      [entryId, i, s.weight, s.reps],
    );
  }
}

console.log('\n=== dev-007 端到端 ===\n');

try {
  // 留底，收尾时原样还原
  metricTodayBefore = (
    await client.query('SELECT weight_kg, body_fat_pct FROM body_metric WHERE user_id = $1 AND date = $2', [
      USER,
      today,
    ])
  ).rows[0];
  metricOldBefore = (
    await client.query('SELECT weight_kg, body_fat_pct FROM body_metric WHERE user_id = $1 AND date = $2', [
      USER,
      oldDate,
    ])
  ).rows[0];

  // 测试记录 1：今天的完整训练（2 组 70kg × 8 → 1,120 kg）
  sessionToday = (
    await client.query(
      `INSERT INTO workout_session (user_id, date, split_label, status, missing_fields)
       VALUES ($1, $2, 'e2e-dev007-推日', 'complete', ARRAY[]::text[]) RETURNING id`,
      [USER, today],
    )
  ).rows[0].id;
  await insertExercise(sessionToday, '卧推', [
    { weight: 70, reps: 8 },
    { weight: 70, reps: 8 },
  ]);

  // 测试记录 2：空记录（无正式组、无 split）→ 评估应报数据不足
  sessionEmpty = (
    await client.query(
      `INSERT INTO workout_session (user_id, date, split_label, status, missing_fields, created_at)
       VALUES ($1, $2, NULL, 'incomplete', ARRAY['reps'], now() - interval '1 minute')
       RETURNING id`,
      [USER, today],
    )
  ).rows[0].id;

  // 测试记录 3：日期放在最未来，保证窄修正只可能命中它
  sessionCorrection = (
    await client.query(
      `INSERT INTO workout_session (user_id, date, split_label, status, missing_fields)
       VALUES ($1, $2, 'e2e-dev007-修正日', 'complete', ARRAY[]::text[]) RETURNING id`,
      [USER, correctionDate],
    )
  ).rows[0].id;
  await insertExercise(sessionCorrection, '卧推', [
    { weight: 70, reps: 8 },
    { weight: 70, reps: 8 },
  ]);

  // 体重两点：今天 80、10 天前 81
  await client.query(
    `INSERT INTO body_metric (user_id, date, weight_kg) VALUES ($1, $2, 81)
     ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = 81`,
    [USER, oldDate],
  );
  await client.query(
    `INSERT INTO body_metric (user_id, date, weight_kg) VALUES ($1, $2, 80)
     ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = 80`,
    [USER, today],
  );

  // A. 周容量
  const weekly = await call('/metrics/weekly?weeks=4');
  const lastWeek = weekly.body?.weeks?.at(-1);
  if (
    weekly.status === 200 &&
    weekly.body.weeks.length === 4 &&
    lastWeek.total_volume_kg >= 1120 &&
    typeof weekly.body.this_week_kg === 'number'
  ) {
    ok('GET /api/metrics/weekly 返回 4 周，本周含测试训练');
  } else {
    bad(`周容量不对：${JSON.stringify(weekly.body)}`);
  }
  const weeklyLeak = hasForbiddenKey(weekly.body);
  if (!weeklyLeak) ok('周容量响应无全文键（R-C 字段名检查）');
  else bad(`周容量响应泄漏字段：${weeklyLeak}`);

  // B. 体重历史
  const weight = await call('/metrics/weight?weeks=8');
  const points = weight.body?.points ?? [];
  const latest = weight.body?.latest;
  const first = points[0];
  const expectedDelta = latest && first ? latest.weight_kg - first.weight_kg : null;
  if (
    weight.status === 200 &&
    points.length >= 2 &&
    latest?.weight_kg === 80 &&
    points.some((p) => p.date === oldDate && p.weight_kg === 81) &&
    expectedDelta !== null &&
    Math.abs(weight.body.delta_kg - expectedDelta) < 0.011
  ) {
    ok('GET /api/metrics/weight 返回多点、最新值与差值');
  } else {
    bad(`体重历史不对：${JSON.stringify(weight.body)}`);
  }
  const weightLeak = hasForbiddenKey(weight.body);
  if (!weightLeak) ok('体重响应无全文键');
  else bad(`体重响应泄漏字段：${weightLeak}`);

  // B2. 范围统计（统计页）
  const stats = await call(`/stats?from=${oldDate}&to=${today}`);
  const statsToday = stats.body?.days?.find((d) => d.date === today);
  const statsWeightLast = stats.body?.weight_points?.at(-1);
  const statsWeightFirst = stats.body?.weight_points?.[0];
  const statsDelta =
    statsWeightLast && statsWeightFirst ? statsWeightLast.weight_kg - statsWeightFirst.weight_kg : null;
  if (
    stats.status === 200 &&
    stats.body.from === oldDate &&
    stats.body.to === today &&
    statsToday?.total_volume_kg >= 1120 &&
    statsToday?.working_sets >= 2 &&
    stats.body.training_days >= 1 &&
    stats.body.total_volume_kg >= 1120 &&
    stats.body.by_muscle?.chest >= 1120 &&
    statsWeightLast?.weight_kg === 80 &&
    statsDelta !== null &&
    Math.abs(stats.body.weight_delta_kg - statsDelta) < 0.011
  ) {
    ok('GET /api/stats 按范围返回逐日容量 / 肌群量 / 体重');
  } else {
    bad(`范围统计不对：${JSON.stringify(stats.body)}`);
  }
  const statsLeak = hasForbiddenKey(stats.body);
  if (!statsLeak) ok('范围统计响应无全文键（R-C 字段名检查）');
  else bad(`范围统计响应泄漏字段：${statsLeak}`);

  const reversed = await call(`/stats?from=${today}&to=${oldDate}`);
  const tooLong = await call(`/stats?from=2000-01-01&to=${today}`);
  const missingRange = await call('/stats');
  if (
    reversed.status === 400 &&
    tooLong.status === 400 &&
    missingRange.status === 400
  ) {
    ok('GET /api/stats 拒绝倒置 / 超 366 天 / 缺参数');
  } else {
    bad(
      `范围校验不对：${JSON.stringify({
        reversed: reversed.status,
        tooLong: tooLong.status,
        missingRange: missingRange.status,
      })}`,
    );
  }

  // C. 记录级历史
  const history = await call('/history?limit=20');
  const mine = history.body?.items?.find((i) => i.session_id === sessionToday);
  const empty = history.body?.items?.find((i) => i.session_id === sessionEmpty);
  if (
    history.status === 200 &&
    mine?.exercise_count === 1 &&
    mine?.working_sets === 2 &&
    mine?.volume_kg === 1120 &&
    mine?.exercise_names?.includes('卧推') &&
    empty?.status === 'incomplete' &&
    empty?.missing_fields?.includes('reps')
  ) {
    ok('GET /api/history 返回动作数 / 组数 / 容量 / 状态 / 动作名');
  } else {
    bad(`历史列表不对：${JSON.stringify({ mine, empty })}`);
  }
  const historyLeak = hasForbiddenKey(history.body);
  if (!historyLeak) ok('历史响应无全文键');
  else bad(`历史响应泄漏字段：${historyLeak}`);

  // D. 评估：空记录 → 数据不足，说清缺什么
  const assessment = await call('/assessments', {
    method: 'POST',
    body: JSON.stringify({ related_record_id: sessionEmpty, trigger: 'explicit' }),
  });
  const missing = assessment.body?.missing ?? [];
  if (
    assessment.status === 200 &&
    assessment.body.lookup_status === 'insufficient' &&
    missing.includes('sets') &&
    missing.includes('split_label')
  ) {
    ok('POST /api/assessments 空记录返回 insufficient 与 missing');
  } else {
    bad(`评估缺失字段不对：${JSON.stringify(assessment.body)}`);
  }
  const assessmentLeak = hasForbiddenKey(assessment.body);
  if (!assessmentLeak) ok('评估响应无全文键');
  else bad(`评估响应泄漏字段：${assessmentLeak}`);

  // E. 窄修正：只改最近一条（2099）的重量 70 → 75
  const turn = await call('/turns', {
    method: 'POST',
    body: JSON.stringify({ message: '刚才 75kg 不是 70' }),
  });
  correctionTurnId = turn.body?.turn_id ?? null;
  const card = turn.body?.card;
  if (card?.kind !== 'correction' && card?.session_id) straySessionIds.push(card.session_id);
  if (
    turn.status === 200 &&
    card?.kind === 'correction' &&
    card.session_id === sessionCorrection &&
    card.old_weight_kg === 70 &&
    card.new_weight_kg === 75 &&
    card.corrected_sets === 2 &&
    card.volume_kg === 1200
  ) {
    ok('POST /api/turns 走确定性修正：旧 70 → 新 75，容量重算 1,200 kg');
  } else {
    bad(`修正卡不对：${JSON.stringify(turn.body)}`);
  }

  const stored = await client.query(
    `SELECT s.weight_kg FROM set_entry s
       JOIN exercise_entry e ON e.id = s.exercise_entry_id
      WHERE e.session_id = $1 ORDER BY s."order"`,
    [sessionCorrection],
  );
  if (stored.rowCount === 2 && stored.rows.every((r) => r.weight_kg === 75)) {
    ok('修正落库：两组重量都为 75');
  } else {
    bad(`修正未落库：${JSON.stringify(stored.rows)}`);
  }

  // 零命中时不猜、不动数据
  const noMatch = await call('/turns', {
    method: 'POST',
    body: JSON.stringify({ message: '刚才 95kg 不是 99' }),
  });
  const noMatchTurnId = noMatch.body?.turn_id ?? null;
  const noMatchCard = noMatch.body?.card;
  if (noMatchCard?.kind !== 'chat' && noMatchCard?.session_id) {
    straySessionIds.push(noMatchCard.session_id);
  }
  const still = await client.query(
    'SELECT count(*)::int AS n FROM set_entry WHERE exercise_entry_id IN (SELECT id FROM exercise_entry WHERE session_id = $1) AND weight_kg = 75',
    [sessionCorrection],
  );
  if (
    noMatch.status === 200 &&
    noMatch.body.card?.kind === 'chat' &&
    still.rows[0].n === 2
  ) {
    ok('修正零命中返回说明文案，不动数据');
  } else {
    bad(`零命中处理不对：${JSON.stringify(noMatch.body)}`);
  }
  if (noMatchTurnId) await client.query('DELETE FROM conversation_turn WHERE id = $1', [noMatchTurnId]);
} catch (e) {
  bad(`请求异常：${e.message}`);
} finally {
  try {
    if (correctionTurnId) {
      await client.query('DELETE FROM conversation_turn WHERE id = $1', [correctionTurnId]);
    }
    for (const id of [sessionToday, sessionEmpty, sessionCorrection, ...straySessionIds]) {
      if (id) await client.query('DELETE FROM workout_session WHERE id = $1', [id]);
    }
    for (const [date, before] of [
      [today, metricTodayBefore],
      [oldDate, metricOldBefore],
    ]) {
      if (before) {
        await client.query(
          'UPDATE body_metric SET weight_kg = $3, body_fat_pct = $4 WHERE user_id = $1 AND date = $2',
          [USER, date, before.weight_kg, before.body_fat_pct],
        );
      } else {
        await client.query('DELETE FROM body_metric WHERE user_id = $1 AND date = $2', [USER, date]);
      }
    }
  } catch (e) {
    console.error(`  \x1b[33m! 收尾未完成：${e.message}\x1b[0m`);
    failed = 1;
  }
  await client.end();
}

if (failed) {
  console.error('\ndev-007 端到端未通过。\n');
  process.exit(1);
}
console.log('\ndev-007 端到端通过。\n');