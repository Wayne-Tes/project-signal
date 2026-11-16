import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('report-worker health endpoints', () => {
  it('GET /health returns status ok', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', service: 'report-worker' });
  });

  it('GET /ready returns status ok', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', service: 'report-worker' });
  });

  it('returns 404 for unknown routes', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('logs by default, and can be built silent for tests', () => {
    /* Fastify's real logger carries a level; the disabled one is a no-op stub without one. */
    expect(buildApp().log.level).toBe('info');
    expect(buildApp({ logger: false }).log.level).toBeUndefined();
  });
});
