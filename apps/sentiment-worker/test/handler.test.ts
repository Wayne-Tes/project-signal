import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockScoreSignal = vi.hoisted(() => vi.fn());

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'insert', 'values', 'onConflictDoUpdate']
    .forEach(m => { chain[m] = vi.fn(() => chain); });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(nextRows()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    signals: {},
    sentimentResults: {},
  };
});

vi.mock('../src/scorer.js', () => ({ scoreSignal: mockScoreSignal }));

import { handlePubSubMessage } from '../src/handler.js';

const now = new Date();
const mockSignal = {
  id: 'signal-1',
  sourceUrl: 'https://example.com/review',
  brandEntityId: 'brand-1',
  publishedAt: now,
};

const mockScore = {
  label: 'positive' as const,
  score: 0.85,
  confidence: 0.9,
  dimensions: {},
  topics: [],
  modelVersion: 'gemini-1.5',
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('handlePubSubMessage', () => {
  it('scores signal and persists the sentiment result', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);

    await handlePubSubMessage('signal-1');

    expect(mockScoreSignal).toHaveBeenCalledWith(mockSignal.sourceUrl);
  });

  it('logs warning and returns early when signal is not found', async () => {
    _dbRows = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handlePubSubMessage('missing-id');

    expect(mockScoreSignal).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('catches and logs scoring errors without rethrowing', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockRejectedValueOnce(new Error('AI failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handlePubSubMessage('signal-1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('signal-1'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('uses sourceUrl as scoring text (placeholder behaviour)', async () => {
    _dbRows = [mockSignal];
    mockScoreSignal.mockResolvedValueOnce(mockScore);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handlePubSubMessage('signal-1');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('source_url'));
    warnSpy.mockRestore();
  });
});
