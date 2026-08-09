import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/auth', () => ({ getIdToken: vi.fn(async () => 'tok') }));

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { apiFetch } = await import('../src/lib/api');

/**
 * The API client.
 *
 * REGRESSION. `Content-Type: application/json` was sent on every request, including POSTs with
 * no body. Fastify sees the header, finds nothing to parse, and rejects with 400 "Body cannot be
 * empty when content-type is set to application/json" — BEFORE the route handler runs. So
 * `POST /brands/:id/scan`, which takes no body, returned 400 every time and never reached the
 * API's logic at all. The scan button was dead on arrival in production.
 *
 * It gave itself away by responding in two milliseconds: far too fast to have touched the
 * database, which meant it had failed in the framework rather than the handler.
 */

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: status < 400,
    status,
    statusText: 'x',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function sentHeaders(): Record<string, string> {
  return fetchMock.mock.calls[0]![1].headers as Record<string, string>;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('apiFetch', () => {
  it('omits Content-Type when there is no body', async () => {
    respond(202, { id: 'run-1' });
    await apiFetch('/brands/b1/scan', { method: 'POST' });
    expect(sentHeaders()['Content-Type']).toBeUndefined();
  });

  it('sends Content-Type when there IS a body', async () => {
    respond(200, {});
    await apiFetch('/brands/b1', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    expect(sentHeaders()['Content-Type']).toBe('application/json');
  });

  it('always attaches the bearer token', async () => {
    respond(200, {});
    await apiFetch('/brands');
    expect(sentHeaders()['Authorization']).toBe('Bearer tok');
  });

  it('returns undefined for a 204 rather than throwing on empty JSON', async () => {
    /* DELETE returns 204. Calling .json() on it throws a SyntaxError, which surfaces to the user
       as a failed operation that in fact succeeded — the conversation really was deleted. */
    respond(204, null);
    await expect(apiFetch('/assistant/conversations/c1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('returns undefined for an explicitly empty body', async () => {
    respond(200, null, { 'content-length': '0' });
    await expect(apiFetch('/x')).resolves.toBeUndefined();
  });

  it('throws with the status and body on failure', async () => {
    respond(409, { error: 'A scan is already in progress' });
    await expect(apiFetch('/brands/b1/scan', { method: 'POST' })).rejects.toThrow(/409/);
  });

  it('lets a caller override the headers it sets', async () => {
    respond(200, {});
    await apiFetch('/x', { headers: { 'Content-Type': 'text/csv' } });
    expect(sentHeaders()['Content-Type']).toBe('text/csv');
  });
});
