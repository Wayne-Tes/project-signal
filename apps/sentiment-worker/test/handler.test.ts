import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StorageModule from '@project-signal/storage';
import type * as ScorerModule from '../src/scorer.js';

const { mockScoreSignal, mockGet } = vi.hoisted(() => ({
  mockScoreSignal: vi.fn(),
  mockGet: vi.fn(),
}));

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'onConflictDoUpdate',
    'onConflictDoNothing',
  ].forEach((m) => {
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

vi.mock('../src/scorer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ScorerModule>();
  return {
    scoreSignal: mockScoreSignal,
    /* The real error class: the handler's classification is what is under test. */
    ScoreValidationError: actual.ScoreValidationError,
    /* Unit-tested in scorer.test.ts; here it only needs to exist. */
    resolveMentions: vi.fn(() => []),
  };
});

import { LlmResponseError } from '@project-signal/llm';
import { handleItemMessage, PermanentScoringError } from '../src/handler.js';
import { ScoreValidationError } from '../src/scorer.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

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
  dimensions: ['service'],
  topics: [],
  mentions: [],
  modelVersion: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
  mockGet.mockResolvedValue(JSON.stringify({ text: 'The app keeps crashing.' }));
});

describe('handleItemMessage', () => {
  // KNOWN-GAPS #4 — the worker scored signal.sourceUrl, so every stored sentiment score was
  // the model's opinion of a URL string, written with real-looking labels and confidences.
  it('scores the stored raw text, not the source URL', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handleItemMessage('signal-1', log);

    expect(mockGet).toHaveBeenCalledWith('tenant-1/brand-1/rss/ext-1.json');
    /* Second argument is the mention candidates; third is the signal's VOICE, which picks the
       prompt — a CRM note scored as a review measures the account manager's tone. */
    expect(mockScoreSignal).toHaveBeenCalledWith(
      'The app keeps crashing.',
      expect.any(Array),
      'direct',
    );
    expect(mockScoreSignal).not.toHaveBeenCalledWith(mockSignal.sourceUrl);
  });

  /**
   * `minItems: 1` on the tool schema is a request to the model, not a guarantee from it. A
   * signal with no dimensions is still STORED (refusing it would lose a real sentiment score,
   * and inventing a dimension would be fabrication), but it must be audible (KNOWN-GAPS #30).
   */
  it('warns, but still stores, when the model returns no dimensions', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce({ ...mockScore, dimensions: [] });

    await handleItemMessage('signal-1', log);

    expect(log.warn).toHaveBeenCalledWith(
      { signalId: 'signal-1' },
      expect.stringContaining('no dimensions'),
    );
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { values: ReturnType<typeof vi.fn> };
    expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({ dimensions: [] }));
  });

  it('persists the sentiment result and logs success at info, not warn', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handleItemMessage('signal-1', log);

    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { values: ReturnType<typeof vi.fn> };
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: 'signal-1', label: 'positive', score: 0.85 }),
    );
    /* A healthy score logged as a warning made every normal signal look like a problem. */
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: 'signal-1', label: 'positive' }),
      'signal scored',
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('acks a missing signal rather than retrying forever', async () => {
    _dbRows = [];

    await expect(handleItemMessage('missing-id', log)).resolves.toBeUndefined();
    expect(mockScoreSignal).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith({ signalId: 'missing-id' }, expect.any(String));
  });

  it('keeps the committed score when writing mentions fails, and says so', async () => {
    const { resolveMentions } = await import('../src/scorer.js');
    vi.mocked(resolveMentions).mockReturnValueOnce([{ brandEntityId: 'p-1', confidence: 0.8 }]);
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { onConflictDoNothing: ReturnType<typeof vi.fn> };
    chain.onConflictDoNothing.mockImplementationOnce(() => {
      throw new Error('fk violation');
    });

    await expect(handleItemMessage('signal-1', log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: 'signal-1' }),
      'could not record mentions',
    );
  });
});

// KNOWN-GAPS #9 — the handler caught every error and returned normally, so every delivery looked
// like a success and the DLQ could never fire.
describe('failure classification', () => {
  it('rethrows a transient scoring failure so SQS retries', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new Error('429 quota exceeded'));

    await expect(handleItemMessage('signal-1', log)).rejects.toThrow('429 quota exceeded');
  });

  it('rethrows a transient storage failure so SQS retries', async () => {
    _dbRows = [mockSignal];
    mockGet.mockRejectedValueOnce(new Error('503 backend error'));

    await expect(handleItemMessage('signal-1', log)).rejects.toThrow('503 backend error');
  });

  it('treats a missing or truncated tool call as permanent', async () => {
    /* `LlmResponseError` was documented as permanent and never caught, so it went five times
       round the redrive policy — five more Bedrock calls — to the DLQ. */
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new LlmResponseError('hit the output ceiling'));

    await expect(handleItemMessage('signal-1', log)).rejects.toBeInstanceOf(PermanentScoringError);
  });

  it('treats an answer that fails validation as permanent', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new ScoreValidationError('invalid label'));

    await expect(handleItemMessage('signal-1', log)).rejects.toBeInstanceOf(PermanentScoringError);
  });

  it('raises a permanent error for a legacy URL rawStorageRef', async () => {
    // Rows written before #4 was fixed hold a bare URL, which is not a storage key.
    _dbRows = [{ ...mockSignal, rawStorageRef: 'https://example.com/review/1' }];

    await expect(handleItemMessage('signal-1', log)).rejects.toBeInstanceOf(PermanentScoringError);
    expect(mockScoreSignal).not.toHaveBeenCalled();
  });

  it('raises a permanent error when the stored payload is not JSON', async () => {
    _dbRows = [mockSignal];
    mockGet.mockResolvedValueOnce('not json at all');

    await expect(handleItemMessage('signal-1', log)).rejects.toBeInstanceOf(PermanentScoringError);
  });

  it('raises a permanent error when the stored payload has no text', async () => {
    _dbRows = [mockSignal];
    mockGet.mockResolvedValueOnce(JSON.stringify({ url: 'https://example.com' }));

    await expect(handleItemMessage('signal-1', log)).rejects.toBeInstanceOf(PermanentScoringError);
  });
});

/**
 * The voice decides which prompt the scorer uses. A public review is the customer speaking; a
 * CRM note is an employee's account of what a customer said.
 */
describe('voice', () => {
  it('passes the signal’s voice through to the scorer', async () => {
    _dbRows = [{ ...mockSignal, voice: 'reported' }];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handleItemMessage('signal-1', log);

    expect(mockScoreSignal).toHaveBeenCalledWith(
      'The app keeps crashing.',
      expect.any(Array),
      'reported',
    );
  });

  /* Every public source is direct, and a column added for the CRM must not silently reclassify
     existing signals. */
  it('defaults to direct when a signal predates the column', async () => {
    _dbRows = [{ ...mockSignal, voice: undefined }];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handleItemMessage('signal-1', log);

    expect(mockScoreSignal).toHaveBeenCalledWith(
      'The app keeps crashing.',
      expect.any(Array),
      'direct',
    );
  });
});
