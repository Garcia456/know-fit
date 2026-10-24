import { describe, expect, it } from 'vitest';
import { RC_WINDOW, createResponseGuard } from './rc.js';

/**
 * R-C 运行期断言 —— 发出去的 JSON 里不许有知识片全文。
 * 只扫 JSON 字符串；`short_quote` 是引用，白名单放行。
 */

const TEXT =
  '这是一段足够长的知识片正文，用来验证运行期断言能不能挡住整段原文泄漏出来。'.repeat(3);

function fresh() {
  const stats = { scanned: 0, blocked: 0 };
  const guard = createResponseGuard(stats);
  guard.setTexts([TEXT]);
  return { stats, guard };
}

describe('响应护栏', () => {
  it('窗口集合建起来了', () => {
    const { guard } = fresh();
    expect(guard.windowCount).toBeGreaterThan(0);
    expect(guard.windowCount).toBeLessThanOrEqual(TEXT.length - RC_WINDOW + 1);
  });

  it(`任意 ${RC_WINDOW} 字原文出现在响应里 → 拦`, () => {
    const { guard, stats } = fresh();
    const verdict = guard.inspect({ data: { reply: TEXT.slice(5, 5 + RC_WINDOW) } });
    expect(verdict.blocked).toBe(true);
    expect(verdict.prefix).toMatch(/^[0-9a-f]{16}$/);
    expect(stats.blocked).toBe(1);
    expect(stats.scanned).toBe(1);
  });

  it('嵌套数组 / 深层对象也扫', () => {
    const { guard } = fresh();
    expect(guard.inspect({ a: [{ b: { c: TEXT.slice(20, 20 + RC_WINDOW) } }] }).blocked).toBe(true);
  });

  it('short_quote 白名单：引用本身就是片段子串，不拦', () => {
    const { guard, stats } = fresh();
    const verdict = guard.inspect({
      citations: [{ short_quote: TEXT.slice(10, 10 + RC_WINDOW), creator: '博主' }],
    });
    expect(verdict.blocked).toBe(false);
    expect(stats.blocked).toBe(0);
    expect(stats.scanned).toBe(1);
  });

  it(`短于 ${RC_WINDOW} 字的片段不拦 —— 那条线以下是引用，不是全文`, () => {
    const { guard } = fresh();
    expect(guard.inspect({ advice: TEXT.slice(0, RC_WINDOW - 1) }).blocked).toBe(false);
  });

  it('非字符串值直接跳过，不误判', () => {
    const { guard } = fresh();
    expect(guard.inspect({ n: 1, ok: true, none: null }).blocked).toBe(false);
  });

  it('没命中时前缀为空', () => {
    const { guard } = fresh();
    expect(guard.inspect({ reply: '一段完全无关的话' })).toEqual({ blocked: false, prefix: null });
  });
});
