import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  AssessmentCardSchema,
  type AdviceClaim,
  type AssessmentCard,
  type Citation,
} from '../contracts/assessment.js';
import type { VolumeHook } from '../contracts/metrics.js';
import {
  AssessmentState,
  NO_SOURCE_NOTICE,
  RETRIEVAL_FAILURE_NOTICE,
  buildAssessmentGraph,
} from '../graph/assessment.js';
import type { AssessmentRepo, PersistAssessmentInput, RetrieveResult } from '../assessment/repo.js';
import { ragConfig } from '../assessment/types.js';
import { createEmbeddingClient, type EmbeddingClient } from '../kb/embedding.js';
import { visiblePlatforms } from '../kb/platforms.js';
import { createRerankClient, type RerankClient } from '../kb/rerank.js';
import { assessment, citation, knowledgeChunk, knowledgeSource, userProfile, workoutSession } from '../db/schema.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { prevSameSplitVolume, sessionVolume } from './metrics.js';
import { getDb } from './pool.js';

/**
 * 评估链路的服务层 —— 图只认 `AssessmentRepo`，落库 / 检索都在这里。
 * 🔴 服务层是唯一可以直接 import `db/schema` 的地方。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 钩子重复点击的幂等窗口（技术默认，定义文档 §1.2） */
export const HOOK_IDEMPOTENCY_MS = 10 * 60 * 1000;

export interface AssessmentRepoOptions {
  embedder: EmbeddingClient;
  reranker: RerankClient;
}

async function loadGoal(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ goal: userProfile.goal })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);
  return rows[0]?.goal ?? null;
}

export function createAssessmentRepo({ embedder, reranker }: AssessmentRepoOptions): AssessmentRepo {
  const meta = {
    embedding_model: embedder.model,
    rerank_model: reranker.model,
    rerank_degraded: false,
  };

  return {
    async resolveSession({ user_id, related_record_id }) {
      const db = getDb();

      if (related_record_id) {
        if (!UUID_RE.test(related_record_id)) return { status: 'not_found' };
        const rows = await db
          .select({ id: workoutSession.id, date: workoutSession.date, splitLabel: workoutSession.splitLabel })
          .from(workoutSession)
          .where(and(eq(workoutSession.id, related_record_id), eq(workoutSession.userId, user_id)))
          .limit(1);
        const row = rows[0];
        if (!row) return { status: 'not_found' };
        return {
          status: 'ok',
          session: { session_id: row.id, session_date: row.date, split_label: row.splitLabel },
        };
      }

      const rows = await db
        .select({ id: workoutSession.id, date: workoutSession.date, splitLabel: workoutSession.splitLabel })
        .from(workoutSession)
        .where(eq(workoutSession.userId, user_id))
        .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
        .limit(1);
      const row = rows[0];
      if (!row) return { status: 'none' };
      return {
        status: 'ok',
        session: { session_id: row.id, session_date: row.date, split_label: row.splitLabel },
      };
    },

    async computeTarget({ user_id, session }) {
      const volume = await sessionVolume(session.session_id);
      if (!volume) return { status: 'insufficient', missing: ['sets'] };

      const missing: string[] = [];
      if (volume.working_sets === 0) missing.push('sets');
      if (session.split_label === null) missing.push('split_label');

      // 没有 split 就没有「上一次同 split」—— 不拿历史平均凑基线
      let baseline: number | null = null;
      if (session.split_label !== null) {
        baseline = await prevSameSplitVolume({
          user_id,
          split_label: session.split_label,
          exclude_session_id: session.session_id,
        });
        if (baseline === null) missing.push('baseline');
      }

      if (missing.length > 0) return { status: 'insufficient', missing };

      return {
        status: 'ok',
        target: {
          ...session,
          goal: await loadGoal(user_id),
          verdict: buildVolumeHook({
            current: volume.total_volume_kg,
            baseline,
            split_label: session.split_label,
          }),
        },
      };
    },

    async retrieve({ query }): Promise<RetrieveResult> {
      let vector: number[] | undefined;
      try {
        [vector] = await embedder.embed([query]);
      } catch (e) {
        return { status: 'error', message: (e as Error).message, meta };
      }
      if (!vector) return { status: 'error', message: 'embedding 返回空向量', meta };

      const cfg = ragConfig();
      // pgvector 接受字符串字面量再转 vector —— 不用拼 SQL
      const vec = sql`${JSON.stringify(vector)}::vector`;
      const distance = sql`${knowledgeChunk.embedding} <=> ${vec}`;

      let rows: {
        chunk_id: string;
        source_id: string;
        creator: string;
        title: string;
        url: string;
        start_ts: number;
        chunk_text: string;
        context_prefix: string;
        similarity: number;
      }[];
      try {
        rows = await getDb()
          .select({
            chunk_id: knowledgeChunk.id,
            source_id: knowledgeSource.id,
            creator: knowledgeSource.creator,
            title: knowledgeSource.title,
            url: knowledgeSource.originalUrl,
            start_ts: knowledgeChunk.startTs,
            chunk_text: knowledgeChunk.text,
            context_prefix: knowledgeChunk.contextPrefix,
            similarity: sql<number>`1 - (${distance})`.as('similarity'),
          })
          .from(knowledgeChunk)
          .innerJoin(knowledgeSource, eq(knowledgeChunk.sourceId, knowledgeSource.id))
          .where(
            and(
              eq(knowledgeChunk.isCitable, true),
              eq(knowledgeSource.isIndexable, true),
              eq(knowledgeSource.complianceStatus, 'ok'),
              // 防串味：查询向量与库里向量必须同模型版本
              eq(knowledgeChunk.embeddingModel, embedder.model),
              inArray(knowledgeSource.platform, visiblePlatforms()),
              sql`1 - (${distance}) >= ${cfg.minSimilarity}`,
            ),
          )
          .orderBy(distance)
          .limit(cfg.topK);
      } catch (e) {
        return { status: 'error', message: (e as Error).message, meta };
      }

      const candidates = rows.map((r) => ({ ...r, similarity: Number(r.similarity), rerank_score: 0 }));
      if (candidates.length === 0) return { status: 'ok', candidates: [], meta };

      try {
        const hits = await reranker.rerank({
          query,
          documents: candidates.map((c) => `${c.context_prefix}\n${c.chunk_text}`),
          topN: cfg.topN,
        });
        const ranked = hits.flatMap((h) => {
          const found = candidates[h.index];
          return found ? [{ ...found, rerank_score: h.score }] : [];
        });
        if (ranked.length === 0) {
          return { status: 'ok', candidates: candidates.slice(0, cfg.topN), meta: { ...meta, rerank_degraded: true } };
        }
        return { status: 'ok', candidates: ranked.slice(0, cfg.topN), meta };
      } catch {
        // 重排挂了不降级为无源：向量顺序继续走闸②，只是召回质量降级
        return { status: 'ok', candidates: candidates.slice(0, cfg.topN), meta: { ...meta, rerank_degraded: true } };
      }
    },

    async persist(input: PersistAssessmentInput) {
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .insert(assessment)
          .values({
            userId: input.user_id,
            trigger: input.trigger,
            relatedRecordId: input.related_record_id,
            verdictJson: input.verdict,
            adviceText: input.advice_text,
            adviceClaims: input.advice_claims,
            hasSource: input.has_source,
            modelVersion: input.model_version,
            judgeModelVersion: input.judge_model_version,
            pipelineMeta: input.pipeline_meta,
          })
          .returning({ id: assessment.id });

        if (!row) throw new Error('assessment 插入没有返回 id');

        if (input.citations.length > 0) {
          await tx.insert(citation).values(
            input.citations.map((c, i) => ({
              id: c.citation_id,
              assessmentId: row.id,
              chunkId: c.chunk_id,
              urlWithTs: c.url_with_ts,
              displayOrder: i,
              usabilityStatus: '可用',
              quoteStart: c.quote_start,
              quoteEnd: c.quote_end,
            })),
          );
        }

        return { assessment_id: row.id, citation_ids: input.citations.map((c) => c.citation_id) };
      });
    },
  };
}

interface AssessmentRow {
  id: string;
  trigger: string;
  verdictJson: unknown;
  adviceText: string;
  adviceClaims: unknown;
  hasSource: boolean;
  pipelineMeta: unknown;
}

/** 从库里还原一张评估卡 —— 引用句按偏移从 chunk 原文取回，不存副本 */
async function cardFromRow(row: AssessmentRow): Promise<AssessmentCard> {
  const rows = await getDb()
    .select({
      id: citation.id,
      urlWithTs: citation.urlWithTs,
      quoteStart: citation.quoteStart,
      quoteEnd: citation.quoteEnd,
      creator: knowledgeSource.creator,
      title: knowledgeSource.title,
      startTs: knowledgeChunk.startTs,
      chunkText: knowledgeChunk.text,
    })
    .from(citation)
    .leftJoin(knowledgeChunk, eq(citation.chunkId, knowledgeChunk.id))
    .leftJoin(knowledgeSource, eq(knowledgeChunk.sourceId, knowledgeSource.id))
    .where(eq(citation.assessmentId, row.id))
    .orderBy(citation.displayOrder);

  const citations: Citation[] = rows.flatMap((r) => {
    if (r.chunkText === null || r.creator === null || r.title === null || r.startTs === null) return [];
    if (r.quoteStart === null || r.quoteEnd === null) return [];
    const shortQuote = r.chunkText.slice(r.quoteStart, r.quoteEnd);
    if (!shortQuote) return [];
    return [
      {
        citation_id: r.id,
        creator: r.creator,
        title: r.title,
        url: r.urlWithTs,
        start_ts: r.startTs,
        short_quote: shortQuote,
      },
    ];
  });

  const reason = (row.pipelineMeta as { no_source_reason?: string | null } | null)?.no_source_reason;
  return AssessmentCardSchema.parse({
    kind: 'assessment',
    assessment_id: row.id,
    trigger: row.trigger,
    verdict: row.verdictJson as VolumeHook,
    advice: row.adviceText,
    advice_claims: row.adviceClaims as AdviceClaim[],
    has_source: row.hasSource,
    citations,
    no_source_notice: row.hasSource
      ? null
      : reason === 'retrieval_error'
        ? RETRIEVAL_FAILURE_NOTICE
        : NO_SOURCE_NOTICE,
  });
}

/** 同一记录 + hook 在 10 分钟内只评估一次 —— 不重复花钱 */
export async function findRecentHookAssessment(input: {
  user_id: string;
  related_record_id: string;
}): Promise<AssessmentCard | null> {
  const rows = await getDb()
    .select()
    .from(assessment)
    .where(
      and(
        eq(assessment.userId, input.user_id),
        eq(assessment.relatedRecordId, input.related_record_id),
        eq(assessment.trigger, 'hook'),
        gt(assessment.createdAt, new Date(Date.now() - HOOK_IDEMPOTENCY_MS)),
      ),
    )
    .orderBy(desc(assessment.createdAt))
    .limit(1);

  const row = rows[0];
  return row ? cardFromRow(row) : null;
}

export interface AssessRecordInput {
  user_id: string;
  related_record_id: string | null;
  trigger: 'explicit' | 'hook';
}

export interface AssessActionResult {
  card: AssessmentCard | null;
  notices: string[];
  lookup_status: 'ok' | 'none' | 'not_found' | 'insufficient';
}

let cachedGraph: ReturnType<typeof buildAssessmentGraph> | null = null;

function assessmentGraph(llm: LlmClient) {
  cachedGraph ??= buildAssessmentGraph({
    llm,
    repo: createAssessmentRepo({ embedder: createEmbeddingClient(), reranker: createRerankClient() }),
    now: () => new Date(),
  });
  return cachedGraph;
}

export async function assessRecord(input: AssessRecordInput): Promise<AssessActionResult> {
  if (input.trigger === 'hook' && input.related_record_id) {
    const cached = await findRecentHookAssessment({
      user_id: input.user_id,
      related_record_id: input.related_record_id,
    });
    if (cached) return { card: cached, notices: [], lookup_status: 'ok' };
  }

  const final = await assessmentGraph(createLlmClient()).invoke({
    user_id: input.user_id,
    related_record_id: input.related_record_id,
    trigger: input.trigger,
  });
  const state = AssessmentState.parse(final);

  return { card: state.card, notices: state.notices, lookup_status: state.lookup_status };
}
