import { END, START, StateGraph } from '@langchain/langgraph';
import { ExtractionSchema, IntentResultSchema } from '../contracts/extraction.js';
import type { WorkoutCard, WorkoutCardExercise, WorkoutCardSet } from '../contracts/turn.js';
import { resolveDate } from '../extraction/dates.js';
import { normalizeExerciseName } from '../extraction/normalize.js';
import { computeStatus } from '../extraction/status.js';
import { toKilograms } from '../extraction/units.js';
import { CHAT_SYSTEM, EXTRACTION_SYSTEM, INTENT_SYSTEM } from '../llm/prompts.js';
import type { PersistExerciseInput, TurnDeps } from './deps.js';
import { checkGuard } from './guard.js';
import { boundaryReply, composeNotice, refusalReply } from './replies.js';
import { TurnState } from './state.js';

/**
 * 录入主图 —— dev-002 把 PRD §2.1 这张图从桩变成真的。
 *
 * 三个出口（reject / boundary / chat）+ 录入链路；**评估子图不在这里**（dev-005），
 * 因此「纯求评估」与「混合意图的后半段」都停在落库为止。
 */
export function buildTurnGraph(deps: TurnDeps) {
  const now = deps.now ?? (() => new Date());

  return (
    new StateGraph(TurnState)
      // ── 规则闸：确定性，先于任何 LLM 调用 ──
      .addNode('preflight_guard', (state) => {
        const hit = checkGuard(state.message);
        if (hit) return { guard_verdict: hit.verdict };
        // 档案里写着「不足 3 个月」也走边界出口（ADR-003 的落点）
        if (state.training_years_band === 'lt_3m') return { guard_verdict: 'non_target_user' as const };
        return { guard_verdict: 'pass' as const };
      })

      .addNode('classify_intent', async (state) => {
        const out = await deps.llm.structured({
          system: INTENT_SYSTEM,
          input: state.message,
          schema: IntentResultSchema,
          name: 'intent',
        });
        return { intent: out.intent };
      })

      .addNode('extract_record', async (state) => {
        const extracted = await deps.llm.structured({
          system: EXTRACTION_SYSTEM,
          input: state.message,
          schema: ExtractionSchema,
          name: 'extraction',
        });
        return { extracted };
      })

      .addNode('persist_record', async (state) => {
        const extracted = state.extracted;
        // 饮食只手握契约：不落库（ADR-022 决定三）
        if (!extracted || extracted.kind === 'meal') return {};

        const date = resolveDate(extracted.day_hint, now());
        const { status, missing_fields } = computeStatus(extracted);

        const rows: PersistExerciseInput[] = [];
        const cards: WorkoutCardExercise[] = [];

        for (const [i, ex] of extracted.exercises.entries()) {
          const norm = normalizeExerciseName(ex.raw_name);
          const sets: (WorkoutCardSet & { order: number })[] = ex.mentioned_sets.map((s, j) => {
            const conv = toKilograms(s.weight_kg, s.weight_unit, s.is_inferred);
            return {
              order: j,
              weight_kg: conv.weight_kg,
              reps: s.reps,
              set_type: s.set_type,
              is_inferred: conv.is_inferred,
            };
          });

          cards.push({
            raw_name: ex.raw_name,
            exercise_id: norm.exercise_id,
            name_zh: norm.name_zh,
            region_fallback: norm.region_fallback,
            name_confidence: ex.name_confidence,
            sets: sets.map((s) => ({
              weight_kg: s.weight_kg,
              reps: s.reps,
              set_type: s.set_type,
              is_inferred: s.is_inferred,
            })),
          });

          rows.push({
            order: i,
            raw_name: ex.raw_name,
            exercise_id: norm.exercise_id,
            name_confidence: ex.name_confidence,
            region_fallback: norm.region_fallback,
            sets,
          });
        }

        const { session_id } = await deps.persistWorkout({
          user_id: state.user_id,
          date,
          split_label: extracted.split_label,
          status,
          missing_fields,
          notes: extracted.note,
          exercises: rows,
        });

        return {
          record_ref: { type: 'workout' as const, id: session_id },
          record_status: status,
          missing_fields,
          session_date: date,
          card_exercises: cards,
        };
      })

      .addNode('compose_card', (state) => {
        const extracted = state.extracted;

        if (extracted?.kind === 'meal') {
          return {
            card: {
              kind: 'meal' as const,
              meal_type: extracted.meal_type,
              items: extracted.items,
            },
            notices: [],
          };
        }

        const ref = state.record_ref;
        // ⚠️ 不含数据钩子：钩子是一个算好的判定，属 dev-003
        if (!ref || ref.type !== 'workout') return {};

        const card: WorkoutCard = {
          kind: 'workout',
          session_id: ref.id,
          date: state.session_date ?? resolveDate(extracted?.day_hint ?? null, now()),
          split_label: extracted?.split_label ?? null,
          status: state.record_status ?? 'incomplete',
          missing_fields: state.missing_fields,
          exercises: state.card_exercises,
          note: extracted?.note ?? null,
        };
        return { card, notices: composeNotice(state.card_exercises, state.missing_fields) };
      })

      .addNode('chat_node', async (state) => {
        const reply = await deps.llm.generate({ system: CHAT_SYSTEM, input: state.message });
        return { card: { kind: 'chat' as const, reply } };
      })

      .addNode('reject_node', (state) => {
        // 措辞取自规则表，不重跑 LLM —— 红线内容不允许被即兴改写
        const hit = checkGuard(state.message);
        const reason = hit && hit.reason !== 'non_target' ? hit.reason : 'off_topic';
        return { card: { kind: 'refusal' as const, reply: refusalReply(reason), reason } };
      })

      .addNode('boundary_node', () => ({
        card: { kind: 'boundary' as const, reply: boundaryReply() },
      }))

      .addEdge(START, 'preflight_guard')
      .addConditionalEdges('preflight_guard', (state) => {
        if (state.guard_verdict === 'pass') return 'classify_intent';
        if (state.guard_verdict === 'non_target_user') return 'boundary_node';
        return 'reject_node';
      })
      .addConditionalEdges('classify_intent', (state) => {
        if (state.intent === 'record' || state.intent === 'mixed') return 'extract_record';
        if (state.intent === 'chat') return 'chat_node';
        if (state.intent === 'boundary') return 'boundary_node';
        if (state.intent === 'reject') return 'reject_node';
        // 纯求评估：dev-002 没有评估链路，到此为止（卡片在服务层补一条说明）
        return END;
      })
      .addEdge('extract_record', 'persist_record')
      .addEdge('persist_record', 'compose_card')
      // 混合意图那条边在 dev-002 走到「只落库、不评估」为止
      .addEdge('compose_card', END)
      .addEdge('chat_node', END)
      .addEdge('reject_node', END)
      .addEdge('boundary_node', END)
      .compile()
  );
}

export type TurnGraph = ReturnType<typeof buildTurnGraph>;