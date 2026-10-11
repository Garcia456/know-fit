import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-008 护栏 R-A / R-B 的**负例测试**（dev-001 §三 3.1 第 5 条）。
 *
 * 「规则写在配置里」不等于「规则真的会拦住东西」——
 * 本文件用 ESLint 的 Node API 对**故意违规的代码片段**跑 lint，
 * 断言它确实被拦住；同时用一段合规代码断言护栏没有误伤。
 *
 * ⚠️ 本文件只覆盖 **R-A / R-B**。
 *    **R-C（运行期遍历所有 API 响应体、断言不含 chunk 全文）挂 dev-005** ——
 *    👉 **落了 R-A / R-B ≠ ADR-008 的约束被保住**（ADR-008 补注明文）。
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

describe('ADR-008 护栏 R-A：routes 层禁止 import Drizzle schema', () => {
  it('负例：routes 下的违规 import 必须被拦住', async () => {
    const messages = await lintSnippet(
      ["import { smoke } from '../db/schema.js';", 'export const x = smoke;', ''].join('\n'),
      'apps/api/src/routes/__violation.ts',
    );
    expect(
      messages.some((m) => m.ruleId === 'no-restricted-imports'),
      'R-A 没拦住 routes 层对 Drizzle schema 的 import',
    ).toBe(true);
  });

  it('正例：routes 下的普通 import 不报 R-A', async () => {
    const messages = await lintSnippet(
      ["import type { FastifyInstance } from 'fastify';", 'export const x = 1;', ''].join('\n'),
      'apps/api/src/routes/__ok.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toHaveLength(0);
  });
});

describe('ADR-008 护栏 R-B：对外契约禁止全文型字段名', () => {
  it('负例：contracts 下出现 text 字段必须被拦住', async () => {
    const messages = await lintSnippet(
      ['export interface Bad {', '  id: number;', '  text: string;', '}', ''].join('\n'),
      'apps/api/src/contracts/__violation.ts',
    );
    expect(
      messages.some((m) => m.ruleId === 'no-restricted-syntax'),
      'R-B 没拦住对外契约里的 text 字段',
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
        `R-B 没拦住字段 ${field}`,
      ).toBe(true);
    }
  });

  it('正例：普通契约字段不报 R-B（护栏没有误伤）', async () => {
    const messages = await lintSnippet(
      ["export interface Good { status: 'ok'; service: string; }", ''].join('\n'),
      'apps/api/src/contracts/__ok.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(0);
  });
});