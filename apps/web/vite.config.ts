/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 设计系统随前端源码走 —— 构建不该依赖 docs/（docs 不进公开仓库）。
      // 原型里那一份保留原样，只作设计留档，不再被 import。
      '@design': fileURLToPath(new URL('./src/design-system', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 让前后端在同一个源下开发 —— 避免 CORS 从第一天就变成噪音。
    // /api/health → http://localhost:3000/health
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});