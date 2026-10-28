import { TurnResponseSchema, type TurnResponse } from '../contracts/turn.js';
import { buildTurnGraph } from '../graph/turn.js';
import { TurnState } from '../graph/state.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { answerKnowledge } from '../knowledge/service.js';
import { assessRecord } from './assessment.js';
import {
  assistantSummary,
  loadRecentHistory,
  resolveConversation,
  touchConversation,
} from './conversation.js';
import { applyWeightCorrection, parseWeightCorrection } from './correction.js';
import { loadTrainingBand, logTurn, persistWorkout } from './record.js';
import { bodyweightOn } from './profile.js';
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
    bodyweightFor: (input) => bodyweightOn(input.user_id, input.date),
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
  const conversation_id = await resolveConversation({
    user_id,
    conversation_id: input.conversation_id,
    first_message: input.message,
  });

  // 窄修正先走确定性路径 —— 不进 LLM，不猜动作
  const correction = parseWeightCorrection(input.message);
  if (correction) {
    const result = await applyWeightCorrection({ user_id, ...correction });
    const card =
      result.status === 'applied' ? result.card : { kind: 'chat' as const, reply: result.reply };
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
    return finish({ user_id, conversation_id, response });
  }

  const [training_years_band, history] = await Promise.all([
    loadTrainingBand(user_id),
    loadRecentHistory(conversation_id),
  ]);

  const final = await turnGraph(createLlmClient()).invoke({
    message: input.message,
    user_id,
    history,
    training_years_band,
  });

  // 出口校验：图交出来的状态必须满足对外契约
  const state = TurnState.parse(final);

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

  return finish({ user_id, conversation_id, response });
}