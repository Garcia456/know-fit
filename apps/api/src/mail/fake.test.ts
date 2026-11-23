import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMailClient } from './fake.js';

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('替身邮件', () => {
  it('把邮件逐行写进 outbox.jsonl，目录不存在时自动建', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kf-mail-'));
    const outbox = join(dir, 'nested');
    const mail = createFakeMailClient({ MAIL_OUTBOX_DIR: outbox });

    await mail.send({ to: 'a@knowfit.local', subject: '验证', text: '第一封' });
    await mail.send({ to: 'a@knowfit.local', subject: '验证', text: '第二封' });

    const lines = (await readFile(join(outbox, 'outbox.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ to: 'a@knowfit.local', subject: '验证', text: '第二封' });
  });
});
