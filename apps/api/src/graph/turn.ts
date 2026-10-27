import { END, START, StateGraph } from '@langchain/langgraph';
import { ExtractionSchema, IntentResultSchema } from '../contracts/extraction.js';
import type { WorkoutCard, WorkoutCardExercise, WorkoutCardSet } from '../contracts/turn.js';
import { resolveDate } from '../extraction/dates.js';
import { normalizeExerciseName } from '../extraction/normalize.js';
import { computeVolume } from '../metrics/volume.js';
import { computeStatus } from '../extraction/status.js';
import { toKilograms } from '../extraction/units.js';
import { CHAT_SYSTEM, EXTRACTION_SYSTEM, INTENT_SYSTEM } from '../llm/prompts.js';
import type { PersistExerciseInput, TurnDeps } from './deps.js';
import { checkGuard } from './guard.js';
import { boundaryReply, composeNotice, refusalReply } from './replies.js';
import { TurnState, type TurnHistoryItem } from './state.js';

/** 空抽取的确定性追问 —— 不交给模型，免得它换个说法又落成记录 */
export const EMPTY_EXTRACTION_REPLY = '这句里没听出训练内容 —— 是想问动作，还是想记训练？';

/** 带指代的问题拼上一轮用户消息 —— v1 不改写 query（ADR-049 §1） */
export function buildKnowledgeQuery(message: string, history: TurnHistoryItem[]): string {
  const previous = [...history].reverse().find((h) => h.role === 'user')?.content;
  if (!previous) return message;
  return /这个|那个|它|这些|那些|还有|再|呢/.test(message) ? `${previous}\n${message}` : message;
}

/** 对话输入带最近 6 轮；没有历史就是这一句 */
export function buildChatInput(message: string, history: TurnHistoryItem[]): string {
  if (history.length === 0) return message;
  const lines = history.map((h) => `${h.role === 'user' ? '用户' : '助手'}：${h.content}`);
  return [`最近对话：`, ...lines, `用户：${message}`].join('\n');
}

/**
 * 录入主图 —— 一句话进来，走到落库与卡片。
 *
 * 三个出口（拒答 / 非目标用户 / 闲聊）+ 录入链路；
 * 评估走独立子图，只在本图的两个位置接一次：纯评估、混合意图落库之后。
 */
export function buildTurnGraph(deps: TurnDeps) {
  const now = deps.now ?? (() => new Date());

  return (
    new StateGraph(TurnState)
      // ── 规则闸：确定性，先于任何 LLM 调用 ──
      .addNode('preflight_guard', (state) => {
        const hit = checkGuard(state.message);
        if (hit) return { guard_verdict: hit.verdict };
        // 档案里写着「不足 3 个月」也走非目标用户出口
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
        // 饮食只手握契约：不落库
        if (!extracted || extracted.kind === 'meal') return {};
        // 🔴 没有动作就不是训练记录 —— 不写库，走追问（ADR-049 §7）
        if (extracted.exercises.length === 0) return { empty_extraction: true };

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

          const exerciseVolume = computeVolume(sets);
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
            volume_kg: exerciseVolume.total_kg,
            working_sets: exerciseVolume.working_sets,
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

      .addNode('compose_card', async (state) => {
        const extracted = state.extracted;

        if (state.empty_extraction) {
          return { card: { kind: 'chat' as const, reply: EMPTY_EXTRACTION_REPLY }, notices: [] };
        }

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
        if (!ref || ref.type !== 'workout') return {};

        const date = state.session_date ?? resolveDate(extracted?.day_hint ?? null, now());
        const split_label = extracted?.split_label ?? null;

        // 数据钩子：算好的容量环比判定。措辞在展示层拼，这里只给数
        const hook = deps.computeHook
          ? await deps.computeHook({
              user_id: state.user_id,
              session_id: ref.id,
              session_date: date,
              split_label,
              exercises: state.card_exercises,
            })
          : null;

        const summary = computeVolume(state.card_exercises.flatMap((e) => e.sets));
        const card: WorkoutCard = {
          kind: 'workout',
          session_id: ref.id,
          date,
          split_label,
          status: state.record_status ?? 'incomplete',
          missing_fields: state.missing_fields,
          exercises: state.card_exercises,
          volume_kg: summary.total_kg,
          working_sets: summary.working_sets,
          note: extracted?.note ?? null,
          hook,
        };
        return { card, notices: composeNotice(state.card_exercises, state.missing_fields) };
      })

      .addNode('assess_node', async (state) => {
        if (!deps.assess) {
          return {
            assessment: null,
            assessment_lookup: null,
            notices: [...state.notices, '评估暂时没生成出来，稍后再试'],
          };
        }
        // 混合意图评估的是本轮刚落库的那条；纯评估评估最近一次（v1 不解析「上周那次」）
        const related =
          state.intent === 'mixed' && state.record_ref?.type === 'workout' ? state.record_ref.id : null;
        try {
          const out = await deps.assess({ user_id: state.user_id, related_record_id: related, trigger: 'explicit' });
          return {
            assessment: out.card,
            assessment_lookup: { status: out.lookup_status, missing: out.missing },
            notices: [...state.notices, ...out.notices],
          };
        } catch {
          // 🔴 录入可用性 > 评估可用性：评估挂了也要把卡片还回去
          return {
            assessment: null,
            assessment_lookup: null,
            notices: [...state.notices, '评估暂时没生成出来，稍后再试'],
          };
        }
      })

      .addNode('chat_node', async (state) => {
        const reply = await deps.llm.generate({
          system: CHAT_SYSTEM,
          input: buildChatInput(state.message, state.history),
        });
        return { card: { kind: 'chat' as const, reply } };
      })

      .addNode('knowledge_node', async (state) => {
        if (!deps.answerKnowledge) {
          return {
            card: {
              kind: 'chat' as const,
              reply: '知识问答暂时用不了 —— 可以先把问题说得具体一点，我再试试。',
            },
          };
        }
        try {
          const card = await deps.answerKnowledge({
            user_id: state.user_id,
            query: buildKnowledgeQuery(state.message, state.history),
            history: state.history,
          });
          return { card };
        } catch {
          return {
            card: {
              kind: 'chat' as const,
              reply: '这次没连上知识库，稍后再问一次。',
            },
          };
        }
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
        if (state.intent === 'assess') return 'assess_node';
        if (state.intent === 'knowledge') return 'knowledge_node';
        if (state.intent === 'chat') return 'chat_node';
        if (state.intent === 'boundary') return 'boundary_node';
        if (state.intent === 'reject') return 'reject_node';
        return END;
      })
      .addEdge('extract_record', 'persist_record')
      .addEdge('persist_record', 'compose_card')
      // 混合意图：先给录入卡片，再评估本轮刚落库的那条（空抽取不评估）
      .addConditionalEdges('compose_card', (state) =>
        state.intent === 'mixed' && state.record_ref?.type === 'workout' ? 'assess_node' : END,
      )
      .addEdge('knowledge_node', END)
      .addEdge('assess_node', END)
      .addEdge('chat_node', END)
      .addEdge('reject_node', END)
      .addEdge('boundary_node', END)
      .compile()
  );
}

export type TurnGraph = ReturnType<typeof buildTurnGraph>;