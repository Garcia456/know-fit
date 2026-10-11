import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';

/**
 * React 组件测试（dev-001 §三 3.1 第 6 条的第 ② 类）。
 *
 * 🔴 这一条**不能省**：ADR-019 决策 B 明文 ——
 *    只跑后端纯函数测试的话，「选 Vitest」与「选 `node:test`」在证据上毫无区别。
 *    组件测试能真跑通，才是选 Vitest 的理由被证据支持。
 *    （而 dev-006 的热力图计算正需要这一类测试兜住 —— 见决策 B 的判据。）
 */
describe('三页路由骨架（React 组件测试）', () => {
  it('渲染首页时显示聊天页占位内容', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'know-fit' })).toBeDefined();
    expect(screen.getByText(/待 dev-002 实现/)).toBeDefined();
  });

  it('渲染 /data 时显示数据页占位内容', () => {
    render(
      <MemoryRouter initialEntries={['/data']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '数据' })).toBeDefined();
  });

  it('渲染 /profile 时显示档案页占位内容', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '档案' })).toBeDefined();
  });
});