import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStructured = vi.fn();
const MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

vi.mock('@project-signal/llm', () => ({
  getLlmClient: vi.fn(() => ({ structured: mockStructured })),
  getScorerModel: vi.fn(() => MODEL),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // clearAllMocks resets calls but NOT implementations, so a mockReturnValue set by one test
  // leaks into the next. Restore the default explicitly.
  const llm = await import('@project-signal/llm');
  vi.mocked(llm.getScorerModel).mockReturnValue(MODEL);
  mockStructured.mockResolvedValue({
    label: 'negative',
    score: -0.8,
    confidence: 0.9,
    dimensions: ['service'],
    topics: ['fees'],
  });
});

describe('scoreSignal', () => {
  it('returns the model output stamped with the model version', async () => {
    const { scoreSignal } = await import('../src/scorer.js');
    const result = await scoreSignal('The app keeps crashing.');

    expect(result).toEqual({
      label: 'negative',
      score: -0.8,
      confidence: 0.9,
      dimensions: ['service'],
      topics: ['fees'],
      modelVersion: MODEL,
    });
  });

  it('stamps modelVersion from the resolved model, not a hardcoded string', async () => {
    // modelVersion is the audit trail for how a score was produced. Hardcoding it would make
    // every historical row claim whichever model was current when the constant was written.
    const llm = await import('@project-signal/llm');
    vi.mocked(llm.getScorerModel).mockReturnValue('eu.anthropic.claude-sonnet-5');
    const { scoreSignal } = await import('../src/scorer.js');
    await expect(scoreSignal('x')).resolves.toMatchObject({
      modelVersion: 'eu.anthropic.claude-sonnet-5',
    });
  });

  it('asks for the sentiment shape with a forced tool call', async () => {
    const { scoreSignal, SENTIMENT_SCHEMA } = await import('../src/scorer.js');
    await scoreSignal('The app keeps crashing.');

    const req = mockStructured.mock.calls[0]![0];
    expect(req.model).toBe(MODEL);
    expect(req.name).toBe('record_sentiment');
    expect(req.schema).toBe(SENTIMENT_SCHEMA);
    expect(req.prompt).toContain('The app keeps crashing.');
  });

  it('pins the five dimensions and four labels to the shared taxonomy', async () => {
    // The rollup filters on these exact strings; a drift here would silently produce
    // dimension scores that never match any signal.
    const { SENTIMENT_SCHEMA } = await import('../src/scorer.js');
    expect(SENTIMENT_SCHEMA.properties.dimensions.items.enum).toEqual([
      'trust',
      'quality',
      'service',
      'value',
      'experience',
    ]);
    expect(SENTIMENT_SCHEMA.properties.label.enum).toEqual([
      'positive',
      'negative',
      'neutral',
      'mixed',
    ]);
  });

  it('requires every field the sentiment_results row needs', async () => {
    const { SENTIMENT_SCHEMA } = await import('../src/scorer.js');
    expect(SENTIMENT_SCHEMA.required).toEqual([
      'label',
      'score',
      'confidence',
      'dimensions',
      'topics',
    ]);
  });

  it('propagates a provider failure so the caller can classify it', async () => {
    mockStructured.mockRejectedValue(new Error('ThrottlingException'));
    const { scoreSignal } = await import('../src/scorer.js');
    await expect(scoreSignal('x')).rejects.toThrow(/ThrottlingException/);
  });
});
