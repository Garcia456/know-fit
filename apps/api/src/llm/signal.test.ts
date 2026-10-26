import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bindSignal, type LlmClient } from './client.js';

const EMPTY = z.object({});

describe('bindSignal', () => {
  it('structured 与 generate 都带上同一个 signal', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const inner: LlmClient = {
      model: 'test',
      async structured(req, options) {
        seen.push(options?.signal);
        return req.schema.parse({});
      },
      async generate(_req, options) {
        seen.push(options?.signal);
        return 'ok';
      },
    };
    const controller = new AbortController();
    const client = bindSignal(inner, controller.signal);

    expect(client.model).toBe('test');
    await client.structured({ system: 's', input: 'i', schema: EMPTY, name: 'n' });
    await client.generate({ system: 's', input: 'i' });

    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  it('中止后调用被打断，不是继续跑', async () => {
    const inner: LlmClient = {
      structured: (_req, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      generate: () => Promise.resolve(''),
    };
    const controller = new AbortController();
    const pending = bindSignal(inner, controller.signal).structured({
      system: 's',
      input: 'i',
      schema: EMPTY,
      name: 'n',
    });

    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
  });
});