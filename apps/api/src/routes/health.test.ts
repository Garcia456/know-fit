import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../services/pool.js', () => ({
  getPool: () => ({ query: mocks.query }),
}));

const { healthRoutes } = await import('./health.js');

async function buildApp() {
  const app = Fastify();
  await app.register(healthRoutes);
  return app;
}

afterEach(() => {
  mocks.query.mockReset();
});

describe('/health 与 /ready', () => {
  it('/health 不读库', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'know-fit-api' });
    expect(mocks.query).not.toHaveBeenCalled();
    await app.close();
  });

  it('/ready 在库可达时返回 200', async () => {
    mocks.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('/ready 在库不可达时返回 503 且不暴露错误', async () => {
    mocks.query.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    expect(res.body).not.toContain('ECONNREFUSED');
    await app.close();
  });
});