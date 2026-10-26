import { describe, expect, it } from 'vitest';
import { withDeadline } from './assessment.js';

describe('withDeadline', () => {
  it('到点中断，spawn 出去的调用不会无限拖', async () => {
    const started = Date.now();
    const pending = withDeadline(
      30,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(pending).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('没到点就正常返回，之后也不会被中止', async () => {
    let aborted = false;
    const out = await withDeadline(1000, async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return 'ok';
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(out).toBe('ok');
    expect(aborted).toBe(false);
  });
});