import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';

/**
 * React 组件测试。
 *
 * 🔴 这一类测试**不能省**：只跑后端纯函数测试的话，「选 Vitest」与「选 `node:test`」
 *    在证据上毫无区别 —— 组件测试能真跑通，选 Vitest 才是有证据支持的。
 */
describe('三页路由骨架（React 组件测试）', () => {
  it('渲染首页时显示聊天页占位内容', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'know-fit' })).toBeDefined();
    expect(screen.getByText(/即将开放/)).toBeDefined();
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