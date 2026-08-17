import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { changeHeadline, formatDelta, sentimentTone, type ApiWhatsNew } from '@/lib/brand-data';

const mockUseApi = vi.fn();
vi.mock('@/hooks/useApi', () => ({ useApi: (url: string | null) => mockUseApi(url) }));
vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({ brandId: 'brand-1', error: null }),
}));

import { WhatsChangedView } from '@/views/WhatsChanged';

const nav = {
  openOverview: vi.fn(),
  openDimension: vi.fn(),
  openCluster: vi.fn(),
  openTopic: vi.fn(),
  to: vi.fn(),
  close: vi.fn(),
};

const topic = (over: Partial<ApiWhatsNew['newTopics'][number]> = {}) => ({
  topic: 'pricing',
  volume: 4,
  previousVolume: 2,
  sentiment: -0.4,
  previousSentiment: 0.2,
  volumeDelta: 2,
  sentimentDelta: -0.6,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  isNew: false,
  sampleSignalIds: ['s1'],
  ...over,
});

const payload = (over: Partial<ApiWhatsNew> = {}): ApiWhatsNew => ({
  basis: 'ingested',
  from: '2026-08-10T00:00:00.000Z',
  to: '2026-08-17T00:00:00.000Z',
  signalsThisPeriod: 12,
  signalsPreviousPeriod: 9,
  backfilledThisPeriod: 0,
  sentiment: -0.2,
  previousSentiment: 0.1,
  sentimentDelta: -0.3,
  newTopics: [],
  risingTopics: [],
  fallingTopics: [],
  improvingTopics: [],
  worseningTopics: [],
  bySource: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseApi.mockReturnValue({ data: payload(), loading: false, error: null });
});

/**
 * `formatDelta` returns `null` for an absent comparison rather than a string, so a caller cannot
 * accidentally render "+0". That substitution is what put a green `▲ +0` improvement marker on
 * every dimension bar against a comparison point that did not exist.
 */
describe('formatDelta', () => {
  it('refuses to produce a string when there is nothing to compare', () => {
    expect(formatDelta(null)).toBeNull();
  });

  it('says "no change" for a real zero, which is a genuine finding', () => {
    expect(formatDelta(0)).toBe('no change');
    expect(formatDelta(0.001, 2)).toBe('no change');
  });

  it('signs the number, using a true minus so digits stay aligned', () => {
    expect(formatDelta(3)).toBe('+3');
    /* U+2212, not a hyphen — a hyphen is narrower than a digit and breaks the column. */
    expect(formatDelta(-3)).toBe('−3');
  });
});

describe('sentimentTone', () => {
  it('is neutral when there is no comparison or no movement', () => {
    expect(sentimentTone(null)).toBe('var(--t2)');
    expect(sentimentTone(0)).toBe('var(--t2)');
  });

  it('colours direction, and only ever with tokens', () => {
    expect(sentimentTone(0.4)).toBe('var(--mint)');
    expect(sentimentTone(-0.4)).toBe('var(--coral)');
    for (const v of [null, 0, 0.4, -0.4]) {
      expect(sentimentTone(v)).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe('changeHeadline', () => {
  it('reads as a sentence a person could put in a report', () => {
    const text = changeHeadline(payload({ newTopics: [topic({ isNew: true })] }), 7);
    expect(text).toContain('12 signals collected this week');
    expect(text).toContain('Sentiment is down 0.30');
    expect(text).toContain('1 new subject');
  });

  /* Connecting a feed imports its whole history at once. Reporting that as a week's conversation
     is the first thing a reader would spot as wrong — after acting on it. */
  it('calls out backfilled material rather than counting it as new conversation', () => {
    const text = changeHeadline(payload({ backfilledThisPeriod: 9 }), 7);
    expect(text).toContain('9 are older material newly picked up');
  });

  it('says there is no comparison rather than implying no change', () => {
    const text = changeHeadline(payload({ sentimentDelta: null, previousSentiment: null }), 7);
    expect(text).toContain('No earlier period to compare against yet');
    expect(text).not.toMatch(/unchanged/);
  });

  it('distinguishes a quiet period from a period that never had anything', () => {
    expect(changeHeadline(payload({ signalsThisPeriod: 0, signalsPreviousPeriod: 5 }), 7)).toContain(
      '5 arrived in the period before it',
    );
    expect(
      changeHeadline(payload({ signalsThisPeriod: 0, signalsPreviousPeriod: 0 }), 7),
    ).toBe('Nothing collected this week.');
  });
});

describe('WhatsChangedView', () => {
  it('asks the API for the selected window and basis', () => {
    render(<WhatsChangedView nav={nav} />);
    expect(mockUseApi).toHaveBeenCalledWith('/brands/brand-1/whats-new?days=7&basis=ingested');
  });

  it('re-queries when the window changes', async () => {
    render(<WhatsChangedView nav={nav} />);
    await userEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(mockUseApi).toHaveBeenLastCalledWith('/brands/brand-1/whats-new?days=30&basis=ingested');
  });

  it('re-queries when the basis changes', async () => {
    render(<WhatsChangedView nav={nav} />);
    await userEvent.click(screen.getByRole('button', { name: 'Newly published' }));
    expect(mockUseApi).toHaveBeenLastCalledWith('/brands/brand-1/whats-new?days=7&basis=published');
  });

  /**
   * "Nothing got worse" is a genuine finding and the most reassuring thing this page can say. An
   * empty panel says nothing and reads as broken — which is how a working feature gets reported
   * as a bug.
   */
  it('says nothing got worse, rather than showing an empty box', () => {
    render(<WhatsChangedView nav={nav} />);
    expect(screen.getByText(/Nothing got materially worse/)).toBeInTheDocument();
  });

  it('opens a subject directly, with no fabricated dimension above it', async () => {
    mockUseApi.mockReturnValue({
      data: payload({ worseningTopics: [topic()] }),
      loading: false,
      error: null,
    });
    render(<WhatsChangedView nav={nav} />);

    await userEvent.click(screen.getByRole('button', { name: /pricing/ }));
    expect(nav.openTopic).toHaveBeenCalledWith('pricing');
    /* `openCluster` would insert a dimension level the user never walked through, putting a step
       in the breadcrumb that did not happen. */
    expect(nav.openCluster).not.toHaveBeenCalled();
  });

  it('marks a source that stopped producing instead of dropping it from the table', () => {
    mockUseApi.mockReturnValue({
      data: payload({
        bySource: [
          {
            source: 'reddit',
            volume: 0,
            previousVolume: 6,
            sentiment: null,
            previousSentiment: -0.3,
            sentimentDelta: null,
          },
        ],
      }),
      loading: false,
      error: null,
    });
    render(<WhatsChangedView nav={nav} />);

    expect(screen.getByText('reddit')).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
  });

  it('says "no prior data" where a comparison is missing, never a zero', () => {
    mockUseApi.mockReturnValue({
      data: payload({
        worseningTopics: [],
        newTopics: [topic({ isNew: true, previousVolume: 0, sentimentDelta: null })],
      }),
      loading: false,
      error: null,
    });
    render(<WhatsChangedView nav={nav} />);
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });
});
