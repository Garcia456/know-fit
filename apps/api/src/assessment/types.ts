import type { VolumeHook } from '../contracts/metrics.js';
import type { GateWindow } from './windows.js';

/** 检索到的候选 —— `chunk_text` / `windows` 只供图内使用，**出图前必须丢掉**（不是对外契约） */
export interface AssessmentCandidate {
  chunk_id: string;
  source_id: string;
  creator: string;
  title: string;
  url: string;
  start_ts: number;
  chunk_text: string;
  /** 闸② 的编号窗口 —— 模型只选窗口，引文由服务端切 */
  windows: GateWindow[];
  context_prefix: string;
  similarity: number;
  rerank_score: number;
}

/** 目标训练的最小标识 —— 先定位，再算判定（两步各自可测） */
export interface SessionRef {
  session_id: string;
  session_date: string;
  split_label: string | null;
}

export interface AssessmentTarget extends SessionRef {
  /** 档案里的目标；为空时 query 用「训练」，不猜 */
  goal: string | null;
  /** 本次训练的主要部位（ADR-039）—— 取不到就是空数组 */
  body_parts: string[];
  verdict: VolumeHook;
}

export type SessionLookup =
  | { status: 'ok'; session: SessionRef }
  | { status: 'none' } // 一条训练都没有
  | { status: 'not_found' }; // 指定的 id 不存在 / 不属于该用户

export type TargetLookup =
  | { status: 'ok'; target: AssessmentTarget }
  | { status: 'insufficient'; missing: string[] }; // 有记录，但数字还不足以判断趋势

export type NoSourceReason =
  | 'no_candidate'
  | 'gate2_reject'
  | 'retrieval_error'
  | 'generator_no_source_claim'
  | 'draft_invalid'
  | 'generation_failed';

export interface PipelineMeta {
  embedding_model: string;
  rerank_model: string;
  rerank_degraded: boolean;
  no_source_reason: NoSourceReason | null;
}

export interface RagConfig {
  topK: number;
  topN: number;
  minSimilarity: number;
  maxCitations: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} 不是数字：「${raw}」`);
  return n;
}

/** 检索参数全部可配 —— 0.5 是推断初值，靠 pilot 反调 */
export function ragConfig(): RagConfig {
  return {
    topK: num('RAG_TOP_K', 50),
    topN: num('RAG_TOP_N', 5),
    minSimilarity: num('RAG_MIN_SIMILARITY', 0.5),
    maxCitations: num('RAG_MAX_CITATIONS', 2),
  };
}