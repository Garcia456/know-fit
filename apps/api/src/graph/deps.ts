import type { MissingField, RecordStatus } from '../contracts/extraction.js';
import type { WorkoutCardSet } from '../contracts/turn.js';
import type { LlmClient } from '../llm/client.js';

/** 落库原料 —— 规范化后的动作 + 已换算的组 */
export interface PersistExerciseInput {
  order: number;
  raw_name: string;
  exercise_id: string | null;
  name_confidence: 'high' | 'low';
  region_fallback: string | null;
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

export interface TurnDeps {
  llm: LlmClient;
  /**
   * 落库那一步由调用方注入 —— 图本身不碰 schema。
   * 好处：图可以不连库地测（条件边、卡片），而写库实现留在服务层。
   */
  persistWorkout: (input: PersistWorkoutInput) => Promise<{ session_id: string }>;
  now?: () => Date;
}