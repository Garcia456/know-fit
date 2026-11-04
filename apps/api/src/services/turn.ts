import { TurnResponseSchema, type TurnResponse } from '../contracts/turn.js';
import { buildTurnGraph } from '../graph/turn.js';
import { TurnState } from '../graph/state.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { answerKnowledge } from '../knowledge/service.js';
import { assessRecord } from './assessment.js';
import {
  assistantSummary,
  deleteConversation,
  loadRecentHistory,
  resolveConversation,
  touchConversation,
} from './conversation.js';
import { applyWeightCorrection, parseWeightCorrection } from './correction.js';
import { applyEdit } from './edit.js';
import { answerQuery } from './query.js';
import { answerPlan } from './plan.js';
import { loadTrainingBand, logTurn, persistWorkout } from './record.js';
import { bodyweightOn, getProfile, saveWeight } from './profile.js';
import { volumeHookFor } from './metrics.js';

/**
 * 一轮对话的入口 —— 路由只调它，它来组装图与依赖。
 */

export interface TurnInput {
  message: string;
user_id: string;
  conversation_id?: string | null;
}

let cached: ReturnType<typeof buildTurnGraph> | null = null;

function turnGraph(llm: LlmClient) {
  cached ??= buildTurnGraph({
    llm,
    persistWorkout,
    computeHook: volumeHookFor,
    assess: assessRecord,
    answerKnowledge: (input) => answerKnowledge({ user_id: input.user_id, query: input.query }),
    answerPlan: (input) => answerPlan(input),
    bodyweightFor: (input) => bodyweightOn(input.user_id, input.date),
    recordWeight: (input) => saveWeight(input),
    applyEdit: (input) => applyEdit(input),
    answerQuery: (input) => answerQuery(input),
    now: () => new Date(),
  });
  return cached;
}

/** 写助手轮 + 会话时间，再返回响应 */
async function finish(input: {
  user_id: string;
  conversation_id: string;
  response: TurnResponse;
}): Promise<TurnResponse> {
  await logTurn({
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    message: assistantSummary(input.response),
    intent: input.response.intent,
    linked_record_id: null,
    role: 'assistant',
    response: input.response,
  });
  await touchConversation(input.conversation_id);
  return input.response;
}

export async function handleTurn(input: TurnInput): Promise<TurnResponse> {
  const user_id = input.user_id;

  // 已有会话先校验归属；新会话等这一轮真成功了再建 —— 失败不留空会话
  const existingId = input.conversation_id
    ? await resolveConversation({
        user_id,
        conversation_id: input.conversation_id,
        first_message: input.message,
      })
    : null;
  let createdId: string | null = null;

  /** 新会话的创建点只有「这轮已经走通」之后 */
  async function conversationId(): Promise<string> {
    if (existingId) return existingId;
    createdId = await resolveConversation({ user_id, first_message: input.message });
    return createdId;
  }

  try {
    // 窄修正先走确定性路径 —— 不进 LLM，不猜动作
    const correction = parseWeightCorrection(input.message);
    if (correction) {
      const result = await applyWeightCorrection({ user_id, ...correction });
      const card =
        result.status === 'applied' ? result.card : { kind: 'chat' as const, reply: result.reply };
      const conversation_id = await conversationId();
      const response = TurnResponseSchema.parse({
        turn_id: await logTurn({
          user_id,
          conversation_id,
          message: input.message,
          intent: 'record',
          linked_record_id: result.status === 'applied' ? result.card.session_id : null,
        }),
        conversation_id,
        intent: 'record',
        card,
        assessment: null,
        assessment_lookup: null,
        notices: [],
      });
      return await finish({ user_id, conversation_id, response });
    }

    // 新会话没有历史可带
    const history = existingId ? await loadRecentHistory(existingId) : [];
    const training_years_band = await loadTrainingBand(user_id);
    const profile = await getProfile(user_id);

    const final = await turnGraph(createLlmClient()).invoke({
      message: input.message,
      user_id,
      history,
      training_years_band,
      profile_training_frequency: profile.training_frequency,
      profile_goal: profile.goal,
    });

    // 出口校验：图交出来的状态必须满足对外契约
    const state = TurnState.parse(final);

    const conversation_id = await conversationId();
    const response = TurnResponseSchema.parse({
      turn_id: await logTurn({
        user_id,
        conversation_id,
        message: input.message,
        intent: state.intent,
        linked_record_id: state.record_ref?.id ?? null,
      }),
      conversation_id,
      intent: state.intent,
      card: state.card,
      assessment: state.assessment,
      assessment_lookup: state.assessment_lookup,
      notices: state.notices,
    });

    return await finish({ user_id, conversation_id, response });
  } catch (error) {
    // 这一轮没成：刚建的空会话删掉，别让它出现在抽屉里
    if (createdId) await deleteConversation(user_id, createdId).catch(() => undefined);
    throw error;
  }
}