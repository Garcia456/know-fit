// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * know-fit 的 ESLint 配置（flat config）。
 *
 * 本文件最重要的一段不是风格规则，而是**两条硬约束**（见文件末尾）：
 *   R-A —— 路由层不许直接读库；
 *   R-B —— 对外契约不许出现全文型字段名。
 * 这两条没有别的工具能替 —— 它们也是「上 ESLint 而不只上 tsc」的理由。
 *
 * ⚠️ 这两条绿了 **≠** 「原文不会漏出去」被保住：
 *    真正的证据是运行期那条（遍历 API 响应体、断言不含成段的原文），
 *    **它还没做**，在那之前这条一直敞开。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/drizzle/**',
      'docs/**',
      // 本地 worktree 是另一份完整仓库，扫进来会让 tsconfigRootDir 判不出来
      '**/.claude/**',
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
  // 🔴 R-A：路由层禁止直接 import Drizzle schema
  //    「原文漏出去」的三条通道之一 —— 路由直接读库，
  //    读回来的整行可能被顺手序列化出去。
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
                '路由层禁止 import Drizzle schema 模块 —— 直接读库是原文漏出的通道之一。请经服务层取已裁剪的字段。',
            },
          ],
        },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────
  // 🔴 R-B：对外契约不得出现全文型字段名
  //    ⚠️ 选择器里那两组长得很像，但各管一边：
  //       TSPropertySignature / PropertyDefinition / TSMethodSignature → 手写的 interface / class
  //       Property                                                      → zod 对象字面量
  //    少了 Property，契约一改成 zod 写法护栏就静默失效（实测踩到过一次）。
  // ─────────────────────────────────────────────────────────────
  {
    files: ['apps/api/src/contracts/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'TSPropertySignature[key.name=/^(text|content|transcript)$/], PropertyDefinition[key.name=/^(text|content|transcript)$/], TSMethodSignature[key.name=/^(text|content|transcript)$/], Property[key.name=/^(text|content|transcript)$/]',
          message:
            '对外契约禁止出现全文型字段名（text / content / transcript）—— 接口层绝不下发知识库原文。',
        },
      ],
    },
  },
);