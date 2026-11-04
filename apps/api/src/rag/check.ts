#!/usr/bin/env node
/**
 * RAG 检索与引用的执行闸门（check-dev 的 RAG 段）—— 全替身、不联网。
 *
 * 造 3 条源 / 4 个片，故意让「不该被引用」的那三个在语义上最像：
 *   S2 是「演示」（is_citable=false）｜S3 来自 bilibili（平台过滤）｜S4 是别的 embedding 模型
 * 然后断言最终被引用的只能是 S1 的陈述片 —— 三条 SQL 过滤一条都不能少。
 *
 * 再走一遍 HTTP：钩子评估 / 闸② 拒绝 / 数据不足 / 混合意图 / 纯评估 / 幂等 / R-C 计数。
 *
 * 用法： pnpm rag:check（先 pnpm db:up && pnpm db:migrate，并起 pnpm dev）
 * 退出码：0 = 通过；1 = 失败
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { templateQuery } from '../assessment/query.js';
import { FAKE_EMBEDDING_MODEL, createFakeEmbeddingClient } from '../kb/embedding.js';
import { FAKE_RERANK_MODEL, createFakeRerankClient } from '../kb/rerank.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { createAssessmentRepo } from '../services/assessment.js';

const BASE = process.env.RAG_CHECK_BASE_URL ?? 'http://localhost:5173';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const USER = SINGLE_USER_ID;
const SPLIT = 'rag-check';
const KEYS = ['rag-fixture-s1', 'rag-fixture-s2', 'rag-fixture-s3'];
// 知识问答的 fixture：三条不同视频，验证「有源 + 引用数 ≤3」
const KNOW_KEYS = ['rag-fixture-k1', 'rag-fixture-k2', 'rag-fixture-k3'];

let failed = false;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};
const expect = (cond: boolean, good: string, wrong: string) => (cond ? ok(good) : bad(wrong));

console.log('\n=== know-fit RAG 检索与引用检查 ===\n');

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  bad(`连不上数据库：${(e as Error).message}`);
  console.error('     起库：pnpm db:up && pnpm db:migrate');
  process.exit(1);
}

const createdSessions: string[] = [];
const startedAt = new Date();

async function cleanup(): Promise<void> {
  // 上一次中途失败留下的 fixture（按 notes 标记找回，不靠进程内变量）
  await client.query(
    `DELETE FROM assessment
      WHERE related_record_id IN (SELECT id FROM workout_session WHERE notes = 'rag-check-fixture')`,
  );
  await client.query("DELETE FROM workout_session WHERE notes = 'rag-check-fixture'");
  // 混合意图那条是走 HTTP 落的库、notes 为空 —— 按 split 标记清，否则失败一次就污染下次基线
  await client.query(
    'DELETE FROM assessment WHERE related_record_id IN (SELECT id FROM workout_session WHERE split_label = $1)',
    [SPLIT],
  );
  await client.query('DELETE FROM workout_session WHERE split_label = $1', [SPLIT]);
  await client.query(
    'DELETE FROM assessment WHERE related_record_id = ANY($1::uuid[])',
    [createdSessions],
  );
  await client.query('DELETE FROM conversation_turn WHERE user_id = $1 AND created_at >= $2', [
    USER,
    startedAt.toISOString(),
  ]);
  await client.query('DELETE FROM workout_session WHERE id = ANY($1::uuid[])', [createdSessions]);
  await client.query('DELETE FROM knowledge_source WHERE platform_video_key = ANY($1)', [
    [...KEYS, ...KNOW_KEYS],
  ]);
}

async function insertSource(input: {
  key: string;
  platform: string;
  creator: string;
  title: string;
}): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO knowledge_source
       (creator, platform, video_id, title, original_url, platform_video_key,
        subtitle_source, fetched_at, robots_checked_at, robots_allowed, is_indexable, compliance_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'asr', now(), now(), null, true, 'ok')
     RETURNING id`,
    [
      input.creator,
      input.platform,
      input.key,
      input.title,
      `https://www.douyin.com/video/${input.key}`,
      input.key,
    ],
  );
  return rows.rows[0]!.id;
}

async function insertChunk(input: {
  sourceId: string;
  index: number;
  text: string;
  claimType: string;
  citable: boolean;
  model: string;
  vector: number[];
}): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO knowledge_chunk
       (source_id, chunk_index, segment_key, text, context_prefix, start_ts, end_ts,
        topic_tags, exercise_tags, claim_type, is_citable, asr_confidence,
        content_hash, embedding_model, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', '{}', $8, $9, 0.95, $10, $11, $12::vector)
     RETURNING id`,
    [
      input.sourceId,
      input.index,
      `p1-${input.index * 10}`,
      input.text,
      `[rag-check · ${input.claimType}]`,
      input.index * 10,
      input.index * 10 + 9,
      input.claimType,
      input.citable,
      sha256(input.text),
      input.model,
      `[${input.vector.join(',')}]`,
    ],
  );
  return rows.rows[0]!.id;
}

async function insertSession(input: { day: string; split: string | null; weight: number | null }): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO workout_session (user_id, date, split_label, status, missing_fields, notes)
     VALUES ($1, $2, $3, 'complete', '{}', 'rag-check-fixture')
     RETURNING id`,
    [USER, input.day, input.split],
  );
  const sessionId = rows.rows[0]!.id;
  createdSessions.push(sessionId);

  if (input.weight !== null) {
    const ex = await client.query<{ id: string }>(
      `INSERT INTO exercise_entry (session_id, "order", raw_name, exercise_id, name_confidence)
       VALUES ($1, 0, '卧推', 'bench_press', 'high') RETURNING id`,
      [sessionId],
    );
    const entryId = ex.rows[0]!.id;
    for (let i = 0; i < 5; i++) {
      await client.query(
        `INSERT INTO set_entry (exercise_entry_id, "order", weight_kg, reps, set_type, is_inferred)
         VALUES ($1, $2, $3, 5, 'working', false)`,
        [entryId, i, input.weight],
      );
    }
  }
  return sessionId;
}

interface HttpResult {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

/** 数据接口都要会话：用 demo 账号登录，fixture 也挂在这个账号下。 */
let cookie = '';
async function loginDemo(): Promise<void> {
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

async function postJson(path: string, body: unknown): Promise<HttpResult> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 非 JSON 保持 null
  }
  return { status: res.status, json, text };
}

async function getJson(path: string): Promise<HttpResult> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 非 JSON 保持 null
  }
  return { status: res.status, json, text };
}

const nonFixtureFingerprint = async () => {
  const r = await client.query(
    `SELECT count(*)::int AS n,
            coalesce(md5(string_agg(c.id::text || ':' || c.embedding_model || ':' || c.content_hash, ',' ORDER BY c.id)), '') AS fp
       FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id
      WHERE NOT (s.platform_video_key = ANY($1))`,
    [[...KEYS, ...KNOW_KEYS]],
  );
  return r.rows[0] as { n: number; fp: string };
};

try {
  await cleanup();
  await loginDemo();
  const realBefore = await nonFixtureFingerprint();

  // ── 1. 造 fixture：会话 + 3 条源 / 4 个片 ─────────────────────────
  // 会话先建：query 会带上本次训练的主要部位，embedding 替身按整句哈希，
  // 片段向量必须与最终 query 逐字一致才能命中。
  await insertSession({ day: daysAgo(5), split: SPLIT, weight: 100 });
  const sessionB = await insertSession({ day: daysAgo(3), split: SPLIT, weight: 80 });
  // C 故意不带 split：既验「零组 + 缺 split」的不足分支，也不搅乱后面的同 split 基线
  const sessionC = await insertSession({ day: daysAgo(2), split: null, weight: null });
  ok('会话 fixture 就绪：A 2500kg / B 2000kg（同 split）/ C 零组');

  const embedder = createFakeEmbeddingClient();
  const repo = createAssessmentRepo({ embedder, reranker: createFakeRerankClient() });
  const target = await repo.computeTarget({
    user_id: USER,
    session: { session_id: sessionB, session_date: daysAgo(3), split_label: SPLIT },
  });
  if (target.status !== 'ok') throw new Error(`会话 fixture 算不出判定：${target.status}`);
  const query =
    templateQuery(target.target.verdict, target.target.goal, target.target.body_parts) ?? '训练 容量 调整';
  const [vector] = await embedder.embed([query]);
  if (!vector) throw new Error('替身 embedding 没返回向量');

  const s1 = await insertSource({ key: KEYS[0]!, platform: 'douyin', creator: '测试博主一', title: '容量下降怎么调' });
  const s2 = await insertSource({ key: KEYS[1]!, platform: 'douyin', creator: '测试博主二', title: '演示动作' });
  const s3 = await insertSource({ key: KEYS[2]!, platform: 'bilibili', creator: '测试博主三', title: '站外内容' });

  const s1Text = `训练容量下降的时候先把离心放慢到三秒，等动作稳住了再考虑加重量。`;
  const s1Main = await insertChunk({
    sourceId: s1,
    index: 0,
    text: s1Text,
    claimType: '陈述',
    citable: true,
    model: FAKE_EMBEDDING_MODEL,
    vector,
  });
  const s1OtherModel = await insertChunk({
    sourceId: s1,
    index: 1,
    text: `${query}。这一段用的是别的 embedding 模型，不该进候选。`,
    claimType: '陈述',
    citable: true,
    model: 'fake-other-1024',
    vector,
  });
  const s2Chunk = await insertChunk({
    sourceId: s2,
    index: 0,
    text: `${query}。这是演示，闸① 判过不是陈述。`,
    claimType: '演示',
    citable: false,
    model: FAKE_EMBEDDING_MODEL,
    vector,
  });
  const s3Chunk = await insertChunk({
    sourceId: s3,
    index: 0,
    text: `${query}。这是 bilibili 的同主题内容。`,
    claimType: '陈述',
    citable: true,
    model: FAKE_EMBEDDING_MODEL,
    vector,
  });
  ok(`fixture 就绪：3 条源 / 4 个片；query = 「${query}」`);

  // ── 2. 检索过滤：只有 S1 的陈述片能进候选 ──────────────────────────
  const retrieved = await repo.retrieve({ user_id: USER, query });
  if (retrieved.status !== 'ok') {
    bad(`检索失败：${retrieved.message}`);
  } else {
    const ids = retrieved.candidates.map((c) => c.chunk_id);
    expect(
      ids.length === 1 && ids[0] === s1Main,
      '检索只返回 S1 陈述片（is_citable / platform / embedding_model 三条过滤都生效）',
      `检索返回了 ${ids.length} 条：${ids.join('、')} —— 应为且仅为 S1 陈述片`,
    );
    expect(
      !ids.includes(s2Chunk) && !ids.includes(s3Chunk) && !ids.includes(s1OtherModel),
      '演示片 / 站外片 / 异模型片都被挡在候选之外',
      '有不该进候选的片漏了进来',
    );
    expect(
      retrieved.meta.embedding_model === FAKE_EMBEDDING_MODEL && retrieved.meta.rerank_model === FAKE_RERANK_MODEL,
      `pipeline_meta 记了模型串（${retrieved.meta.embedding_model} / ${retrieved.meta.rerank_model}）`,
      '模型串没记对',
    );
  }

  // ── 3. 钩子评估：有源 + 引用指向 S1 ───────────────────────────────
  const hook = await postJson('/api/assessments', { trigger: 'hook', related_record_id: sessionB });
  const card = hook.json?.card as Record<string, unknown> | undefined;
  expect(hook.status === 200, 'POST /api/assessments（hook）→ 200', `HTTP ${hook.status}`);
  expect(card?.kind === 'assessment', '返回评估卡', `卡片 kind = ${String(card?.kind)}`);
  expect(card?.has_source === true, 'has_source = true', 'has_source 不是 true');
  const citations = (card?.citations ?? []) as Record<string, unknown>[];
  expect(citations.length === 1, '1 条引用', `引用 ${citations.length} 条`);
  const shortQuote = String(citations[0]?.short_quote ?? '');
  expect(
    shortQuote.length > 0 && s1Text.includes(shortQuote),
    'short_quote 是 S1 片原文的连续子串',
    'short_quote 不是 S1 片原文的子串',
  );

  const assessmentId = String(card?.assessment_id ?? '');
  if (assessmentId) {
    const cit = await client.query<{ chunk_id: string; quote_start: number; quote_end: number }>(
      'SELECT chunk_id, quote_start, quote_end FROM citation WHERE assessment_id = $1',
      [assessmentId],
    );
    const row = cit.rows[0];
    expect(row?.chunk_id === s1Main, '库里的 citation.chunk_id 指向 S1 陈述片', `chunk_id = ${String(row?.chunk_id)}`);
    expect(
      row != null && s1Text.slice(row.quote_start, row.quote_end) === shortQuote,
      '引用偏移能从 chunk 原文还原出逐字引用',
      '引用偏移还原失败',
    );

    const meta = await client.query<{ has_source: boolean; pipeline_meta: Record<string, unknown> }>(
      'SELECT has_source, pipeline_meta FROM assessment WHERE id = $1',
      [assessmentId],
    );
    expect(
      meta.rows[0]?.has_source === true &&
        meta.rows[0]?.pipeline_meta?.embedding_model === FAKE_EMBEDDING_MODEL,
      'assessment 行落库（has_source / pipeline_meta 都在）',
      'assessment 行的 has_source / pipeline_meta 不对',
    );
  }

  // ── 5. 钩子重复点击：10 分钟幂等 ─────────────────────────────────
  const hookAgain = await postJson('/api/assessments', { trigger: 'hook', related_record_id: sessionB });
  expect(
    (hookAgain.json?.card as Record<string, unknown> | undefined)?.assessment_id === assessmentId,
    '钩子重复点击返回同一个 assessment_id（幂等）',
    '钩子重复点击生成了一条新评估',
  );

  // ── 6. 闸② 拒绝 → 整条降级无源 ──────────────────────────────────
  await client.query('UPDATE knowledge_chunk SET text = $2 WHERE id = $1', [
    s1Main,
    `${s1Text}【不支撑】`,
  ]);
  // 窗口哈希最多晚 60 秒刷新 —— 这里不靠它，改的是检索内容本身
  const rejected = await postJson('/api/assessments', { trigger: 'explicit', related_record_id: sessionB });
  const rejectedCard = rejected.json?.card as Record<string, unknown> | undefined;
  expect(rejected.status === 200, '闸② 拒绝时仍返回 200', `HTTP ${rejected.status}`);
  expect(rejectedCard?.has_source === false, 'has_source = false（整条降级）', '闸② 拒绝后仍标了有源');
  expect(
    Array.isArray(rejectedCard?.citations) && (rejectedCard?.citations as unknown[]).length === 0,
    '无源卡不带引用',
    '无源卡带了引用',
  );
  expect(
    typeof rejectedCard?.no_source_notice === 'string' && rejectedCard.no_source_notice.length > 0,
    'no_source_notice 非空',
    'no_source_notice 为空',
  );
  if (rejectedCard?.assessment_id) {
    const row = await client.query<{ has_source: boolean }>('SELECT has_source FROM assessment WHERE id = $1', [
      String(rejectedCard.assessment_id),
    ]);
    expect(row.rows[0]?.has_source === false, '库里 assessment 行 has_source=false', '库里仍是有源');
  }

  // ── 7. 数据不足：card=null，不建行 ───────────────────────────────
  const beforeC = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM assessment WHERE related_record_id = $1',
    [sessionC],
  );
  const insufficient = await postJson('/api/assessments', { trigger: 'hook', related_record_id: sessionC });
  const afterC = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM assessment WHERE related_record_id = $1',
    [sessionC],
  );
  expect(
    insufficient.status === 200 && insufficient.json?.card === null,
    '数据不足 → 200 + card=null',
    `数据不足应 card=null，实为 HTTP ${insufficient.status} / ${JSON.stringify(insufficient.json?.card)}`,
  );
  expect(
    Array.isArray(insufficient.json?.notices) && (insufficient.json?.notices as unknown[]).length > 0,
    '数据不足时说明缺什么',
    '数据不足没有 notice',
  );
  expect(afterC.rows[0]?.n === beforeC.rows[0]?.n, '数据不足不新增 assessment 行', '数据不足仍落了一行 assessment');

  // 复原 S1 原文 —— 后续路径要重新走通有源
  await client.query('UPDATE knowledge_chunk SET text = $2 WHERE id = $1', [s1Main, s1Text]);

  // ── 8. 混合意图 / 纯评估 ─────────────────────────────────────────
  const mixedMsg = '推日：卧推 70kg×5 五组，帮我看下够不够';
  const mixed = await postJson('/api/turns', { message: mixedMsg });
  const mixedCard = mixed.json?.card as Record<string, unknown> | undefined;
  const mixedAssessment = mixed.json?.assessment as Record<string, unknown> | undefined;
  if (mixedCard?.session_id) createdSessions.push(String(mixedCard.session_id));
  expect(
    mixedCard?.kind === 'workout' && mixedAssessment?.kind === 'assessment',
    '混合意图：card.kind=workout 且 assessment 有值',
    `混合意图返回 card=${String(mixedCard?.kind)} / assessment=${String(mixedAssessment?.kind)}`,
  );
  expect(
    mixedAssessment?.has_source === true,
    '混合意图的评估走完有源路径',
    `混合意图的评估没有来源：${JSON.stringify({ assessment: mixedAssessment, notices: mixed.json?.notices })}`,
  );

  const pure = await postJson('/api/turns', { message: '帮我评估一下' });
  expect(
    pure.json?.card === null && (pure.json?.assessment as Record<string, unknown> | undefined)?.kind === 'assessment',
    '纯评估：card=null，assessment 非 null',
    `纯评估返回 card=${String(pure.json?.card)} / assessment=${String((pure.json?.assessment as Record<string, unknown> | undefined)?.kind)}`,
  );

  // ── 8b. 知识问答：有源 + 引用数 ≤3 ───────────────────────────────
  const knowledgeMsg = '练胸有什么推荐动作';
  const [kvec] = await embedder.embed([knowledgeMsg]);
  if (!kvec) throw new Error('替身 embedding 没返回知识 query 向量');
  for (const [i, key] of KNOW_KEYS.entries()) {
    const sourceId = await insertSource({
      key,
      platform: 'douyin',
      creator: `知识博主${i + 1}`,
      title: `练胸动作 ${i + 1}`,
    });
    await insertChunk({
      sourceId,
      index: 0,
      text: `练胸先做复合动作，再补孤立动作。第 ${i + 1} 条视频里说：卧推先把肩胛收紧，下放到胸口再推起，动作稳定以后再加重。`,
      claimType: '陈述',
      citable: true,
      model: FAKE_EMBEDDING_MODEL,
      vector: kvec,
    });
  }
  const knowledge = await postJson('/api/turns', { message: knowledgeMsg });
  const kCard = knowledge.json?.card as Record<string, unknown> | undefined;
  expect(kCard?.kind === 'knowledge', '知识问题返回 knowledge 卡', `卡片 kind = ${String(kCard?.kind)}`);
  expect(kCard?.has_source === true, '知识卡 has_source = true', '知识卡没走到有源路径');
  const kCitations = (kCard?.citations ?? []) as Record<string, unknown>[];
  expect(
    kCitations.length >= 1 && kCitations.length <= 3,
    `知识引用数在 1–3 条（实为 ${kCitations.length}）`,
    `知识引用数超出 1–3：${kCitations.length}`,
  );
  expect(
    new Set(kCitations.map((c) => c.url)).size === kCitations.length,
    '知识引用来自不同视频',
    '知识引用出现了同一条视频的重复来源',
  );
  const kClaims = (kCard?.claims ?? []) as Record<string, unknown>[];
  expect(kClaims.length <= 3, `知识建议 ≤3 条（实为 ${kClaims.length}）`, `知识建议超过 3 条：${kClaims.length}`);

  // ── 9. 全端点扫一遍 + R-C 计数 ───────────────────────────────────
  const sweep: { label: string; result: HttpResult }[] = [];
  sweep.push({ label: 'GET /api/health', result: await getJson('/api/health') });
  const recordTurn = await postJson('/api/turns', {
    message: '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组',
  });
  const recordSession = (recordTurn.json?.card as Record<string, unknown> | undefined)?.session_id;
  if (recordSession) createdSessions.push(String(recordSession));
  sweep.push({ label: 'POST /api/turns（记录）', result: recordTurn });
  sweep.push({ label: 'POST /api/turns（闲聊）', result: await postJson('/api/turns', { message: '今天状态不错' }) });
  sweep.push({
    label: 'POST /api/assessments（显式）',
    result: await postJson('/api/assessments', { trigger: 'explicit', related_record_id: sessionB }),
  });
  sweep.push({
    label: 'POST /api/assessments（错误：钩子缺 id）',
    result: await postJson('/api/assessments', { trigger: 'hook' }),
  });
  sweep.push({ label: `GET /api/sessions/:id/volume`, result: await getJson(`/api/sessions/${sessionB}/volume`) });

  const twoHundred = sweep.filter((s) => s.result.status >= 200 && s.result.status < 300);
  expect(
    twoHundred.length === sweep.length - 1,
    `端点扫描：${twoHundred.length}/${sweep.length} 个 2xx（钩子缺 id 那条应为 400）`,
    `端点扫描有非预期状态码：${sweep.map((s) => `${s.label}=${s.result.status}`).join('；')}`,
  );
  const missingId = sweep.find((s) => s.label.includes('钩子缺 id'));
  expect(missingId?.result.status === 400, '钩子缺 related_record_id → 400', '钩子缺 id 没有返回 400');

  const health = await getJson('/api/health');
  const rc = health.json?.rc as { scanned?: number; blocked?: number } | undefined;
  expect((rc?.scanned ?? 0) > 0, `R-C 扫描计数在涨（scanned=${rc?.scanned ?? 0}）`, 'R-C 钩子没跑（scanned=0）');
  expect(rc?.blocked === 0, '合法响应没有被 R-C 误拦（blocked=0）', `R-C 误拦了 ${rc?.blocked} 次`);

  // ── 10. 同库真实片未被改动 ───────────────────────────────────────
  const realAfter = await nonFixtureFingerprint();
  expect(
    realAfter.n === realBefore.n && realAfter.fp === realBefore.fp,
    `非替身源 ${realAfter.n} 片未被改动`,
    `检查改动了非替身源：${realBefore.n} 片 → ${realAfter.n} 片`,
  );
} finally {
  await cleanup().catch((e: Error) => bad(`清理失败：${e.message}`));
  await client.end();
}

if (failed) {
  console.error('\nRAG 检索与引用检查未通过。\n');
  process.exit(1);
}
console.log('\nRAG 检索与引用检查通过。\n');
