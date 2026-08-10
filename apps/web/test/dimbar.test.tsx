import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toDimensionCards, type ApiBrandScore, type ApiDimensionRow } from '@/lib/brand-data';

/**
 * The dimension bar's change indicator.
 *
 * THE DEFECT THIS CLOSES, reported from the running product: every dimension on the dashboard
 * showed a green `▲ +0`, permanently, for every brand, no matter how much history existed.
 *
 * Two lines caused it, and neither looked wrong on its own:
 *
 *   1. `toDimensionCards(score.data)` was called with ONE argument in all four views. The second
 *      parameter, `previousRows`, defaults to `[]` — so `previous` came back null every time.
 *   2. `Dashboard.tsx` then wrote `prev: d.previous ?? d.score`, comparing each dimension with
 *      ITSELF. `score - score` is 0, and `Delta` renders 0 as a confident green up-arrow.
 *
 * So it was never "no movement yet". It was a fabricated comparison that could never show
 * movement, asserting stability that had not been measured — worse than showing nothing, because
 * a user reasonably reads it as "checked, and steady".
 *
 * The type now makes the fallback impossible: `Dimension.prev` is `number | null`.
 */

vi.mock('@/hooks/useCountUp', () => ({ useCountUp: (v: number) => v }));

const { DimBar } = await import('../src/components/DimBar');

const dim = (over: Partial<ApiDimensionRow> = {}): ApiDimensionRow => ({
  dimension: 'trust',
  score: 60,
  date: '2026-08-10',
  signalCount: 5,
  ...over,
});

const score = (over: Partial<ApiBrandScore> = {}): ApiBrandScore => ({
  score: 60,
  previousScore: null,
  date: '2026-08-10',
  previousDate: null,
  dimensions: [dim()],
  previousDimensions: [],
  ...over,
});

function bar(prev: number | null, current = 60) {
  render(
    <DimBar
      dim={{ key: 'trust', label: 'Trust', score: current, prev, weight: 0, blurb: '5 signals' }}
      play={false}
    />,
  );
}

describe('when there is nothing to compare against', () => {
  it('says so instead of rendering +0', () => {
    bar(null);

    expect(screen.getByText(/no prior data/i)).toBeInTheDocument();
    /* The exact string the owner saw on every bar. */
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('draws no previous-value marker', () => {
    /* Drawn at the current score it reads as "the score has never moved" — the same false
       reassurance the +0 gave, in graphical form. */
    const { container } = render(
      <DimBar
        dim={{ key: 'trust', label: 'Trust', score: 60, prev: null, weight: 0, blurb: '' }}
        play={false}
      />,
    );
    expect(container.querySelector('.dimbar-prev')).toBeNull();
  });
});

describe('when a real comparison exists', () => {
  it('reports a rise', () => {
    /* Asserted on the rendered delta rather than a bare text node: `Delta` emits the sign and
       the number as sibling nodes, so its textContent is "+8" and no element reads exactly "8". */
    bar(52, 60);
    expect(document.querySelector('.delta.up')?.textContent).toContain('+8');
    expect(screen.queryByText(/no prior data/i)).not.toBeInTheDocument();
  });

  it('reports a fall', () => {
    bar(71, 60);
    expect(document.querySelector('.delta.down')?.textContent).toContain('11');
  });

  it('renders a genuine zero as a delta, not as "no data"', () => {
    /* A dimension that truly has not moved between two rollups is a real, useful fact — and it
       must be distinguishable from never having been compared. */
    bar(60, 60);
    expect(screen.queryByText(/no prior data/i)).not.toBeInTheDocument();
    expect(document.querySelector('.delta')).not.toBeNull();
  });

  it('draws the previous-value marker at the previous score', () => {
    const { container } = render(
      <DimBar
        dim={{ key: 'trust', label: 'Trust', score: 60, prev: 52, weight: 0, blurb: '' }}
        play={false}
      />,
    );
    expect(container.querySelector<HTMLElement>('.dimbar-prev')?.style.left).toBe('52%');
  });

  it('does not report false precision', () => {
    /* 60.04 - 52.01 is 8.030000000000001 in binary floating point, which rendered verbatim. */
    bar(52.01, 60.04);
    const shown = document.querySelector('.delta')?.textContent ?? '';
    expect(shown).toContain('8');
    expect(shown).not.toContain('8.030000');
  });
});

describe('the mapping that fed it', () => {
  it('produces a null previous when no comparison rollup exists', () => {
    const [card] = toDimensionCards(score());
    expect(card!.previous).toBeNull();
  });

  it('produces a real previous when the API supplies one', () => {
    /* The API always computed these rows — it needs them for `previousScore` — and discarded
       them until now, which is the upstream half of the same defect. */
    const [card] = toDimensionCards(score(), [dim({ score: 52, date: '2026-08-03' })]);
    expect(card!.previous).toBe(52);
  });

  it('leaves previous null for a dimension missing from the comparison rollup', () => {
    /* A dimension with no signals on the earlier date is absent from that rollup. Treating it as
       zero would render a fictitious 60-point rise. */
    const [card] = toDimensionCards(score(), [dim({ dimension: 'value', score: 40 })]);
    expect(card!.previous).toBeNull();
  });
});
