#!/usr/bin/env node
/**
 * 端到端 —— 训练计划子图与计划卡。
 *
 * 走 5173 代理发真请求，再用裸 SQL 验档案写回：
 *   1. 档案频率清空 → 问计划 → 先追问频率，不出检索卡 / 边界卡
 *   2. 同一会话回「三分化」→ 出 plan 卡；只列 3 个训练日、不铺满 7 天、AI 编排标记
 *   3. 档案里 training_frequency 已写回三分化
 *   4. 档案已有频率 → 再问计划直接出卡，不再追问
 *   5. 不规律 → 先问每周几天；回「每周 3 天」→ 出 3 个训练日
 *   6. 计划卡有源时引用非空；无源时显式标注，不假装有源
 *
 * 🔴 假定 server 跑在 fake provider（check-dev.sh 显式设）。本脚本不联网、不需要 key。
 * 用法：node scripts/e2e-dev016.mjs      退出码 0 = 通过
 */
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const ASK_PLAN = '帮我出一个力量训练计划';
const ASK_PLAN_AGAIN = '帮我出一份力量训练计划';

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== 训练计划子图与计划卡 端到端 ===\n');

const createdConversations = [];

let cookie = '';
async function loginDemo() {
  const email = process.env.E2E_EMAIL ?? 'demo@knowfit.local';
  const password = process.env.E2E_PASSWORD ?? 'knowfit-demo';
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`demo 登录失败：HTTP ${res.status}（0009 迁移跑了吗？）`);
  cookie = (res.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('demo 登录没拿到会话 cookie');
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function postTurn(message, conversationId) {
  const payload = { message };
  if (conversationId) payload.conversation_id = conversationId;
  const res = await api('POST', '/api/turns', payload);
  if (res.status !== 200) {
    bad(`POST /api/turns（${message.slice(0, 10)}…）→ HTTP ${res.status} ${JSON.stringify(res.body)}`);
    return null;
  }
  const body = res.body;
  if (body?.conversation_id) createdConversations.push(body.conversation_id);
  return body;
}

function profilePayload(profile, frequency) {
  return {
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    goal: profile.goal,
    training_frequency: frequency,
    training_years: profile.training_years,
    training_months: profile.training_months,
  };
}

function checkPlanCard(card, label, expectedDays) {
  if (card?.kind !== 'plan') {
    bad(`${label}：应为 plan 卡，实为 ${card?.kind ?? 'null'}`);
    return false;
  }
  if (card.days?.length === expectedDays) ok(`${label}：${expectedDays} 个训练日`);
  else bad(`${label}：days 应为 ${expectedDays}，实为 ${card.days?.length}`);
  if (card.ai_generated === true) ok(`${label}：ai_generated=true`);
  else bad(`${label}：ai_generated 不是 true`);
  if (card.has_source) {
    if (card.citations.length > 0 && card.no_source_notice === null) {
      ok(`${label}：有源，${card.citations.length} 条引用`);
    } else {
      bad(`${label}：has_source=true 但引用为空或仍带无源提示`);
    }
  } else if (card.citations.length === 0 && card.no_source_notice) {
    ok(`${label}：无源降级带显式标注`);
  } else {
    bad(`${label}：无源卡必须 0 引用 + 非空 no_source_notice`);
  }
  return true;
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();
await loginDemo();

const profileRes = await api('GET', '/api/profile');
if (profileRes.status !== 200) throw new Error(`GET /api/profile → HTTP ${profileRes.status}`);
const original = profileRes.body;
const originalFrequency = original.training_frequency ?? null;

try {
  // 从「档案没填频率」开始
  const reset = await api('PUT', '/api/profile', profilePayload(original, null));
  if (reset.status === 200 && reset.body?.training_frequency === null) {
    ok('档案频率已清空（null）');
  } else {
    bad(`清空频率失败：HTTP ${reset.status} ${JSON.stringify(reset.body)}`);
  }

  // ── A. 缺频率先追问 ──────────────────────────────────────────────
  console.log('\n— A. 缺频率先追问 —');
  const ask = await postTurn(ASK_PLAN);
  if (!ask) throw new Error('问计划请求失败');
  const conversationId = ask.conversation_id;
  if (ask.intent !== 'plan') bad(`应用 plan 意图，实为 ${ask.intent}`);
  else ok('「帮我出一个力量训练计划」→ intent=plan');
  if (ask.card?.kind === 'chat' && ask.card.reply.includes('训练频率')) {
    ok(`先追问频率：${ask.card.reply.slice(0, 28)}…`);
  } else {
    bad(`缺频率时应追问，实为 ${ask.card?.kind} ${ask.card?.reply ?? ''}`);
  }
  if (ask.card?.kind !== 'boundary' && ask.card?.kind !== 'knowledge') {
    ok('不再落进边界卡 / 检索卡');
  } else {
    bad(`误入 ${ask.card.kind} 卡`);
  }

  // ── B. 回答频率 → 当轮出计划 ─────────────────────────────────────
  console.log('\n— B. 回答频率 → 当轮出计划 —');
  const planned = await postTurn('三分化', conversationId);
  if (!planned) throw new Error('回答频率后的计划请求失败');
  if (planned.intent !== 'plan') bad(`回答三分化后应接回 plan，实为 ${planned.intent}`);
  else ok('「三分化」接回 plan，不重新分类');
  if (checkPlanCard(planned.card, '三分化计划', 3)) {
    const card = planned.card;
    if (card.split === '三分化' && card.cycle === '练 3 天休 1 天') {
      ok(`split=${card.split} / cycle=${card.cycle}`);
    } else {
      bad(`split / cycle 不对：${card.split} / ${card.cycle}`);
    }
    const train = card.days.filter((d) => d.kind === 'train').map((d) => d.day);
    if (train.join(',') === '1,2,3') ok('只列一个循环：第 1、2、3 天');
    else bad(`训练日应为 1,2,3，实为 ${train}`);
  }

  // ── C. 频率写回档案 ──────────────────────────────────────────────
  console.log('\n— C. 频率写回档案 —');
  const after = await api('GET', '/api/profile');
  if (after.body?.training_frequency === '三分化') ok('GET /api/profile → 三分化');
  else bad(`档案频率未写回：${JSON.stringify(after.body?.training_frequency)}`);

  const row = await client.query(
    'SELECT training_frequency FROM user_profile WHERE user_id = $1',
    [USER_ID],
  );
  if (row.rows[0]?.training_frequency === '三分化') ok('库里 user_profile.training_frequency = 三分化');
  else bad(`库里频率不对：${JSON.stringify(row.rows[0])}`);

  // ── D. 已有频率直接出计划 ────────────────────────────────────────
  console.log('\n— D. 已有频率直接出计划 —');
  const direct = await postTurn(ASK_PLAN_AGAIN);
  if (!direct) throw new Error('已有频率的计划请求失败');
  if (direct.intent === 'plan') ok('intent=plan');
  else bad(`应为 plan，实为 ${direct.intent}`);
  if (checkPlanCard(direct.card, '直接计划', 3)) {
    if (direct.card.split === '三分化') ok('用的是档案里的三分化');
    else bad(`应用档案频率，实为 ${direct.card.split}`);
  }

  // ── E. 不规律先问天数 ────────────────────────────────────────────
  console.log('\n— E. 不规律先问天数 —');
  const irregular = await postTurn('我不规律，帮我排个训练计划');
  if (irregular?.card?.kind === 'chat' && irregular.card.reply.includes('每周能练几天')) {
    ok(`不规律 → 追问天数：${irregular.card.reply}`);
  } else {
    bad(`不规律应追问天数，实为 ${irregular?.card?.kind} ${irregular?.card?.reply ?? ''}`);
  }
  const irregularPlan = await postTurn('每周 3 天', irregular?.conversation_id);
  if (irregularPlan?.intent === 'plan') ok('天数回答接回 plan');
  else bad(`天数回答应接回 plan，实为 ${irregularPlan?.intent}`);
  if (checkPlanCard(irregularPlan?.card, '不规律计划', 3)) {
    const card = irregularPlan.card;
    if (card.split === '不规律' && card.cycle === '每周练 3 天') {
      ok(`split=${card.split} / cycle=${card.cycle}`);
    } else {
      bad(`不规律 split / cycle 不对：${card.split} / ${card.cycle}`);
    }
    const train = card.days.filter((d) => d.kind === 'train').map((d) => d.day);
    if (train.join(',') === '1,2,3') ok('按训练日排列（1/2/3），不锁自然周');
    else bad(`不规律排布不对：train=${train}`);
  }
} catch (e) {
  bad(e instanceof Error ? e.message : String(e));
} finally {
  // 收尾：恢复档案频率、删掉本轮会话
  const restore = await api('PUT', '/api/profile', profilePayload(original, originalFrequency));
  if (restore.status === 200) console.log(`  · 已恢复档案频率：${originalFrequency ?? 'null'}`);
  else console.error(`  \x1b[31m✗\x1b[0m 恢复档案频率失败：HTTP ${restore.status}`);

  for (const id of [...new Set(createdConversations)]) {
    await api('DELETE', `/api/conversations/${id}`);
  }
  await client.end();
}

if (failed) {
  console.error('\n\x1b[31m训练计划端到端未通过。\x1b[0m\n');
  process.exit(1);
}
console.log('\n\x1b[32m训练计划端到端全部通过。\x1b[0m\n');