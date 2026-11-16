import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const mockExecute = vi.fn();
vi.mock('@project-signal/db', () => ({ db: { get: vi.fn(() => ({ execute: mockExecute })) } }));

const { healthRoutes } = await import('../../src/routes/health.js');

async function build() {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/health', () => {
  it('is up without touching anything', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', service: 'api' });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('/ready', () => {
  it('is ready when the database answers', async () => {
    mockExecute.mockResolvedValue([{ '?column?': 1 }]);
    const res = await (await build()).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('says NOT ready when it does not — and does not leak the driver error', async () => {
    /* It returned ok unconditionally, so it reported ready while every real request failed. */
    mockExecute.mockRejectedValue(
      new Error('connect ECONNREFUSED psignal-dev-postgres.internal:5432'),
    );
    const res = await (await build()).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      status: 'unavailable',
      service: 'api',
      reason: 'database unreachable',
    });
    expect(res.body).not.toContain('psignal-dev-postgres');
  });
});
