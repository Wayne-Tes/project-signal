import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { httpBasics, ID_PARAMS, DATE } from '../../src/lib/http.js';

/**
 * The error boundary.
 *
 * Fastify's default handler returns `error.message` for every status — and drizzle's
 * `DrizzleQueryError` message is the full SQL plus its bound parameters. Any unhandled database
 * error therefore handed the caller the query, the schema and potentially other tenants' ids.
 */

/** Shaped like drizzle 0.45's DrizzleQueryError wrapping a postgres-js error. */
function drizzleError(code: string): Error {
  const cause = Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code });
  return Object.assign(
    new Error(
      'Failed query: select "id" from "brand_entities" where "tenant_id" = $1\nparams: 11111111-1111-4111-8111-111111111111',
    ),
    { cause },
  );
}

async function appThrowing(err: unknown) {
  const app = Fastify({ logger: false });
  await app.register(httpBasics);
  app.get('/boom', async () => {
    throw err;
  });
  app.get('/deliberate', async (_req, reply) =>
    reply.serviceUnavailable('The model is not enabled for this account.'),
  );
  app.get('/missing', async (_req, reply) => reply.notFound('Brand not found'));
  app.get('/:id', { schema: { params: ID_PARAMS } }, async () => ({ ok: true }));
  app.get(
    '/d/x',
    { schema: { querystring: { type: 'object', properties: { from: DATE } } } },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

describe('errorHandler', () => {
  it('never returns the SQL, the parameters or a stack for an unhandled 5xx', async () => {
    const app = await appThrowing(new Error('Failed query: select * from users\nparams: secret'));
    const res = await app.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('Failed query');
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('users');
    expect(JSON.parse(res.body).message).toMatch(/Quote request id/);
  });

  it('maps a malformed-value database error to 400 without leaking it', async () => {
    const app = await appThrowing(drizzleError('22P02'));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('brand_entities');
    expect(res.body).not.toContain('11111111');
  });

  it.each([
    ['23505', 409],
    ['23503', 409],
    ['22007', 400],
    ['22008', 400],
  ])('maps SQLSTATE %s to %i', async (code, status) => {
    const app = await appThrowing(drizzleError(code));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(status);
    expect(res.body).not.toContain('Failed query');
  });

  it('treats an unrecognised SQLSTATE as a server error, generically', async () => {
    const app = await appThrowing(drizzleError('XX000'));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('Failed query');
  });

  it('keeps a deliberate 5xx message written by this codebase', async () => {
    /* `reply.serviceUnavailable('…')` is caller-facing prose, and the actionable part of the
       response. Only error objects' own text is suppressed. */
    const app = await appThrowing(new Error('unused'));
    const res = await app.inject({ method: 'GET', url: '/deliberate' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).message).toBe('The model is not enabled for this account.');
  });

  it('keeps 4xx messages, which are how a client learns what it did wrong', async () => {
    const app = await appThrowing(new Error('unused'));
    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Not Found', message: 'Brand not found' });
  });

  it('reports a schema violation as a 400 that names the field', async () => {
    const app = await appThrowing(new Error('unused'));
    const res = await app.inject({ method: 'GET', url: '/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/uuid/);
  });

  it('validates dates as calendar dates', async () => {
    const app = await appThrowing(new Error('unused'));
    expect((await app.inject({ method: 'GET', url: '/d/x?from=2026-02-30' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/d/x?from=2026-02-28' })).statusCode).toBe(200);
  });

  it('treats an error with a nonsensical status as a 500', async () => {
    const app = await appThrowing(Object.assign(new Error('weird'), { statusCode: 42 }));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('weird');
  });

  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [409, 'Conflict'],
    [413, 'Payload Too Large'],
    [415, 'Unsupported Media Type'],
    [429, 'Too Many Requests'],
    [418, 'Error'],
  ])('labels a %i with its reason phrase', async (status, reason) => {
    const app = await appThrowing(
      Object.assign(new Error('client mistake'), { statusCode: status }),
    );
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(status);
    expect(JSON.parse(res.body)).toMatchObject({ error: reason, message: 'client mistake' });
  });

  it('labels a deliberate 503', async () => {
    const app = await appThrowing(new Error('unused'));
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/deliberate' })).body).error).toBe(
      'Service Unavailable',
    );
  });
});
