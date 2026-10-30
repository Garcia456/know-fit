#!/usr/bin/env node
/**
 * dev-006 端到端：读接口 / 档案写入 / F7 提示去重
 *
 * 走 HTTP（vite 代理 → api），再用裸 SQL 断言落库：
 *   A. PUT /api/profile → GET 回读一致；体重写入 body_metric 当天一行
 *   B. POST /api/nudges/next → 同一断点第二次返回 null
 *   C. POST /api/nudges/:id/action → 动作留痕
 *
 * 自清理：档案、当天体重、测试 session 全部还原 —— 不破坏本机已有数据。
 *
 * 用法： node scripts/e2e-dev006.mjs      （先起 pnpm dev）
 * 退出码：0 = 通过；1 = 失败
 */
import pg from 'pg';
import { loginDemo } from './lib/login.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const USER = '00000000-0000-4000-8000-000000000001';

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
let sessionId = null;
let profileBefore = null;
let metricBefore = null;
const date = todayLocal();

try {
  await client.connect();
} catch (e) {
  console.error(`  \x1b[31m✗\x1b[0m 连不上数据库：${e.message}`);
  process.exit(1);
}

console.log('\n=== dev-006 端到端 ===\n');

try {
  cookie = await loginDemo(BASE);
  ok('demo 账号登录成功');
} catch (e) {
  bad(e.message);
  process.exit(1);
}

try {
  // 先留底，收尾时原样还原
  profileBefore = (
    await client.query(
      'SELECT height_cm, goal, training_started_on, updated_at FROM user_profile WHERE user_id = $1',
      [USER],
    )
  ).rows[0];
  metricBefore = (
    await client.query('SELECT weight_kg, body_fat_pct FROM body_metric WHERE user_id = $1 AND date = $2', [
      USER,
      date,
    ])
  ).rows[0];

  // A. 档案往返
  const input = {
    height_cm: 178,
    weight_kg: 72.5,
    goal: '增肌+减脂',
    training_years: 1,
    training_months: 0,
  };
  const put = await call('/profile', { method: 'PUT', body: JSON.stringify(input) });
  if (put.status !== 200) bad(`PUT /api/profile 返回 ${put.status}：${JSON.stringify(put.body)}`);
  else {
    const same = ['height_cm', 'weight_kg', 'goal', 'training_years', 'training_months'].every(
      (k) => put.body[k] === input[k],
    );
    if (same && typeof put.body.updated_at === 'string') ok('PUT /api/profile 写入并回读一致');
    else bad(`PUT 应答字段不对：${JSON.stringify(put.body)}`);
  }

  const got = await call('/profile', { method: 'GET' });
  if (
    got.status === 200 &&
    ['height_cm', 'weight_kg', 'goal', 'training_years', 'training_months'].every((k) => got.body[k] === input[k])
  ) {
    ok('GET /api/profile 回读一致');
  } else {
    bad(`GET /api/profile 不一致：${JSON.stringify(got.body)}`);
  }

  const invalid = await call('/profile', {
    method: 'PUT',
    body: JSON.stringify({ ...input, height_cm: 99 }),
  });
  if (invalid.status === 400) ok('越界身高被 400 拒绝');
  else bad(`越界身高应 400，实际 ${invalid.status}`);

  const metric = await client.query(
    'SELECT weight_kg FROM body_metric WHERE user_id = $1 AND date = $2',
    [USER, date],
  );
  if (metric.rowCount === 1 && metric.rows[0].weight_kg === 72.5) {
    ok('体重写入 body_metric 当天一行');
  } else {
    bad(`body_metric 当天行不对：${JSON.stringify(metric.rows)}`);
  }

  // B. F7：造一条今天的待补全记录（排在其它记录之后）
  const inserted = await client.query(
    `INSERT INTO workout_session (user_id, date, split_label, status, missing_fields, notes)
     VALUES ($1, $2, 'e2e-dev006-背日', 'incomplete', ARRAY['reps'], NULL)
     RETURNING id`,
    [USER, date],
  );
  sessionId = inserted.rows[0].id;

  const first = await call('/nudges/next', { method: 'POST' });
  const nudge = first.body?.nudge;
  if (first.status === 200 && nudge?.type === '补全' && nudge.session_id === sessionId) {
    ok('POST /api/nudges/next 返回补全提示');
  } else {
    bad(`补全提示不对：${JSON.stringify(first.body)}`);
  }

  const second = await call('/nudges/next', { method: 'POST' });
  if (second.status === 200 && second.body?.nudge === null) {
    ok('同一断点第二次调用返回 null（服务端拒绝重复）');
  } else {
    bad(`同一断点不应重复提示：${JSON.stringify(second.body)}`);
  }

  if (nudge?.id) {
    const acted = await call(`/nudges/${nudge.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: '忽略' }),
    });
    const stored = await client.query('SELECT action FROM recovery_nudge WHERE id = $1', [nudge.id]);
    if (acted.status === 200 && stored.rows[0]?.action === '忽略') {
      ok('提示动作写入 recovery_nudge');
    } else {
      bad(`动作未留痕：${JSON.stringify(acted.body)} / ${JSON.stringify(stored.rows)}`);
    }
  }

  // C. 数据页读接口：列表能查到、详情带 hook 与 20 键
  const list = await call(`/sessions?from=${date}&to=${date}`);
  if (list.status === 200 && list.body.sessions.some((s) => s.session_id === sessionId)) {
    ok('GET /api/sessions 能查到当天记录');
  } else {
    bad(`GET /api/sessions 未包含测试记录：${JSON.stringify(list.body)}`);
  }

  const detail = await call(`/sessions/${sessionId}`);
  const muscleKeys = detail.body?.volume?.by_muscle ?? {};
  if (
    detail.status === 200 &&
    typeof detail.body.hook?.current === 'number' &&
    Object.keys(muscleKeys).length === 20
  ) {
    ok('GET /api/sessions/:id 带 hook 与 20 个肌群键');
  } else {
    bad(
      `详情契约不对：status=${detail.status} hook=${JSON.stringify(detail.body?.hook)} 键数=${Object.keys(muscleKeys).length}`,
    );
  }
} catch (e) {
  bad(`请求异常：${e.message}`);
} finally {
  // 收尾：还原档案与当天体重，删测试 session（nudge 随外键级联）
  try {
    if (sessionId) await client.query('DELETE FROM workout_session WHERE id = $1', [sessionId]);
    if (profileBefore) {
      await client.query(
        `UPDATE user_profile SET height_cm = $2, goal = $3, training_started_on = $4, updated_at = $5
          WHERE user_id = $1`,
        [USER, profileBefore.height_cm, profileBefore.goal, profileBefore.training_started_on, profileBefore.updated_at],
      );
    }
    await client.query('DELETE FROM body_metric WHERE user_id = $1 AND date = $2', [USER, date]);
    if (metricBefore) {
      await client.query(
        'INSERT INTO body_metric (user_id, date, weight_kg, body_fat_pct) VALUES ($1, $2, $3, $4)',
        [USER, date, metricBefore.weight_kg, metricBefore.body_fat_pct],
      );
    }
  } catch (e) {
    console.error(`  \x1b[33m! 收尾未完成：${e.message}\x1b[0m`);
    failed = 1;
  }
  await client.end();
}

if (failed) {
  console.error('\ndev-006 端到端未通过。\n');
  process.exit(1);
}
console.log('\ndev-006 端到端通过。\n');