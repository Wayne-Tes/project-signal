import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

const mockConverse = vi.fn();

vi.mock('@project-signal/llm', () => ({
  getLlmClient: vi.fn(() => ({ converse: mockConverse, structured: vi.fn() })),
  getAssistantModel: vi.fn(() => 'eu.anthropic.claude-sonnet-5'),
}));

const { assistantRoutes } = await import('../../src/routes/assistant.js');

/**
 * The assistant endpoint, end to end through the real router.
 *
 * The unit tests cover the loop and the tool layer in isolation. What only shows up here is the
 * contract: that the route is authenticated at all, that a malformed conversation is refused
 * before a single token is spent, and that a model-access failure is reported as an environment
 * problem rather than as a bug in the product.
 */

function answer(text: string) {
  return {
    blocks: [{ kind: 'text', text }],
    stopReason: 'endTurn',
    usage: { inputTokens: 5, outputTokens: 5 },
  };
}

const USER = { uid: 'u1', role: 'admin' as const, tenantId: 'tenant-1' };

/** A real client always sends this; the route forwards it verbatim to every tool call. */
const AUTH = { authorization: 'Bearer test-token' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /assistant/messages', () => {
  it('answers a question', async () => {
    mockConverse.mockResolvedValueOnce(answer('Fifty is neutral.'));
    const app = await buildTestApp(assistantRoutes, USER);

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages: [{ role: 'user', content: 'What does 50 mean?' }] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.answer).toBe('Fifty is neutral.');
    expect(body.truncated).toBe(false);
    expect(Array.isArray(body.citations)).toBe(true);
  });

  it('requires authentication', async () => {
    const app = await buildTestApp(assistantRoutes, USER);
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      /* No Authorization header. The harness stubs `request.user` directly, so this asserts
         the route's own guard — the header is what gets forwarded to every tool call, and
         without it the assistant would run unauthenticated against the API. */
      headers: {},
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.statusCode).toBe(401);
    expect(mockConverse).not.toHaveBeenCalled();
  });

  it('refuses a conversation that does not end with the user', async () => {
    /* Asking the model to continue its own last message produces a fragment, not an answer. */
    const app = await buildTestApp(assistantRoutes, USER);
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mockConverse).not.toHaveBeenCalled();
  });

  it('rejects an empty conversation before spending a token', async () => {
    const app = await buildTestApp(assistantRoutes, USER);
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockConverse).not.toHaveBeenCalled();
  });

  it('rejects an over-long message rather than paying to truncate it', async () => {
    const app = await buildTestApp(assistantRoutes, USER);
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages: [{ role: 'user', content: 'x'.repeat(8000) }] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockConverse).not.toHaveBeenCalled();
  });

  it('rejects an unbounded conversation history', async () => {
    const app = await buildTestApp(assistantRoutes, USER);
    const messages = Array.from({ length: 60 }, () => ({ role: 'user', content: 'hi' }));
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reports blocked model access as an environment problem, not a bug', async () => {
    /* Bedrock access in this account is gated per model and has changed under a running
       deployment. A 500 sends the owner looking for a code defect; a 503 with this wording
       points at the thing they can actually act on. */
    mockConverse.mockRejectedValueOnce(
      new Error('ResourceNotFoundException: Model use case details have not been submitted'),
    );
    const app = await buildTestApp(assistantRoutes, USER);

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).message).toMatch(/does not currently have access/i);
  });

  it('does not leak an internal error message to the client', async () => {
    mockConverse.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.20.3.4:5432'));
    const app = await buildTestApp(assistantRoutes, USER);

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('10.20.3.4');
  });

  it('accepts optional situational context', async () => {
    mockConverse.mockResolvedValueOnce(answer('ok'));
    const app = await buildTestApp(assistantRoutes, USER);

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/messages',
      headers: AUTH,
      payload: {
        messages: [{ role: 'user', content: 'explain this' }],
        view: 'dashboard',
        brandId: 'brand-1',
      },
    });

    expect(res.statusCode).toBe(200);
    const call = mockConverse.mock.calls[0]?.[0] as { system: string };
    expect(call.system).toContain('dashboard');
  });
});
