import { describe, expect, it } from 'vitest';
import { minimalGraph } from './minimal.js';

/**
 * 连通性探针图的测试。
 *
 * 🔴 图里的节点全是桩，**不调用任何真实 LLM** ——
 *    所以这条测试不产生任何 API 费用，也不需要任何 key。
 *
 * 它证明的只有「LangGraph 装得上、图能编译、状态能流转」。
 */
describe('LangGraph 最小图（桩节点）', () => {
  it('三节点按序流转，并在 END 收敛', async () => {
    const result = await minimalGraph.invoke({ input: '  Hello Graph  ' });

    expect(result.normalized).toBe('hello graph');
    expect(result.charCount).toBe('hello graph'.length);
    expect(result.summary).toBe(`hello graph (${'hello graph'.length} chars)`);
  });

  it('schema 的 default 会在缺省字段上生效', async () => {
    const result = await minimalGraph.invoke({ input: 'x' });

    expect(result.normalized).toBe('x');
    expect(result.charCount).toBe(1);
  });
});