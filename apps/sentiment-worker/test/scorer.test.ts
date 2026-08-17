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
      /* Always present, even when a tenant tracks no products — a caller should never have
         to distinguish "no mentions" from "this field does not exist". */
      mentions: [],
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

  /**
   * A signal scored into no dimension contributes to no index, no cluster and no drill-down.
   *
   * `scoreAllDimensions` omits dimensions nothing touches and the rollup skips a brand when that
   * leaves it empty, so `dimensions: []` silently removes the signal from every surface in the
   * product — and, at low volume, removes its whole brand from the rollup. Two brands sat at zero
   * rollup rows on exactly this path.
   *
   * The old description ("Omit any it does not") actively invited it on the short factual text
   * that most of a news feed consists of.
   */
  it('requires at least one dimension, so a signal cannot be scored into nothing', async () => {
    const { SENTIMENT_SCHEMA } = await import('../src/scorer.js');
    expect(SENTIMENT_SCHEMA.properties.dimensions.minItems).toBe(1);
    expect(SENTIMENT_SCHEMA.properties.dimensions.description).toMatch(/at least one/i);
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

describe('mention detection', () => {
  const CANDIDATES = [
    { id: 'p-assess', name: 'Tes Assess', aliases: ['Assess', 'TA'] },
    { id: 'p-teach', name: 'Blendspace', aliases: [] },
  ];

  it('omits the candidate block entirely when a tenant tracks no products', async () => {
    /* Most tenants have none. Sending an empty list would spend tokens on every signal telling
       the model about nothing. */
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    expect(PROMPT_TEMPLATE('a review')).not.toMatch(/tracked/i);
    expect(PROMPT_TEMPLATE('a review', [])).not.toMatch(/tracked/i);
  });

  it('lists candidates with their aliases', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    const prompt = PROMPT_TEMPLATE('a review', CANDIDATES);
    expect(prompt).toContain('Tes Assess (also: Assess, TA)');
    expect(prompt).toContain('- Blendspace');
    /* The instruction that stops the model attributing from general subject matter. */
    expect(prompt).toMatch(/do not invent/i);
  });

  it('asks for names, never ids', async () => {
    /* Asking a model to echo a uuid invites it to invent a plausible-looking one, which either
       breaks a foreign key or — worse — matches an unrelated row. */
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    expect(PROMPT_TEMPLATE('a review', CANDIDATES)).not.toContain('p-assess');
  });

  describe('resolveMentions', () => {
    it('resolves a name to its entity id', async () => {
      const { resolveMentions } = await import('../src/scorer.js');
      expect(resolveMentions([{ name: 'Tes Assess', confidence: 0.9 }], CANDIDATES)).toEqual([
        { brandEntityId: 'p-assess', confidence: 0.9 },
      ]);
    });

    it('resolves an alias', async () => {
      const { resolveMentions } = await import('../src/scorer.js');
      expect(resolveMentions([{ name: 'TA', confidence: 0.5 }], CANDIDATES)[0]?.brandEntityId).toBe(
        'p-assess',
      );
    });

    it('tolerates case and whitespace the model did not preserve', async () => {
      /* Told "exactly as written", a model will still return "TES ASSESS". Failing on that would
         throw away correct attributions over capitalisation. */
      const { resolveMentions } = await import('../src/scorer.js');
      for (const name of ['  tes assess ', 'TES ASSESS', 'Tes  Assess']) {
        const got = resolveMentions([{ name, confidence: 1 }], CANDIDATES);
        expect(got[0]?.brandEntityId, name).toBe('p-assess');
      }
    });

    it('DROPS a name that is not a candidate', async () => {
      /* The model was told not to invent names. When it does anyway, ignoring it is right —
         one hallucinated product must not cost us a real sentiment score, and a fabricated id
         would either break a foreign key or match something unrelated. */
      const { resolveMentions } = await import('../src/scorer.js');
      expect(resolveMentions([{ name: 'Tes Invented', confidence: 0.99 }], CANDIDATES)).toEqual([]);
    });

    it('deduplicates a name and its alias resolving to the same entity', async () => {
      const { resolveMentions } = await import('../src/scorer.js');
      const got = resolveMentions(
        [
          { name: 'Tes Assess', confidence: 0.9 },
          { name: 'Assess', confidence: 0.4 },
        ],
        CANDIDATES,
      );
      expect(got).toHaveLength(1);
    });

    it('clamps confidence into range', async () => {
      const { resolveMentions } = await import('../src/scorer.js');
      expect(resolveMentions([{ name: 'Blendspace', confidence: 1.4 }], CANDIDATES)[0]?.confidence).toBe(1);
      expect(resolveMentions([{ name: 'Blendspace', confidence: -3 }], CANDIDATES)[0]?.confidence).toBe(0);
    });

    it('handles a missing or non-numeric confidence', async () => {
      const { resolveMentions } = await import('../src/scorer.js');
      const got = resolveMentions([{ name: 'Blendspace' } as never], CANDIDATES);
      expect(got[0]?.confidence).toBe(0);
    });

    it('records one article mentioning several products', async () => {
      /* The case a single foreign key cannot express, and the reason signal_mentions exists. */
      const { resolveMentions } = await import('../src/scorer.js');
      const got = resolveMentions(
        [
          { name: 'Tes Assess', confidence: 0.8 },
          { name: 'Blendspace', confidence: 0.6 },
        ],
        CANDIDATES,
      );
      expect(got.map((m) => m.brandEntityId)).toEqual(['p-assess', 'p-teach']);
    });
  });
});

/**
 * A CRM note is not a review, and scoring it as one measures the wrong person.
 *
 * A calm account manager relaying a furious customer reads as mild; a frustrated one relaying a
 * minor issue reads as severe. Either way the number describes the note-writer's tone rather than
 * the customer's view — and it would be indistinguishable from a real score, which is the
 * expensive kind of wrong.
 */
describe('the reported-voice prompt', () => {
  it('asks for the customer’s sentiment, not the writer’s', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    const p = PROMPT_TEMPLATE('Call notes: they are unhappy about pricing.', [], 'reported');

    expect(p).toMatch(/THE CUSTOMER'S sentiment/);
    expect(p).toMatch(/not the tone of the person writing/i);
    /* It must not be framed as a review — that framing is the defect. */
    expect(p).not.toMatch(/following customer review/i);
  });

  it('tells the model to ignore internal commentary', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    const p = PROMPT_TEMPLATE('x', [], 'reported');
    expect(p).toMatch(/next steps/i);
    expect(p).toMatch(/renewal or pipeline administration/i);
  });

  /* A note with no customer view in it must produce neutral-with-low-confidence, not an inferred
     sentiment. Inferring one manufactures signal out of admin. */
  it('tells the model to decline rather than infer when there is no customer view', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    expect(PROMPT_TEMPLATE('x', [], 'reported')).toMatch(
      /neutral with low\s+confidence rather than inferring/i,
    );
  });

  it('leaves the public-review prompt untouched by default', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    const p = PROMPT_TEMPLATE('The app keeps crashing.');
    expect(p).toContain('Analyse the brand sentiment of the following customer review.');
    expect(p).not.toMatch(/internal note/i);
  });

  it('still appends the mention candidates for a reported note', async () => {
    const { PROMPT_TEMPLATE } = await import('../src/scorer.js');
    const p = PROMPT_TEMPLATE('x', [{ id: 'a', name: 'Class Charts', aliases: [] }], 'reported');
    expect(p).toContain('Class Charts');
  });
});
