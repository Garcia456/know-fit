import { TurnResponseSchema, type TurnResponse } from '../contracts/turn.js';
import { buildTurnGraph } from '../graph/turn.js';
import { SINGLE_USER_ID, TurnState } from '../graph/state.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { assessRecord } from './assessment.js';
import { loadTrainingBand, logTurn, persistWorkout } from './record.js';
import { volumeHookFor } from './metrics.js';

/**
 * 一轮对话的入口 —— 路由只调它，它来组装图与依赖。
 */

export interface TurnInput {
  message: string;
  user_id?: string;
}

let cached: ReturnType<typeof buildTurnGraph> | null = null;

function turnGraph(llm: LlmClient) {
  cached ??= buildTurnGraph({
    llm,
    persistWorkout,
    computeHook: volumeHookFor,
    assess: assessRecord,
    now: () => new Date(),
  });
  return cached;
}

export async function handleTurn(input: TurnInput): Promise<TurnResponse> {
  const user_id = input.user_id ?? SINGLE_USER_ID;
  const training_years_band = await loadTrainingBand(user_id);

  const final = await turnGraph(createLlmClient()).invoke({
    message: input.message,
    user_id,
    training_years_band,
  });

  // 出口校验：图交出来的状态必须满足对外契约
  const state = TurnState.parse(final);

  const notices = state.notices;

  const turn_id = await logTurn({
    user_id,
    message: input.message,
    intent: state.intent,
    linked_record_id: state.record_ref?.id ?? null,
  });

  return TurnResponseSchema.parse({
    turn_id,
    intent: state.intent,
    card: state.card,
    assessment: state.assessment,
    notices,
  });
}