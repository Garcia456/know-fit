#!/usr/bin/env node
/**
 * 由 tokens.json 生成 tokens.css —— 令牌的唯一事实来源是 tokens.json，本文件只是生成器。
 *
 *   node apps/web/src/design-system/build.mjs           # 生成 tokens.css
 *   node apps/web/src/design-system/build.mjs --check    # 只校验是否同步（不同步则 exit 1）
 *
 * 设计意图：Figma 里的令牌 → tokens.json（可 diff、可 review）→ tokens.css（组件真正消费的东西）。
 * 中间多一层 JSON，是为了让「改令牌」是一次可读的提交，而不是一次悄悄改数字。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "tokens.json");
const OUT = join(HERE, "tokens.css");

const doc = JSON.parse(readFileSync(SRC, "utf8"));

const ORDER = ["color", "space", "radius", "font"];
const decls = [];

for (const group of ORDER) {
  const tokens = doc[group];
  if (!tokens) throw new Error(`tokens.json 缺少分组：${group}`);
  for (const [key, token] of Object.entries(tokens)) {
    if (!token.cssVar) throw new Error(`${group}.${key} 缺少 cssVar`);
    if (typeof token.value !== "string") throw new Error(`${group}.${key} 缺少 value`);
    const origin = token.origin === "figma" ? token.figma : "local";
    decls.push(`  ${token.cssVar}: ${token.value};  /* ${origin} */`);
  }
}

const css = `/* 本文件由 build.mjs 从 tokens.json 生成 —— 不要手改这里，改 tokens.json 再跑：
 *   node apps/web/src/design-system/build.mjs
 *
 * 来源：Figma ${doc._meta.figmaFileUrl}
 *       库 ${doc._meta.figmaLibrary}（${doc._meta.mode} 模式）
 * 注：字阶（typeStyles / typeSteps）与阴影（effect）目前只作为规范记录在 tokens.json 里，
 *     未变量化 —— 理由见 design-system/README.md「未变量化的部分」。
 */

:root {
${decls.join("\n")}
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body {
  font-family: var(--font);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
`;

const check = process.argv.includes("--check");
const current = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return null;
  }
})();

const relOut = relative(process.cwd(), OUT) || OUT;

if (check) {
  if (current === css) {
    console.log(`✓ tokens.css 与 tokens.json 同步（${decls.length} 个令牌）`);
    process.exit(0);
  }
  console.error(`✗ tokens.css 与 tokens.json 不同步 —— 跑 node ${relative(process.cwd(), fileURLToPath(import.meta.url))} 重新生成`);
  process.exit(1);
}

writeFileSync(OUT, css, "utf8");
console.log(`✓ 已生成 ${relOut}（${decls.length} 个令牌）`);
