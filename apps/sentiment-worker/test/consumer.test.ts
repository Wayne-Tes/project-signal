import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHandle, consumerOptions } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  consumerOptions: [] as Record<string, unknown>[],
}));

vi.mock('@project-signal/messaging', () => ({
  SqsConsumer: vi.fn((opts: Record<string, unknown>) => {
    consumerOptions.push(opts);
    return { start: vi.fn(), stop: vi.fn() };
  }),
}));

vi.mock('../src/handler.js', () => {
  class PermanentScoringError extends Error {}
  return { handleItemMessage: mockHandle, PermanentScoringError };
});

const { buildApp, createItemConsumer, parseItemMessage } = await import('../src/consumer.js');
const { PermanentScoringError } = await import('../src/handler.js');

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function handler(): (body: string) => Promise<void> {
  consumerOptions.length = 0;
  createItemConsumer(log);
  return consumerOptions[0]!['handle'] as (body: string) => Promise<void>;
}

beforeEach(() => vi.clearAllMocks());

describe('parseItemMessage', () => {
  it('reads the bare signal id ingestion publishes', () => {
    expect(parseItemMessage('  sig-1 \n')).toBe('sig-1');
  });

  it('tolerates a JSON envelope', () => {
    expect(parseItemMessage('{"signalId":"sig-2"}')).toBe('sig-2');
    expect(parseItemMessage('{"id":"sig-3"}')).toBe('sig-3');
  });

  it('returns nothing for an empty body, malformed JSON, or an envelope with no id', () => {
    expect(parseItemMessage('   ')).toBeUndefined();
    expect(parseItemMessage('{not json')).toBeUndefined();
    expect(parseItemMessage('{"signalId":42}')).toBeUndefined();
  });
});

describe('createItemConsumer', () => {
  it('consumes the item queue', () => {
    handler();
    expect(consumerOptions[0]!['queue']).toBe('item');
  });

  it('scores the signal the message names', async () => {
    mockHandle.mockResolvedValue(undefined);
    await handler()('sig-1');
    expect(mockHandle).toHaveBeenCalledWith('sig-1', log);
  });

  it('discards a message with no signal id instead of dead-lettering it slowly', async () => {
    /* It will never parse. Resolving lets the consumer delete it at once rather than spend five
       deliveries reaching the same conclusion. */
    await expect(handler()('{"nope":true}')).resolves.toBeUndefined();
    expect(mockHandle).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('acks a permanent scoring failure', async () => {
    mockHandle.mockRejectedValue(new PermanentScoringError('unusable output'));
    await expect(handler()('sig-1')).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: 'sig-1' }),
      'permanent scoring failure — acking',
    );
  });

  it('rethrows a transient failure so the message is retried', async () => {
    mockHandle.mockRejectedValue(new Error('ThrottlingException'));
    await expect(handler()('sig-1')).rejects.toThrow('ThrottlingException');
  });

  it('routes consumer-level failures to the error log', () => {
    handler();
    (consumerOptions[0]!['onError'] as (e: unknown, b: string) => void)(new Error('x'), 'b');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'b' }),
      'scoring message failed',
    );
  });
});

describe('HTTP surface', () => {
  it('serves health and readiness only', async () => {
    const app = buildApp({ logger: false });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      service: 'sentiment-worker',
    });
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('no longer exposes the unauthenticated Pub/Sub push route', async () => {
    /* A GCP survivor that nothing called on AWS, and which would score any id it was handed. */
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'POST', url: '/pubsub/item', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
