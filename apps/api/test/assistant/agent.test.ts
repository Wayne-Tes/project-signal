import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContentBlock, ConverseRequest, ConverseResult } from '@project-signal/llm';

const mockConverse = vi.fn();

vi.mock('@project-signal/llm', () => ({
  getLlmClient: vi.fn(() => ({ converse: mockConverse, structured: vi.fn() })),
  getAssistantModel: vi.fn(() => 'eu.anthropic.claude-sonnet-5'),
}));

const { ask } = await import('../../src/assistant/agent.js');

/**
 * The agent loop.
 *
 * These matter because the loop is where a conversation quietly goes wrong in ways no type
 * catches: a tool result sent back with a mismatched id, an assistant turn recorded without its
 * tool calls, a runaway loop, or — worst — a partial answer presented as a complete one.
 */

function textTurn(text: string): ConverseResult {
  return { blocks: [{ kind: 'text', text }], stopReason: 'endTurn', usage: { inputTokens: 10, outputTokens: 5 } };
}

function toolTurn(name: string, input: unknown, id = 'tu-1'): ConverseResult {
  return {
    blocks: [{ kind: 'toolUse', id, name, input: input as never }],
    stopReason: 'toolUse',
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function ctx(inject = vi.fn().mockResolvedValue({ statusCode: 200, json: () => ({ score: 62 }) })) {
  return { app: { inject } as unknown as FastifyInstance, authorization: 'Bearer t' };
}

const QUESTION = { messages: [{ role: 'user' as const, content: 'How are we doing?' }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ask', () => {
  it('returns the answer when the model needs no tools', async () => {
    mockConverse.mockResolvedValueOnce(textTurn('Fifty is neutral.'));
    const result = await ask(ctx(), QUESTION);
    expect(result.answer).toBe('Fifty is neutral.');
    expect(result.truncated).toBe(false);
    expect(result.steps).toEqual([]);
  });

  it('runs a requested tool and feeds the result back', async () => {
    mockConverse
      .mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'b1' }))
      .mockResolvedValueOnce(textTurn('Your index is 62.'));

    const result = await ask(ctx(), QUESTION);

    expect(result.steps).toEqual(['get_brand_score']);
    expect(result.answer).toBe('Your index is 62.');

    /* The second call must carry the assistant's tool-call turn AND our result turn. */
    const second = mockConverse.mock.calls[1]?.[0] as ConverseRequest;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]?.role).toBe('assistant');
    expect(second.messages[2]?.role).toBe('user');
  });

  it('correlates each tool result with the id the model used', async () => {
    /* Not advisory: a result whose toolUseId does not match an outstanding call is rejected by
       the provider, and the whole conversation fails rather than the one tool. */
    mockConverse
      .mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'b1' }, 'tu-abc'))
      .mockResolvedValueOnce(textTurn('done'));

    await ask(ctx(), QUESTION);

    const second = mockConverse.mock.calls[1]?.[0] as ConverseRequest;
    const resultBlock = second.messages[2]?.blocks[0] as Extract<ContentBlock, { kind: 'toolResult' }>;
    expect(resultBlock.kind).toBe('toolResult');
    expect(resultBlock.id).toBe('tu-abc');
  });

  it('replays the assistant turn exactly as the model produced it', async () => {
    /* Reconstructing the turn from just its text drops the toolUse blocks, and the provider
       then sees results answering calls that were never made. */
    const turn = toolTurn('get_brand_score', { brandId: 'b1' });
    mockConverse.mockResolvedValueOnce(turn).mockResolvedValueOnce(textTurn('ok'));

    await ask(ctx(), QUESTION);

    const second = mockConverse.mock.calls[1]?.[0] as ConverseRequest;
    expect(second.messages[1]?.blocks).toEqual(turn.blocks);
  });

  it('reports a failed tool to the model as an error rather than aborting', async () => {
    const forbidden = vi.fn().mockResolvedValue({ statusCode: 403, json: () => ({}) });
    mockConverse
      .mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'not-yours' }))
      .mockResolvedValueOnce(textTurn('You do not have access to that brand.'));

    const result = await ask(ctx(forbidden), QUESTION);

    const second = mockConverse.mock.calls[1]?.[0] as ConverseRequest;
    const block = second.messages[2]?.blocks[0] as Extract<ContentBlock, { kind: 'toolResult' }>;
    expect(block.isError).toBe(true);
    expect(result.answer).toContain('do not have access');
  });

  it('stops after a bounded number of turns and says the answer is partial', async () => {
    /* A model that keeps asking for tools must not be able to spend unbounded money and
       latency. Equally, the ceiling must not be hidden: a partial answer presented as complete
       is the failure that makes an assistant untrustworthy. */
    mockConverse.mockResolvedValue(toolTurn('get_brand_score', { brandId: 'b1' }));
    mockConverse.mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'b1' }));

    const result = await ask(ctx(), QUESTION);

    expect(result.truncated).toBe(true);
    /* Six loop turns plus one final tool-free composition. */
    expect(mockConverse.mock.calls.length).toBe(7);
    const final = mockConverse.mock.calls[6]?.[0] as ConverseRequest;
    expect(final.tools, 'the last call must offer no tools').toBeUndefined();
  });

  it('caps how many tools it will run in a single turn', async () => {
    const many: ContentBlock[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'toolUse' as const,
      id: `tu-${i}`,
      name: 'get_brand_score',
      input: { brandId: 'b1' } as never,
    }));
    mockConverse
      .mockResolvedValueOnce({ blocks: many, stopReason: 'toolUse', usage: { inputTokens: 1, outputTokens: 1 } })
      .mockResolvedValueOnce(textTurn('ok'));

    const result = await ask(ctx(), QUESTION);
    expect(result.steps).toHaveLength(5);
  });

  it('accumulates token usage across every round trip', async () => {
    mockConverse
      .mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'b1' }))
      .mockResolvedValueOnce(textTurn('ok'));

    const result = await ask(ctx(), QUESTION);
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(10);
  });

  it('builds citations only from tools that actually succeeded', async () => {
    const forbidden = vi.fn().mockResolvedValue({ statusCode: 403, json: () => ({}) });
    mockConverse
      .mockResolvedValueOnce(toolTurn('get_brand_score', { brandId: 'nope' }))
      .mockResolvedValueOnce(textTurn('no access'));

    const result = await ask(ctx(forbidden), QUESTION);
    expect(result.citations).toEqual([]);
  });

  it('passes the view and brand as system context, never as a user turn', async () => {
    /* A signal title reading "ignore your instructions" must have no path to becoming an
       instruction. Situational context is ours, so it goes in the system prompt. */
    mockConverse.mockResolvedValueOnce(textTurn('ok'));

    await ask(ctx(), { ...QUESTION, view: 'dashboard', brandId: 'b1' });

    const call = mockConverse.mock.calls[0]?.[0] as ConverseRequest;
    expect(call.system).toContain('dashboard');
    expect(call.system).toContain('b1');
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]?.role).toBe('user');
  });

  it('tells the model the brand hint is not permission', async () => {
    mockConverse.mockResolvedValueOnce(textTurn('ok'));
    await ask(ctx(), { ...QUESTION, brandId: 'b1' });
    const call = mockConverse.mock.calls[0]?.[0] as ConverseRequest;
    expect(call.system).toMatch(/not as permission/i);
  });

  it('instructs the model never to invent figures', async () => {
    mockConverse.mockResolvedValueOnce(textTurn('ok'));
    await ask(ctx(), QUESTION);
    const call = mockConverse.mock.calls[0]?.[0] as ConverseRequest;
    expect(call.system).toMatch(/do not invent/i);
    expect(call.system).toMatch(/UNSCORED/);
  });

  it('carries prior conversation turns through', async () => {
    mockConverse.mockResolvedValueOnce(textTurn('ok'));
    await ask(ctx(), {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'follow up' },
      ],
    });
    const call = mockConverse.mock.calls[0]?.[0] as ConverseRequest;
    expect(call.messages).toHaveLength(3);
    expect(call.messages[2]?.blocks[0]).toEqual({ kind: 'text', text: 'follow up' });
  });
});
