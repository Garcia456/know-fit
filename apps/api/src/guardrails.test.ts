import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 护栏的**负例测试**：routes 层不许碰数据库 schema、对外契约不许出现全文型字段名。
 *
 * 「规则写在配置里」不等于「规则真的会拦住东西」——
 * 本文件用 ESLint 的 Node API 对**故意违规的代码片段**跑 lint，
 * 断言它确实被拦住；同时用一段合规代码断言护栏没有误伤。
 *
 * ⚠️ 本文件只覆盖这两条护栏。
 *    **运行期那条（API 响应体里不许漏出 chunk 全文）还没做** ——
 *    👉 **这两条绿 ≠ 原文不外泄这条约束被保住。**
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..'); // apps/api/src → 仓库根

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: REPO_ROOT });
});

async function lintSnippet(code: string, filePath: string) {
  const results = await eslint.lintText(code, { filePath, warnIgnored: false });
  return results[0]?.messages ?? [];
}

describe('护栏：routes 层禁止 import Drizzle schema', () => {
  it('负例：routes 下的违规 import 必须被拦住', async () => {
    const messages = await lintSnippet(
      ["import { smoke } from '../db/schema.js';", 'export const x = smoke;', ''].join('\n'),
      'apps/api/src/routes/__violation.ts',
    );
    expect(
      messages.some((m) => m.ruleId === 'no-restricted-imports'),
      '没拦住 routes 层对 Drizzle schema 的 import',
    ).toBe(true);
  });

  it('正例：routes 下的普通 import 不报', async () => {
    const messages = await lintSnippet(
      ["import type { FastifyInstance } from 'fastify';", 'export const x = 1;', ''].join('\n'),
      'apps/api/src/routes/__ok.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toHaveLength(0);
  });
});

describe('护栏：对外契约禁止全文型字段名', () => {
  it('负例：contracts 下出现 text 字段必须被拦住', async () => {
    const messages = await lintSnippet(
      ['export interface Bad {', '  id: number;', '  text: string;', '}', ''].join('\n'),
      'apps/api/src/contracts/__violation.ts',
    );
    expect(
      messages.some((m) => m.ruleId === 'no-restricted-syntax'),
      '没拦住对外契约里的 text 字段',
    ).toBe(true);
  });

  it('负例：content / transcript 同样被拦住', async () => {
    for (const field of ['content', 'transcript']) {
      const messages = await lintSnippet(
        ['export interface Bad {', `  ${field}: string;`, '}', ''].join('\n'),
        'apps/api/src/contracts/__violation.ts',
      );
      expect(
        messages.some((m) => m.ruleId === 'no-restricted-syntax'),
        `没拦住字段 ${field}`,
      ).toBe(true);
    }
  });

  it('负例：zod 对象字面量里的 text 也必须被拦住', async () => {
    // 手写 interface 与 zod 对象是两种 AST 节点；契约一改用 zod，
    // 只认 interface 的选择器就静默失效 —— 这条就是盯着这个缺口。
    const messages = await lintSnippet(
      [
        "import { z } from 'zod';",
        'export const Bad = z.object({ id: z.number(), text: z.string() });',
        '',
      ].join('\n'),
      'apps/api/src/contracts/__violation.ts',
    );
    expect(
      messages.some((m) => m.ruleId === 'no-restricted-syntax'),
      '没拦住 zod 契约里的 text 字段',
    ).toBe(true);
  });

  it('正例：普通契约字段不报（护栏没有误伤）', async () => {
    const messages = await lintSnippet(
      ["export interface Good { status: 'ok'; service: string; }", ''].join('\n'),
      'apps/api/src/contracts/__ok.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(0);
  });

  it('正例：真实的抽取与轮次契约文件本身不含违规字段名', async () => {
    // ⚠️ 上面两条正例都是**合成的**片段 —— 它们证不了真文件干净。
    //    这条直接 lint 真文件，是「护栏没被绕过」的唯一硬证据。
    for (const name of ['extraction.ts', 'turn.ts', 'metrics.ts']) {
      const messages = await lintSnippet(
        await readFile(join(HERE, 'contracts', name), 'utf8'),
        `apps/api/src/contracts/${name}`,
      );
      expect(
        messages.filter((m) => m.ruleId === 'no-restricted-syntax'),
        `contracts/${name} 撞了护栏`,
      ).toHaveLength(0);
    }
  });
});