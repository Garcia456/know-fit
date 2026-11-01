/**
 * 前端只镜像用到的对外契约字段。
 * 🔴 不出现 text / content / transcript —— 界面没有渲染全文的通道（ADR-008）。
 */

export type Intent =
  | 'record'
  | 'edit'
  | 'query'
  | 'assess'
  | 'mixed'
  | 'knowledge'
  | 'chat'
  | 'reject'
  | 'boundary'
  | 'weight';
export type RecordStatus = 'complete' | 'incomplete';
export type MissingField = 'exercises' | 'reps' | 'weight_kg';
export type RefusalReason = 'medical' | 'medication' | 'extreme_diet' | 'off_topic';
export type SetType = 'warmup' | 'working';
export type SetTag = 'failure' | 'drop' | 'rest_pause';
export interface SetDrop {
  weight_kg: number | null;
  reps: number | null;
}
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface VolumeHook {
  metric: 'volume';
  scope: { split_label: string | null };
  current: number;
  baseline: number | null;
  delta_pct: number | null;
  baseline_kind: 'prev_same_split';
}

export interface Citation {
  citation_id: string;
  creator: string;
  title: string;
  url: string;
  start_ts: number;
  short_quote: string;
}

export interface AdviceClaim {
  claim: string;
  basis: 'personal_data' | 'source';
  citation_id: string | null;
}

export interface AssessmentCard {
  kind: 'assessment';
  assessment_id: string;
  trigger: 'explicit' | 'hook';
  verdict: VolumeHook;
  advice: string;
  advice_claims: AdviceClaim[];
  has_source: boolean;
  citations: Citation[];
  no_source_notice: string | null;
}

export interface WorkoutCardSet {
  weight_kg: number | null;
  reps: number | null;
  set_type: SetType;
  is_inferred: boolean;
  /** 自重动作叠加的体重 */
  bodyweight_kg?: number | null;
  tags?: SetTag[];
  drops?: SetDrop[] | null;
}

export interface WorkoutCardExercise {
  raw_name: string;
  exercise_id: string | null;
  name_zh: string | null;
  region_fallback: string | null;
  name_confidence: 'high' | 'low';
  is_bodyweight?: boolean;
  sets: WorkoutCardSet[];
  volume_kg: number;
  working_sets: number;
}

export interface WorkoutCard {
  kind: 'workout';
  session_id: string;
  date: string;
  split_label: string | null;
  status: RecordStatus;
  missing_fields: MissingField[];
  exercises: WorkoutCardExercise[];
  volume_kg: number;
  working_sets: number;
  note: string | null;
  hook: VolumeHook | null;
}

export interface MealItem {
  raw_desc: string;
  qty: number | null;
  unit: string | null;
  qty_confidence: 'high' | 'low';
  estimation_basis: string | null;
}

export interface MealCard {
  kind: 'meal';
  meal_type: MealType | null;
  items: MealItem[];
}

export interface ChatCard {
  kind: 'chat';
  reply: string;
}

export interface KnowledgeClaim {
  claim: string;
  citation_id: string | null;
}

export interface KnowledgeCard {
  kind: 'knowledge';
  answer: string;
  claims: KnowledgeClaim[];
  citations: Citation[];
  has_source: boolean;
  no_source_notice: string | null;
}

export interface RefusalCard {
  kind: 'refusal';
  reply: string;
  reason: RefusalReason;
}

export interface BoundaryCard {
  kind: 'boundary';
  reply: string;
}

export interface CorrectionCard {
  kind: 'correction';
  session_id: string;
  date: string;
  split_label: string | null;
  exercise_index: number;
  old_weight_kg: number;
  new_weight_kg: number;
  corrected_sets: number;
  exercises: WorkoutCardExercise[];
  volume_kg: number;
  working_sets: number;
}

export interface WeightCard {
  kind: 'weight';
  date: string;
  weight_kg: number;
}

export type TurnCard =
  | WorkoutCard
  | MealCard
  | ChatCard
  | KnowledgeCard
  | RefusalCard
  | BoundaryCard
  | CorrectionCard
  | WeightCard;

export interface AssessmentLookup {
  status: 'ok' | 'none' | 'not_found' | 'insufficient';
  missing: string[];
}

export interface TurnResponse {
  turn_id: string;
  conversation_id: string;
  intent: Intent;
  card: TurnCard | null;
  assessment: AssessmentCard | null;
  assessment_lookup: AssessmentLookup | null;
  notices: string[];
}

export interface AssessmentResponse {
  card: AssessmentCard | null;
  notices: string[];
  lookup_status: 'ok' | 'none' | 'not_found' | 'insufficient';
  missing: string[];
}

export interface SessionListItem {
  session_id: string;
  date: string;
  split_label: string | null;
  status: RecordStatus;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
}

export interface SessionExercise {
  raw_name: string;
  exercise_id: string | null;
  name_zh: string | null;
  region_fallback: string | null;
  name_confidence: 'high' | 'low' | null;
  is_bodyweight?: boolean;
  sets: WorkoutCardSet[];
}

export interface SessionVolume {
  session_id: string;
  total_volume_kg: number;
  working_sets: number;
  warmup_sets: number;
  skipped_sets: number;
  inferred_sets: number;
  by_muscle: Record<string, number>;
  unrecognized_exercises: number;
}

export interface WeeklyVolumePoint {
  week_start: string;
  total_volume_kg: number;
  working_sets: number;
}

export interface WeeklyVolume {
  weeks: WeeklyVolumePoint[];
  this_week_kg: number;
  last_week_kg: number;
  delta_pct: number | null;
}

export interface WeightPoint {
  date: string;
  weight_kg: number;
}

export interface WeightHistory {
  points: WeightPoint[];
  latest: WeightPoint | null;
  delta_kg: number | null;
}

export interface StatsDay {
  date: string;
  total_volume_kg: number;
  working_sets: number;
}

export interface StatsRange {
  from: string;
  to: string;
  days: StatsDay[];
  total_volume_kg: number;
  working_sets: number;
  training_days: number;
  by_muscle: Record<string, number>;
  weight_points: WeightPoint[];
  weight_latest: WeightPoint | null;
  weight_delta_kg: number | null;
}

export interface HistoryItem {
  session_id: string;
  date: string;
  split_label: string | null;
  status: RecordStatus;
  missing_fields: MissingField[];
  exercise_count: number;
  working_sets: number;
  volume_kg: number;
  exercise_names: string[];
}

export interface HistoryResponse {
  items: HistoryItem[];
}

export interface SessionDetail {
  session_id: string;
  date: string;
  split_label: string | null;
  status: RecordStatus;
  missing_fields: MissingField[];
  note: string | null;
  exercises: SessionExercise[];
  volume: SessionVolume;
  hook: VolumeHook;
}

export type Gender = '男' | '女' | '其他';

/** 账号资料 —— 与身体档案（Profile）是两件事。 */
export interface Account {
  id: string;
  email: string;
  nickname: string;
  birthday: string | null;
  gender: Gender | null;
  bio: string | null;
  /** 压缩后的图片 data URL；null = 用昵称首字 */
  avatar: string | null;
  age: number | null;
  created_at: string;
}

export interface AccountInput {
  nickname: string;
  birthday: string | null;
  gender: Gender | null;
  bio: string | null;
  avatar?: string | null;
}

export interface ClearTrainingResult {
  sessions: number;
  assessments: number;
  turns: number;
  nudges: number;
}

export type Goal = '增肌' | '减脂' | '维持' | '增肌+减脂';

export interface Profile {
  height_cm: number | null;
  weight_kg: number | null;
  weight_date: string | null;
  goal: Goal | null;
  training_years: number | null;
  training_months: number | null;
  updated_at: string;
}

export type ProfileInput = Omit<Profile, 'updated_at' | 'weight_date'>;

export type NudgeType = '补全' | '断流';

export interface Nudge {
  id: string;
  type: NudgeType;
  session_id: string;
  message: string;
}

export interface NudgeNextResponse {
  nudge: Nudge | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
  last_message: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent: Intent | null;
  response: TurnResponse | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
}