import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 连真库的测试各自开池、收尾会 closeDb；并行跑文件时，
    // 一个文件收池会把另一个文件还在用的连接掐断（Connection terminated）。
    // 串行换确定性：31s 左右，可接受；比偶发假失败便宜。
    fileParallelism: false,
  },
});