import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApiCluster } from '@/lib/brand-data';

/**
 * The drill-down's dimension level.
 *
 * THE DEFECT THIS FILE EXISTS FOR — reported from the running product, with two screenshots.
 * Level 1 showed `Experience — 5 signals contributed`, at 69.2, the brand's HIGHEST dimension.
 * Clicking it showed `No topic cluster has been tagged to experience yet`.
 *
 * Neither statement was wrong on its own. Level 1 reads `dimension_scores.signal_count`; level 2
 * read `/brand-impact`, which excludes zero-damage clusters BY DESIGN — "a topic nobody is
 * negative about is not a weakness". A dimension people are positive about therefore has no
 * qualifying cluster at all. The consequence is perverse: the better a dimension performs, the
 * more certain its drill-down is to be empty, and the one screen whose entire purpose is to trace
 * a number to its evidence had no route from a count of five to those five things.
 *
 * The unit suite could not have caught it. Every component, endpoint and scoring function was
 * individually correct; the fault was in which endpoint the level asked. So these tests assert on
 * the URLs requested as well as on what is rendered — a test that only mocked `useApi` flat and
 * checked the copy would pass against the broken version.
 */

/** Every URL the component asked for, in order, so the wiring itself is under test. */
let requested: string[] = [];
let topics: ApiCluster[] = [];
let signals: { id: string; source: string; sourceUrl: string | null; publishedAt: string }[] = [];
let loading = false;

vi.mock('@/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (url) requested.push(url);
    if (loading) return { data: null, loading: true, error: null };
    if (url?.includes('/topics')) return { data: topics, loading: false, error: null };
    if (url?.includes('/signals')) return { data: { items: signals }, loading: false, error: null };
    return { data: null, loading: false, error: null };
  },
}));

vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({ brandId: 'brand-1', selected: { id: 'brand-1', name: 'Tes' } }),
}));

const { DrillDown } = await import('../src/components/DrillDown');

import type { NavLevel } from '@/lib/types';

const nav = {
  openOverview: vi.fn(),
  openDimension: vi.fn(),
  openCluster: vi.fn(),
  to: vi.fn(),
  close: vi.fn(),
};

const EXPERIENCE: NavLevel = { kind: 'dimension', dimKey: 'experience' };

function cluster(over: Partial<ApiCluster> = {}): ApiCluster {
  return {
    topic: 'helpful support',
    volume: 4,
    negativity: 0,
    positivity: 0.8,
    recency: 0.97,
    damage: 0,
    strength: 3.1,
    sentiment: 0.8,
    dimensions: ['experience'],
    ...over,
  };
}

function signal(over: Partial<(typeof signals)[number]> = {}) {
  return {
    id: 'sig-1',
    source: 'rss',
    sourceUrl: 'https://example.test/a',
    publishedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requested = [];
  topics = [];
  signals = [];
  loading = false;
});

describe('which endpoint the dimension level asks', () => {
  it('asks /topics for the dimension, not /brand-impact', () => {
    /* The whole defect in one assertion. `/brand-impact` cannot answer this question for a
       well-performing dimension, whatever the level does with the response. */
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(requested.some((u) => u.includes('/topics?dimension=experience'))).toBe(true);
    expect(requested.some((u) => u.includes('/brand-impact'))).toBe(false);
  });

  it('also asks for the signals scored on that dimension', () => {
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);
    expect(requested.some((u) => u.includes('/signals') && u.includes('dimension=experience'))).toBe(
      true,
    );
  });

  it('encodes the dimension rather than pasting it into the URL', () => {
    render(<DrillDown path={[{ kind: 'dimension', dimKey: 'a b&c' }]} nav={nav} />);
    expect(requested.every((u) => !u.includes('a b&c'))).toBe(true);
    expect(requested.some((u) => u.includes('a%20b%26c'))).toBe(true);
  });
});

describe('a dimension whose signals are positive', () => {
  it('shows the topic that /brand-impact would have hidden', () => {
    topics = [cluster()];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText('helpful support')).toBeInTheDocument();
    expect(screen.queryByText(/No topic cluster has been tagged/i)).not.toBeInTheDocument();
  });

  it('reports strength rather than a damage of 0.0', () => {
    /* "damage 0.0" on a positive topic reads as a broken number, not as good news. */
    topics = [cluster()];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/strength 3\.1/)).toBeInTheDocument();
    expect(screen.queryByText(/damage/i)).not.toBeInTheDocument();
  });

  it('still reports damage for a topic that has some', () => {
    topics = [cluster({ topic: 'slow replies', damage: 2.4, strength: 0, negativity: 0.6, positivity: 0, sentiment: -0.6 })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/damage 2\.4/)).toBeInTheDocument();
  });

  it('falls back to the volume when a topic is purely neutral', () => {
    /* Neutral clusters carry neither measure, and printing "strength 0.0" would be as
       meaningless as the damage it replaced. */
    topics = [cluster({ topic: 'timetables', damage: 0, strength: 0, positivity: 0, sentiment: 0, volume: 2 })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/2 signals/)).toBeInTheDocument();
  });
});

describe('the promise that a number traces to its evidence', () => {
  it('lists the contributing signals even when a topic has formed', () => {
    topics = [cluster()];
    signals = [signal(), signal({ id: 'sig-2' })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/Signals tagged to experience/i)).toBeInTheDocument();
    expect(screen.getAllByText('read the original ↗')).toHaveLength(2);
  });

  it('lists the signals when NO topic has formed, instead of dead-ending', () => {
    /* This is the exact state the owner hit, minus the misleading copy: five signals scored on
       the dimension, no cluster meeting any ranking threshold. The level used to say nothing had
       been tagged to it, which was false — five things had. */
    topics = [];
    signals = [signal(), signal({ id: 'sig-2' })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/No topic has formed yet/i)).toBeInTheDocument();
    expect(screen.getAllByText('read the original ↗')).toHaveLength(2);
  });

  it('says nothing has been scored only when that is actually true', () => {
    topics = [];
    signals = [];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText(/Nothing has been scored on experience yet/i)).toBeInTheDocument();
  });

  it('shows the source a signal came from', () => {
    signals = [signal({ source: 'reddit' })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);
    expect(screen.getByText('Reddit')).toBeInTheDocument();
  });

  it('says so rather than rendering a dead link when no URL was recorded', () => {
    signals = [signal({ sourceUrl: null })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);
    expect(screen.getByText('no source URL recorded')).toBeInTheDocument();
  });

  it('shows a loading state rather than the empty message while fetching', () => {
    /* Rendering "nothing has been scored" during the fetch is the same lie as before, just
       briefer. */
    loading = true;
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been scored/i)).not.toBeInTheDocument();
  });
});

describe('navigating on into a topic', () => {
  it('opens the cluster the user clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    topics = [cluster({ topic: 'helpful support' })];
    render(<DrillDown path={[EXPERIENCE]} nav={nav} />);

    await userEvent.click(screen.getByText('helpful support'));
    expect(nav.openCluster).toHaveBeenCalledWith('helpful support', 'experience');
  });
});
