import type { AssessmentCard } from '../contracts/assessment.js';
import type { MissingField, RecordStatus } from '../contracts/extraction.js';
import type { VolumeHook } from '../contracts/metrics.js';
import type { KnowledgeCard, WorkoutCardExercise, WorkoutCardSet } from '../contracts/turn.js';
import type { TurnHistoryItem } from './state.js';
import type { LlmClient } from '../llm/client.js';

/** 落库原料 —— 规范化后的动作 + 已换算的组 */
export interface PersistExerciseInput {
  order: number;
  raw_name: string;
  exercise_id: string | null;
  name_confidence: 'high' | 'low';
  region_fallback: string | null;
  is_bodyweight?: boolean;
  sets: (WorkoutCardSet & { order: number })[];
}

export interface PersistWorkoutInput {
  user_id: string;
  date: string;
  split_label: string | null;
  status: RecordStatus;
  missing_fields: MissingField[];
  notes: string | null;
  exercises: PersistExerciseInput[];
}

export interface HookInput {
  user_id: string;
  session_id: string;
  session_date: string;
  split_label: string | null;
  exercises: WorkoutCardExercise[];
}

export interface AssessInput {
  user_id: string;
  related_record_id: string | null;
  trigger: 'explicit' | 'hook';
}

export interface AssessOutput {
  card: AssessmentCard | null;
  notices: string[];
  lookup_status: 'ok' | 'none' | 'not_found' | 'insufficient';
  missing: string[];
}

export interface TurnDeps {
  llm: LlmClient;
  /**
   * 落库那一步由调用方注入 —— 图本身不碰 schema。
   * 好处：图可以不连库地测（条件边、卡片），而写库实现留在服务层。
   */
  persistWorkout: (input: PersistWorkoutInput) => Promise<{ session_id: string }>;
  /**
   * 数据钩子也由调用方注入 —— 它要读历史记录算环比，同样不归图管。
   * 不注入时卡片不带钩子。
   */
  computeHook?: (input: HookInput) => Promise<VolumeHook>;
  /**
   * 评估子图由调用方注入 —— 知识库故障不能拖垮录入，
   * 所以这条通道失败只降级成一条 notice，不影响卡片。
   */
  assess?: (input: AssessInput) => Promise<AssessOutput>;
  /**
   * 知识问答由调用方注入 —— 它要检索知识库，同样不归图管。
   * 不注入时退化成一条说明。
   */
  answerKnowledge?: (input: {
    user_id: string;
    query: string;
    history: TurnHistoryItem[];
  }) => Promise<KnowledgeCard>;
  /** 自重动作算容量时要叠加的体重（训练日当天或之前最近一次） */
  bodyweightFor?: (input: { user_id: string; date: string }) => Promise<number | null>;
  now?: () => Date;
}