#!/usr/bin/env node
/**
 * dev-008 端到端 —— 身份 / 知识问答 / 空抽取 / 会话记录。
 *
 * 走 5173 代理发真请求，再用裸 SQL 验落库：
 *   1. 「hi」→ chat 卡含「枝链」，不新增 workout_session
 *   2. 「练胸有什么推荐动作」→ knowledge 卡，不新增 workout_session
 *   3. 真训练 → workout 卡，workout_session +1
 *   4. 「今天练了背」→ 追问，不落库
 *   5. 会话创建 / 列表 / 详情 / 恢复（助手轮带 reply_json）
 *   6. 重命名 1–40 字；非法标题 400
 *   7. 删除会话与消息；训练记录条数不变
 *
 * 🔴 假定 server 跑在 fake provider（check-dev.sh 显式设）。本脚本不联网、不需要 key。
 * 用法：node scripts/e2e-dev008.mjs      退出码 0 = 通过
 */
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const HI = 'hi';
const KNOWLEDGE = '练胸有什么推荐动作';
const RECORD = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';
const EMPTY = '今天练了背';
const MARK = 'e2e-dev008-';

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== dev-008 对话 / 知识问答 / 会话记录 ===\n');

const createdConversations = [];
const createdSessions = [];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
  return res.body;
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();

const countSessions = async () =>
  Number(
    (await client.query('SELECT count(*) AS n FROM workout_session WHERE user_id = $1', [USER_ID]))
      .rows[0].n,
  );

const countMessages = async (conversationId) =>
  Number(
    (
      await client.query('SELECT count(*) AS n FROM conversation_turn WHERE conversation_id = $1', [
        conversationId,
      ])
    ).rows[0].n,
  );

try {
  const before = await countSessions();

  // ── 1. 身份 ──────────────────────────────────────────────────────
  console.log('\n— A. 身份与寒暄 —');
  const hi = await postTurn(HI);
  if (!hi) throw new Error('hi 请求失败');
  const hiConversation = hi.conversation_id;
  if (hiConversation) createdConversations.push(hiConversation);

  if (hi.intent === 'chat' && hi.card?.kind === 'chat') {
    if (hi.card.reply.includes('枝链')) ok(`「hi」→ chat 卡，自称枝链：${hi.card.reply.slice(0, 24)}…`);
    else bad(`「hi」的回复没提「枝链」：${hi.card.reply}`);
  } else {
    bad(`「hi」应为 chat 卡，实为 intent=${hi.intent} card=${hi.card?.kind}`);
  }
  if (hiConversation && /^[0-9a-f-]{36}$/.test(hiConversation)) ok(`新建会话 ${hiConversation}`);
  else bad(`响应缺 conversation_id：${JSON.stringify(hiConversation)}`);

  if ((await countSessions()) === before) ok('「hi」没有新增 workout_session');
  else bad('「hi」落了一条训练记录');

  // ── 2. 知识问答 ───────────────────────────────────────────────────
  console.log('\n— B. 知识问答 —');
  const kb = await postTurn(KNOWLEDGE, hiConversation);
  if (!kb) throw new Error('知识问答请求失败');

  if (kb.intent === 'knowledge' && kb.card?.kind === 'knowledge') {
    const card = kb.card;
    if (card.answer.trim().length > 0) ok(`knowledge 卡有正文：${card.answer.slice(0, 24)}…`);
    else bad('knowledge 卡正文为空');
    if (card.has_source) {
      if (card.citations.length > 0 && card.no_source_notice === null) {
        ok(`有源：${card.citations.length} 条引用`);
      } else {
        bad('has_source=true 但引用为空或仍带无源提示');
      }
    } else if (card.citations.length === 0 && card.no_source_notice) {
      ok(`无源降级带显式标注：${card.no_source_notice}`);
    } else {
      bad('无源卡必须 0 引用 + 非空 no_source_notice');
    }
  } else {
    bad(`知识问题应为 knowledge 卡，实为 intent=${kb.intent} card=${kb.card?.kind}`);
  }
  if ((await countSessions()) === before) ok('知识问答没有新增 workout_session');
  else bad('知识问题被落成了训练记录');

  // ── 3. 真训练 ─────────────────────────────────────────────────────
  console.log('\n— C. 训练记录 —');
  const rec = await postTurn(RECORD, hiConversation);
  if (!rec) throw new Error('训练请求失败');
  if (rec.card?.kind === 'workout') {
    createdSessions.push(rec.card.session_id);
    ok(`训练卡：${rec.card.exercises.length} 个动作`);
  } else {
    bad(`训练应为 workout 卡，实为 ${rec.card?.kind}`);
  }
  if ((await countSessions()) === before + 1) ok('workout_session +1');
  else bad(`workout_session 应为 ${before + 1}，实为 ${await countSessions()}`);

  // ── 4. 空抽取 ─────────────────────────────────────────────────────
  console.log('\n— D. 空抽取 —');
  const empty = await postTurn(EMPTY);
  if (empty) {
    if (empty.conversation_id) createdConversations.push(empty.conversation_id);
    if (empty.card?.kind === 'chat' && empty.card.reply.includes('没听出训练内容')) {
      ok(`空抽取 → 追问：${empty.card.reply}`);
    } else {
      bad(`空抽取应返回追问 chat 卡，实为 ${JSON.stringify(empty.card)}`);
    }
  }
  if ((await countSessions()) === before + 1) ok('空抽取没有新增 workout_session');
  else bad('空抽取落了库');

  // ── 5. 会话列表 / 详情 ────────────────────────────────────────────
  console.log('\n— E. 会话列表与恢复 —');
  const list = await api('GET', '/api/conversations');
  if (list.status === 200 && Array.isArray(list.body?.conversations)) {
    const ids = list.body.conversations.map((c) => c.id);
    if (ids.includes(hiConversation)) ok('列表里有本轮会话');
    else bad('列表里找不到本轮会话');
  } else {
    bad(`GET /api/conversations → HTTP ${list.status}`);
  }

  const detail = await api('GET', `/api/conversations/${hiConversation}`);
  if (detail.status === 200) {
    const messages = detail.body.messages;
    if (messages.length === 6) ok('详情：3 轮 = 6 条消息（user + assistant）');
    else bad(`消息数应为 6，实为 ${messages.length}`);
    const assistant = messages.filter((m) => m.role === 'assistant');
    if (assistant.every((m) => m.response && m.response.card)) ok('助手轮都带 reply_json 卡片');
    else bad('助手轮缺结构化响应，刷新后卡片恢复不了');
    const kbMessage = assistant.find((m) => m.response?.intent === 'knowledge');
    if (kbMessage?.response?.card?.kind === 'knowledge') ok('知识卡能按消息原样恢复');
    else bad('详情里没有 knowledge 卡');
    if (messages[0]?.content === HI && messages[0]?.role === 'user') ok('用户原话按时间升序排第一');
    else bad(`首条消息不对：${JSON.stringify(messages[0]?.content)}`);
  } else {
    bad(`GET /api/conversations/:id → HTTP ${detail.status}`);
  }

  // ── 6. 重命名 ─────────────────────────────────────────────────────
  console.log('\n— F. 重命名 —');
  const renamed = `${MARK}改名后`;
  const patch = await api('PATCH', `/api/conversations/${hiConversation}`, { title: `  ${renamed}  ` });
  if (patch.status === 200 && patch.body?.conversation?.title === renamed) {
    ok(`PATCH 改名成功（去首尾空白）：${renamed}`);
  } else {
    bad(`PATCH 改名 → HTTP ${patch.status} ${JSON.stringify(patch.body)}`);
  }
  const afterRename = await api('GET', `/api/conversations/${hiConversation}`);
  if (afterRename.body?.title === renamed) ok('详情里标题已更新');
  else bad(`详情标题仍为 ${afterRename.body?.title}`);

  for (const [label, title] of [
    ['空标题', '   '],
    ['超长标题', '字'.repeat(41)],
  ]) {
    const res = await api('PATCH', `/api/conversations/${hiConversation}`, { title });
    if (res.status === 400) ok(`${label} → 400`);
    else bad(`${label} 应 400，实为 ${res.status}`);
  }

  // ── 7. 删除 ───────────────────────────────────────────────────────
  console.log('\n— G. 删除 —');
  const beforeDelete = await countSessions();
  const del = await api('DELETE', `/api/conversations/${hiConversation}`);
  if (del.status === 204) ok('DELETE → 204');
  else bad(`DELETE → HTTP ${del.status}`);

  const gone = await api('GET', `/api/conversations/${hiConversation}`);
  if (gone.status === 404) ok('删除后详情 404');
  else bad(`删除后详情应 404，实为 ${gone.status}`);

  const left = await countMessages(hiConversation);
  if (left === 0) ok('消息已级联删除');
  else bad(`还剩 ${left} 条消息`);

  if ((await countSessions()) === beforeDelete) ok('workout_session 条数不变');
  else bad('删会话动了训练记录');

  const sessions = await client.query('SELECT id FROM workout_session WHERE id = ANY($1::uuid[])', [
    createdSessions,
  ]);
  if (sessions.rowCount === createdSessions.length) ok('训练记录仍在（只删了聊天记录）');
  else bad('训练记录被连带删掉了');

  // 剩下的空抽取会话清掉
  if (empty?.conversation_id) {
    await api('DELETE', `/api/conversations/${empty.conversation_id}`);
  }
} catch (e) {
  bad(`执行异常：${e.message}`);
} finally {
  // 收尾：删本次会话与训练记录
  if (createdConversations.length > 0) {
    await client.query('DELETE FROM conversation WHERE id = ANY($1::uuid[])', [
      createdConversations,
    ]);
  }
  if (createdSessions.length > 0) {
    await client.query('DELETE FROM workout_session WHERE id = ANY($1::uuid[])', [createdSessions]);
  }
  await client.end();
}

if (failed) {
  console.error('\n\x1b[31mdev-008 端到端未通过。\x1b[0m\n');
  process.exit(1);
}
console.log('\n\x1b[32mdev-008 端到端通过。\x1b[0m\n');