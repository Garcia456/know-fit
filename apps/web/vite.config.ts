/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 设计系统仍以 docs/08-prototype/design-system 为唯一事实来源，不复制一份
      '@design': fileURLToPath(
        new URL('../../docs/08-prototype/design-system', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // 让前后端在同一个源下开发 —— 避免 CORS 从第一天就变成噪音（dev-001 §1.2）。
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