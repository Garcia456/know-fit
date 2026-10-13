import { TurnResponseSchema, type TurnResponse } from '../contracts/turn.js';
import { buildTurnGraph } from '../graph/turn.js';
import { SINGLE_USER_ID, TurnState } from '../graph/state.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { loadTrainingBand, logTurn, persistWorkout } from './record.js';

/**
 * 一轮对话的入口 —— 路由只调它，它来组装图与依赖。
 */

export interface TurnInput {
  message: string;
  user_id?: string;
}

let cached: ReturnType<typeof buildTurnGraph> | null = null;

function turnGraph(llm: LlmClient) {
  cached ??= buildTurnGraph({ llm, persistWorkout, now: () => new Date() });
  return cached;
}

/**
 * ⚠️ 纯求评估时 dev-002 没有评估链路，如实说「没有可评估的数据」——
 *    **不等于**评估能力已经存在（那是 dev-005）。
 */
const ASSESS_NOTICE = '这条没带新记录 —— 我手上还没有可评估的数据，先记一条训练我再看';

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

  let notices = state.notices;
  if (!notices.length && !state.card && state.intent === 'assess') notices = [ASSESS_NOTICE];

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
    notices,
  });
}