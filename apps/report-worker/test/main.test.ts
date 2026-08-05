import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/main.js';

describe('report-worker health endpoints', () => {
  it('GET /health returns status ok', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', service: 'report-worker' });
  });

  it('GET /ready returns status ok', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', service: 'report-worker' });
  });

  it('returns 404 for unknown routes', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
