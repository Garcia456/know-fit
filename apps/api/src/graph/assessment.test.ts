import { describe, expect, it } from 'vitest';
import {
  GENERATION_FAILURE_NOTICE,
  NO_RECORD_NOTICE,
  NO_SOURCE_NOTICE,
  RETRIEVAL_FAILURE_NOTICE,
  assessmentCitationCap,
  buildAssessmentGraph,
} from './assessment.js';
import type { AssessmentRepo, PersistAssessmentInput } from '../assessment/repo.js';
import type { AssessmentCandidate } from '../assessment/types.js';
import { buildGateWindows } from '../assessment/windows.js';
import { FAKE_UNSUPPORTED_MARK, createFakeClient } from '../llm/fake.js';
import type { LlmClient } from '../llm/client.js';
import { buildVolumeHook } from '../metrics/hook.js';

/**
 * 评估子图 —— 替身 LLM + 桩 repo，不连库。
 * 验的是「分支走对没走对」：有源 / 闸② 拒绝降级 / 无候选 / 检索失败 / 数据不足。
 */

const SPLIT = '推日';
const VERDICT = buildVolumeHook({ current: 2000, baseline: 2500, split_label: SPLIT });
const CHUNK =
  '先说一句背景，这句话也得够长但不该是最长的。容量下降的时候先把离心放慢，等动作稳住了再考虑加重量。训练日志要记到每一组，别只记总容量，不然下次没法判断是哪一组掉了。另外每次训练后把感受记下来，过两周再回看会清楚很多。';

const candidate = (text = CHUNK): AssessmentCandidate => ({
  chunk_id: 'chunk-1',
  source_id: 'source-1',
  creator: '测试博主',
  title: '容量下降怎么调',
  url: 'https://www.douyin.com/video/1',
  start_ts: 10,
  chunk_text: text,
  windows: buildGateWindows({ chunk_text: text, start_ts: 10, end_ts: 60, segments: null }),
  context_prefix: '[测试]',
  similarity: 0.9,
  rerank_score: 0.8,
});

function makeRepo(overrides: Partial<AssessmentRepo> = {}) {
  const persisted: PersistAssessmentInput[] = [];
  const repo: AssessmentRepo = {
    async resolveSession() {
      return {
        status: 'ok',
        session: { session_id: 'session-1', session_date: '2026-10-20', split_label: SPLIT },
      };
    },
    async computeTarget() {
      return {
        status: 'ok',
        target: {
          session_id: 'session-1',
          session_date: '2026-10-20',
          split_label: SPLIT,
          goal: '增肌',
          body_parts: ['胸'],
          verdict: VERDICT,
        },
      };
    },
    async retrieve() {
      return {
        status: 'ok',
        candidates: [candidate()],
        meta: { embedding_model: 'fake-embedding', rerank_model: 'fake-rerank', rerank_degraded: false },
      };
    },
    async persist(input) {
      persisted.push(input);
      return {
        assessment_id: 'assessment-1',
        citation_ids: input.citations.map((c) => c.citation_id),
      };
    },
    ...overrides,
  };
  return { repo, persisted };
}

function build(repo: AssessmentRepo, llm: LlmClient = createFakeClient()) {
  return buildAssessmentGraph({ llm, repo });
}

const invoke = (repo: AssessmentRepo, llm?: LlmClient) =>
  build(repo, llm).invoke({
    user_id: 'user-1',
    related_record_id: 'session-1',
    trigger: 'explicit',
  });

describe('引用上限', () => {
  it('知识默认 3 时，评估仍夹到 2', () => {
    expect(assessmentCitationCap(3)).toBe(2);
    expect(assessmentCitationCap(2)).toBe(2);
    expect(assessmentCitationCap(1)).toBe(1);
  });
});

describe('有源路径', () => {
  it('起草 → 闸② → 引用落库 → 卡片带逐字短引用', async () => {
    const { repo, persisted } = makeRepo();
    const state = await invoke(repo);

    expect(state.card?.kind).toBe('assessment');
    const card = state.card!;
    expect(card.has_source).toBe(true);
    expect(card.citations).toHaveLength(1);
    expect(card.no_source_notice).toBeNull();

    const citation = card.citations[0]!;
    expect(CHUNK).toContain(citation.short_quote);
    expect(citation.creator).toBe('测试博主');

    expect(persisted).toHaveLength(1);
    const saved = persisted[0]!;
    expect(saved.has_source).toBe(true);
    expect(saved.citations).toHaveLength(1);
    // 存的是偏移，不是引用文本
    expect(CHUNK.slice(saved.citations[0]!.quote_start, saved.citations[0]!.quote_end)).toBe(
      citation.short_quote,
    );

    // 对外卡片里没有片段全文
    expect(JSON.stringify(card)).not.toContain(CHUNK);
  });

  it('source claim 的 citation_id 指向同一条引用', async () => {
    const { repo } = makeRepo();
    const state = await invoke(repo);
    const card = state.card!;
    const sourceClaim = card.advice_claims.find((c) => c.basis === 'source');
    expect(sourceClaim?.citation_id).toBe(card.citations[0]?.citation_id);
  });
});

describe('降级路径', () => {
  it('闸② 拒绝 → 整条降级为无源，不带引用', async () => {
    const { repo, persisted } = makeRepo({
      async retrieve() {
        return {
          status: 'ok',
          candidates: [candidate(`${CHUNK}${FAKE_UNSUPPORTED_MARK}`)],
          meta: { embedding_model: 'fake-embedding', rerank_model: 'fake-rerank', rerank_degraded: false },
        };
      },
    });
    const state = await invoke(repo);
    const card = state.card!;

    expect(card.has_source).toBe(false);
    expect(card.citations).toHaveLength(0);
    expect(card.no_source_notice).toBe(NO_SOURCE_NOTICE);
    expect(persisted[0]?.has_source).toBe(false);
    expect(persisted[0]?.pipeline_meta.no_source_reason).toBe('gate2_reject');
  });

  it('没有候选 → 无源，原因记 no_candidate', async () => {
    const { repo, persisted } = makeRepo({
      async retrieve() {
        return {
          status: 'ok',
          candidates: [],
          meta: { embedding_model: 'fake-embedding', rerank_model: 'fake-rerank', rerank_degraded: false },
        };
      },
    });
    const state = await invoke(repo);
    expect(state.card?.has_source).toBe(false);
    expect(state.card?.no_source_notice).toBe(NO_SOURCE_NOTICE);
    expect(persisted[0]?.pipeline_meta.no_source_reason).toBe('no_candidate');
  });

  it('检索失败 → 无源，并且用另一句说明（不是「没找到依据」）', async () => {
    const { repo, persisted } = makeRepo({
      async retrieve() {
        return {
          status: 'error',
          message: 'embedding 挂了',
          meta: { embedding_model: 'fake-embedding', rerank_model: 'fake-rerank', rerank_degraded: false },
        };
      },
    });
    const state = await invoke(repo);
    expect(state.card?.has_source).toBe(false);
    expect(state.card?.no_source_notice).toBe(RETRIEVAL_FAILURE_NOTICE);
    expect(persisted[0]?.pipeline_meta.no_source_reason).toBe('retrieval_error');
  });

  it('闸② 解析失败 → fail-closed，整条降级为无源', async () => {
    const base = createFakeClient();
    const llm: LlmClient = {
      ...base,
      async structured(req) {
        if (req.name === 'verify_citation') throw new Error('输出不是 JSON');
        return base.structured(req);
      },
    };
    const { repo, persisted } = makeRepo();
    const state = await invoke(repo, llm);

    expect(state.card?.has_source).toBe(false);
    expect(state.card?.citations).toHaveLength(0);
    expect(persisted[0]?.pipeline_meta.no_source_reason).toBe('gate2_reject');
  });

  it('起草直接炸 → 不回卡片，给「稍后再试」', async () => {
    const base = createFakeClient();
    const llm: LlmClient = {
      ...base,
      async structured(req) {
        if (req.name === 'draft_advice') throw new Error('boom');
        return base.structured(req);
      },
    };
    const { repo, persisted } = makeRepo();
    const state = await invoke(repo, llm);

    expect(state.card).toBeNull();
    expect(state.notices).toContain(GENERATION_FAILURE_NOTICE);
    expect(persisted).toHaveLength(0);
  });
});

describe('不出卡的情况', () => {
  it('数据不足 → 说明缺什么，不落库', async () => {
    const { repo, persisted } = makeRepo({
      async computeTarget() {
        return { status: 'insufficient', missing: ['sets', 'baseline'] };
      },
    });
    const state = await invoke(repo);
    expect(state.card).toBeNull();
    expect(state.lookup_status).toBe('insufficient');
    expect(state.missing).toEqual(['sets', 'baseline']);
    expect(state.notices.join('')).toContain('有效组');
    expect(state.notices.join('')).toContain('第一次');
    expect(persisted).toHaveLength(0);
  });

  it('指定记录不存在 → 明确说没有这条', async () => {
    const { repo } = makeRepo({
      async resolveSession() {
        return { status: 'not_found' };
      },
    });
    const state = await invoke(repo);
    expect(state.card).toBeNull();
    expect(state.notices).toContain('没有这条训练记录');
  });

  it('一条训练都没有 → 提示先录训练', async () => {
    const { repo } = makeRepo({
      async resolveSession() {
        return { status: 'none' };
      },
    });
    const state = await invoke(repo);
    expect(state.card).toBeNull();
    expect(state.notices).toContain(NO_RECORD_NOTICE);
  });
});
