import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StorageModule from '@project-signal/storage';

const { mockScoreSignal, mockGet } = vi.hoisted(() => ({
  mockScoreSignal: vi.fn(),
  mockGet: vi.fn(),
}));

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'insert', 'values', 'onConflictDoUpdate', 'onConflictDoNothing'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    signals: {},
    sentimentResults: {},
    /* Mention detection reads the tenant's other entities and their aliases, then writes to
       signal_mentions. */
    brandEntities: {},
    brandAliases: {},
    signalMentions: {},
  };
});

// keyFromRef is real: the legacy-URL rejection is behaviour under test, not a stub.
vi.mock('@project-signal/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof StorageModule>();
  return {
    getObjectStore: vi.fn(() => ({ get: mockGet, put: vi.fn() })),
    keyFromRef: actual.keyFromRef,
  };
});

vi.mock('../src/scorer.js', () => ({
  scoreSignal: mockScoreSignal,
  /* The handler resolves detected names to entity ids before writing signal_mentions. The real
     implementation is unit-tested in scorer.test.ts; here it only needs to exist. */
  resolveMentions: vi.fn(() => []),
}));

import { handlePubSubMessage, PermanentScoringError } from '../src/handler.js';

const now = new Date();
const mockSignal = {
  id: 'signal-1',
  sourceUrl: 'https://example.com/review',
  rawStorageRef: 's3://raw-bucket/tenant-1/brand-1/rss/ext-1.json',
  brandEntityId: 'brand-1',
  publishedAt: now,
};

const mockScore = {
  label: 'positive' as const,
  score: 0.85,
  confidence: 0.9,
  dimensions: {},
  topics: [],
  modelVersion: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
  mockGet.mockResolvedValue(JSON.stringify({ text: 'The app keeps crashing.' }));
});

describe('handlePubSubMessage', () => {
  // KNOWN-GAPS #4 — the worker scored signal.sourceUrl, so every stored sentiment score was
  // Gemini's opinion of a URL string, written with real-looking labels and confidences.
  it('scores the stored raw text, not the source URL', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handlePubSubMessage('signal-1');

    expect(mockGet).toHaveBeenCalledWith('tenant-1/brand-1/rss/ext-1.json');
    /* Second argument is the mention candidates — the tenant's other entities, loaded per
       signal so a product added in Admin is detected on the very next one. */
    expect(mockScoreSignal).toHaveBeenCalledWith('The app keeps crashing.', expect.any(Array));
    expect(mockScoreSignal).not.toHaveBeenCalledWith(mockSignal.sourceUrl);
  });

  /**
   * `minItems: 1` on the tool schema is a request to the model, not a guarantee from it.
   *
   * A signal that comes back with no dimensions contributes to no index, no cluster and no
   * drill-down, and used to do so in total silence — which is how two brands ended up with zero
   * rollup rows and nothing anywhere saying why. It is still STORED (refusing it would lose a
   * real sentiment score, and inventing a dimension would be fabrication), but it must be
   * audible: in the log here, and as `classifiedSignals` on `GET /brands/:id/stats`.
   */
  it('warns, but still stores, when the model returns no dimensions', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce({ ...mockScore, dimensions: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handlePubSubMessage('signal-1');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no dimensions'));

    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { values: ReturnType<typeof vi.fn> };
    expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({ dimensions: [] }));

    warn.mockRestore();
  });

  it('persists the sentiment result', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handlePubSubMessage('signal-1');

    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { values: ReturnType<typeof vi.fn> };
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: 'signal-1', label: 'positive', score: 0.85 }),
    );
  });

  it('acks a missing signal rather than retrying forever', async () => {
    _dbRows = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(handlePubSubMessage('missing-id')).resolves.toBeUndefined();
    expect(mockScoreSignal).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// KNOWN-GAPS #9 — the handler caught every error and returned normally, so Pub/Sub saw every
// delivery as a success. The DLQ, max_delivery_attempts and the retry backoff configured in
// Terraform could never fire.
describe('failure classification', () => {
  it('rethrows a transient scoring failure so Pub/Sub retries', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new Error('429 quota exceeded'));

    await expect(handlePubSubMessage('signal-1')).rejects.toThrow('429 quota exceeded');
  });

  it('rethrows a transient storage failure so Pub/Sub retries', async () => {
    _dbRows = [mockSignal];
    mockGet.mockRejectedValueOnce(new Error('503 backend error'));

    await expect(handlePubSubMessage('signal-1')).rejects.toThrow('503 backend error');
  });

  it('raises a permanent error when the model returns unparseable output', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'));

    await expect(handlePubSubMessage('signal-1')).rejects.toBeInstanceOf(PermanentScoringError);
  });

  it('raises a permanent error for a legacy URL rawStorageRef', async () => {
    // Rows written before #4 was fixed hold a bare URL, which is not a storage key.
    _dbRows = [{ ...mockSignal, rawStorageRef: 'https://example.com/review/1' }];

    await expect(handlePubSubMessage('signal-1')).rejects.toBeInstanceOf(PermanentScoringError);
    expect(mockScoreSignal).not.toHaveBeenCalled();
  });

  it('raises a permanent error when the stored payload is not JSON', async () => {
    _dbRows = [mockSignal];
    mockGet.mockResolvedValueOnce('not json at all');

    await expect(handlePubSubMessage('signal-1')).rejects.toBeInstanceOf(PermanentScoringError);
  });

  it('raises a permanent error when the stored payload has no text', async () => {
    _dbRows = [mockSignal];
    mockGet.mockResolvedValueOnce(JSON.stringify({ url: 'https://example.com' }));

    await expect(handlePubSubMessage('signal-1')).rejects.toBeInstanceOf(PermanentScoringError);
  });
});
