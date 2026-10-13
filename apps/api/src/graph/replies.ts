import type { MissingField } from '../contracts/extraction.js';
import type { RefusalReason, WorkoutCardExercise } from '../contracts/turn.js';

/**
 * 模板文案 —— 红线与边界的措辞**不由 LLM 自由生成**（那是内容不许被即兴改写的地方）。
 * ⚠️ 下面是 v1 的草稿文案，作者可随时改；改文案不改逻辑。
 */

const REFUSAL_REPLY: Record<RefusalReason, string> = {
  medical: '涉及伤病或疼痛，我不给建议 —— 先看医生或找康复师，别扛着练。其他训练问题我照旧帮你记。',
  medication: '用药和补剂的剂量属于医疗范畴，我不给建议 —— 问医生或药师。吃和练本身可以聊。',
  extreme_diet: '这类做法有健康风险，我不给方案 —— 想减脂咱们走稳一点的路子，别拿身体赌。',
  off_topic: '这个话题跟训练记录不太相关 —— 我主要还是帮你记练了什么、吃了什么。',
};

const BOUNDARY_REPLY =
  '你的情况需要专业指导 —— 未成年人或有基础疾病时，跟着教练或医生练更稳妥，我给的建议未必适合你。';

export function refusalReply(reason: RefusalReason): string {
  return REFUSAL_REPLY[reason];
}

export function boundaryReply(): string {
  return BOUNDARY_REPLY;
}

/**
 * 补充提示 —— **至多 1 条**（PRD §5.2）。
 * 它是后置的、可选的：不拦录入，用户不理也不会卡住。
 */
export function composeNotice(exercises: WorkoutCardExercise[], missing: MissingField[]): string[] {
  if (missing.includes('exercises')) {
    return ['这条没听出具体动作 —— 下回带上动作名和组数，我就能算训练量了'];
  }
  if (missing.includes('weight_kg')) {
    return ['有几组没说重量，先按「只记次数」存下了'];
  }
  if (missing.includes('reps')) {
    return ['有几组没说次数，先按你说的重量存下了'];
  }
  if (exercises.some((e) => e.name_confidence === 'low')) {
    return ['有个动作名我没把握，卡片上标了低置信 —— 对不上就改一下'];
  }
  return [];
}