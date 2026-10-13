import { END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';

/**
 * 连通性探针图（三节点）。
 *
 * 🔴 **全部节点是桩（stub），绝不调用真实 LLM** —— 探针不该产生任何 API 费用，
 *    CI 里放 key 也是新的安全面。
 *
 * 它证明的只有三件事：LangGraph 装得上、图能编译、状态能在节点间流动。
 * **不是任何产品行为** —— 真实录入图见 `graph/turn.ts`。
 */
export const MinimalState = z.object({
  input: z.string(),
  normalized: z.string().default(''),
  charCount: z.number().default(0),
  summary: z.string().default(''),
});

export const minimalGraph = new StateGraph(MinimalState)
  .addNode('normalize', (state) => ({ normalized: state.input.trim().toLowerCase() }))
  .addNode('count', (state) => ({ charCount: state.normalized.length }))
  .addNode('summarize', (state) => ({
    summary: `${state.normalized} (${state.charCount} chars)`,
  }))
  .addEdge(START, 'normalize')
  .addEdge('normalize', 'count')
  .addEdge('count', 'summarize')
  .addEdge('summarize', END)
  .compile();