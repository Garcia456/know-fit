// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * know-fit 的 ESLint 配置（flat config，ESLint 10 / ADR-019 决策 C）。
 *
 * 本文件最重要的一段不是风格规则，而是 **ADR-008 的护栏 R-A / R-B**（见文件末尾）——
 * 那是「选 ESLint 而不是 Biome / 只上 tsc」的**唯一不可替代用途**
 * （决策 C 明文：若这两条没落，本次选 ESLint 的理由不成立）。
 *
 * ⚠️ 落了 R-A / R-B **≠** ADR-008 的约束被保住：
 *    真正的证据是运行期的 R-C（遍历所有 API 响应体、断言不含 chunk 全文），
 *    **它挂 dev-005**，在那之前一直敞开。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/drizzle/**',
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 全局：把 `scripts/*.mjs` 也纳入检查
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // 测试与配置文件的宽松档
  {
    files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,js,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // 🔴 ADR-008 护栏 R-A：routes 层禁止直接 import Drizzle schema
  //    「全文漏出去」的三条通道之一 —— 路由直接读库，
  //    读回来的整行（含未来 knowledge_chunk.text）可能被顺手序列化出去。
  // ─────────────────────────────────────────────────────────────
  {
    files: ['apps/api/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/schema', '**/db/schema.js', '**/db/schema.ts'],
              message:
                'ADR-008 护栏 R-A：routes 层禁止 import Drizzle schema 模块 —— 直接读库是全文漏出的通道之一。请经 service 层取已裁剪的字段。',
            },
          ],
        },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────
  // 🔴 ADR-008 护栏 R-B：对外契约不得出现全文型字段名
  // ─────────────────────────────────────────────────────────────
  {
    files: ['apps/api/src/contracts/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'TSPropertySignature[key.name=/^(text|content|transcript)$/], PropertyDefinition[key.name=/^(text|content|transcript)$/], TSMethodSignature[key.name=/^(text|content|transcript)$/]',
          message:
            'ADR-008 护栏 R-B：对外契约禁止出现全文型字段名（text / content / transcript）—— 唯一的强制手段是「API 层绝不下发 knowledge_chunk.text」。',
        },
      ],
    },
  },
);