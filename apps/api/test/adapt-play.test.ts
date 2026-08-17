import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStructured = vi.fn();
vi.mock('@project-signal/llm', () => ({
  getLlmClient: () => ({ structured: mockStructured }),
  getReporterModel: () => 'eu.anthropic.test-model',
}));

import { ADAPT_PROMPT, adaptPlay, MAX_VERBATIMS } from '../src/lib/adapt-play.js';
import type { Play } from '@project-signal/playbook';

const play: Play = {
  id: 'p',
  title: 'Reply to negative reviews',
  summary: 's',
  match: {},
  steps: ['Step one.', 'Step two.', 'Step three.'],
  measure: 'Service score',
  owner: 'support',
  horizon: 'now',
  evidenceStatus: 'none',
  evidence: [],
};

beforeEach(() => vi.clearAllMocks());

/**
 * The model rewrites wording. It does not invent interventions and it does not produce evidence.
 * A prompt asking for that is a request; these are the enforcements.
 */
describe('adaptPlay', () => {
  it('returns the rewritten steps when the model behaves', async () => {
    mockStructured.mockResolvedValue({
      adaptedSteps: ['A.', 'B.', 'C.'],
      whatPeopleAreSaying: 'People report crashes.',
    });

    const out = await adaptPlay(play, 'crashes', ['it crashes constantly']);
    expect(out!.adaptedSteps).toEqual(['A.', 'B.', 'C.']);
    expect(out!.modelVersion).toBe('eu.anthropic.test-model');
  });

  /**
   * TRUNCATED, NOT TRUSTED. A model adding a step has invented an intervention — the one thing it
   * must not do — so the extra is discarded rather than shipped.
   */
  it('discards any step the model adds beyond the original count', async () => {
    mockStructured.mockResolvedValue({
      adaptedSteps: ['A.', 'B.', 'C.', 'Also hire a PR agency.'],
      whatPeopleAreSaying: 'x',
    });

    const out = await adaptPlay(play, 'crashes', ['it crashes']);
    expect(out!.adaptedSteps).toHaveLength(3);
    expect(out!.adaptedSteps).not.toContain('Also hire a PR agency.');
  });

  /* A silently shortened plan is worse than the curated one, so fall back entirely. */
  it('falls back rather than shipping a plan with steps missing', async () => {
    mockStructured.mockResolvedValue({ adaptedSteps: ['A.'], whatPeopleAreSaying: 'x' });
    expect(await adaptPlay(play, 'crashes', ['it crashes'])).toBeNull();
  });

  /* Adaptation sits on top of a play that already stands alone. An outage must not empty the
     roadmap, so the caller keeps the curated wording. */
  it('returns null rather than throwing when the model is unavailable', async () => {
    mockStructured.mockRejectedValue(new Error('ResourceNotFoundException'));
    expect(await adaptPlay(play, 'crashes', ['it crashes'])).toBeNull();
  });

  /**
   * No evidence means nothing to adapt from. Asking a model to personalise a play with nothing in
   * front of it is an invitation to invent the evidence.
   */
  it('refuses to adapt with no evidence to ground it', async () => {
    expect(await adaptPlay(play, 'crashes', [])).toBeNull();
    expect(await adaptPlay(play, 'crashes', ['', '  '])).toBeNull();
    expect(mockStructured).not.toHaveBeenCalled();
  });

  it('bounds how much verbatim text it sends', async () => {
    mockStructured.mockResolvedValue({
      adaptedSteps: ['A.', 'B.', 'C.'],
      whatPeopleAreSaying: 'x',
    });
    await adaptPlay(play, 'crashes', Array.from({ length: 40 }, (_, i) => `complaint ${i}`));

    const prompt = mockStructured.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('complaint 0');
    /* One very long feed must not dominate the prompt or the cost. */
    expect(prompt).not.toContain(`complaint ${MAX_VERBATIMS + 1}`);
  });
});

describe('the prompt', () => {
  it('forbids citations, studies and estimated results explicitly', () => {
    const p = ADAPT_PROMPT(play, 'crashes', ['it crashes']);
    expect(p).toMatch(/do not cite research, studies, benchmarks/i);
    expect(p).toMatch(/do not estimate results/i);
  });

  it('pins the step count so the model has a number to hit', () => {
    expect(ADAPT_PROMPT(play, 'crashes', ['x'])).toContain('exactly 3 steps');
  });

  /* The measure, owner, horizon and evidence are never sent — the model cannot alter what it was
     never given, which is a stronger guarantee than asking it not to. */
  it('never sends the fields the model must not touch', () => {
    const p = ADAPT_PROMPT(play, 'crashes', ['x']);
    expect(p).not.toContain('Service score');
    expect(p).not.toContain('evidenceStatus');
  });
});
