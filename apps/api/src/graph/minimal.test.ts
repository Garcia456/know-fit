import { describe, expect, it } from 'vitest';
import { minimalGraph } from './minimal.js';

/**
 * LangGraph 最小图测试（dev-001 §三 3.1 第 6 条的第 ③ 类）。
 *
 * 🔴 图里的节点全是桩，**不调用任何真实 LLM**（§二 第 2 条）——
 *    所以这条测试不产生任何 API 费用，也不需要任何 key。
 *
 * 它证明的只有「LangGraph 装得上、图能编译、状态能流转」；
 * 真实图从 dev-002 起（技术方案 §2）。
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