import type { AdviceClaim } from '../contracts/assessment.js';
import type { VolumeHook } from '../contracts/metrics.js';
import type {
  AssessmentCandidate,
  PipelineMeta,
  SessionLookup,
  SessionRef,
  TargetLookup,
} from './types.js';

/**
 * 评估图对外的唯一口子 —— 图不碰库。
 * 实现见 `services/assessment.ts`；测试里注入替身即可脱库跑。
 */

export interface RetrieveMeta {
  embedding_model: string;
  rerank_model: string;
  rerank_degraded: boolean;
  /** 实际生效的每源上限（0 = 未开配额） */
  max_per_source?: number;
  /** 向 rerank 要回的条数 */
  rerank_fetch_n?: number;
  /** top-N 里出现了几个不同来源 */
  distinct_sources?: number;
  /** 来源不足时回填的条数 */
  backfilled?: number;
  /** 降级原因（rerank 报错原文，截断 200 字） */
  rerank_error?: string;
}

export type RetrieveResult =
  | { status: 'ok'; candidates: AssessmentCandidate[]; meta: RetrieveMeta }
  | { status: 'error'; message: string; meta: RetrieveMeta };

export interface CitationInput {
  citation_id: string;
  claim_index: number;
  chunk_id: string;
  url_with_ts: string;
  quote_start: number;
  quote_end: number;
}

export interface PersistAssessmentInput {
  user_id: string;
  trigger: 'explicit' | 'hook';
  related_record_id: string | null;
  verdict: VolumeHook;
  advice_text: string;
  advice_claims: AdviceClaim[];
  has_source: boolean;
  citations: CitationInput[];
  model_version: string;
  judge_model_version: string;
  pipeline_meta: PipelineMeta;
}

export interface AssessmentRepo {
  resolveSession(input: { user_id: string; related_record_id: string | null }): Promise<SessionLookup>;
  computeTarget(input: { user_id: string; session: SessionRef }): Promise<TargetLookup>;
  retrieve(input: { user_id: string; query: string; max_per_source?: number }): Promise<RetrieveResult>;
  persist(input: PersistAssessmentInput): Promise<{ assessment_id: string; citation_ids: string[] }>;
}
