'use client';
import { useState } from 'react';
import { useInView } from '@/hooks/useInView';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import {
  toDimensionCards,
  toHistory,
  type ApiBrandScore,
  type ApiDimensionRow,
} from '@/lib/brand-data';
import { scoreColor } from '@/lib/utils';
import { Delta } from '@/components/primitives';
import { LineChart, Sparkline } from '@/components/charts';
import { ViewState } from '@/components/ViewState';
import type { NavActions } from '@/lib/types';

export function TrendsView({ nav }: { nav: NavActions }) {
  const [ref, play] = useInView(0.1);
  const [hl, setHl] = useState<string | null>(null);
  const { brandId, error: brandError } = useBrand();

  const score = useApi<ApiBrandScore>(brandId ? `/brands/${brandId}/score` : null);
  const history = useApi<ApiDimensionRow[]>(brandId ? `/brands/${brandId}/dimension-scores` : null);

  const cards = score.data ? toDimensionCards(score.data) : [];
  const points = history.data ? toHistory(history.data) : [];

  // The chart takes a flat row per point; scores is a partial map, so a dimension missing on a
  // given day is simply absent rather than plotted as zero.
  const chartRows = points.map((p) => ({ label: p.label, ...p.scores }));

  return (
    <div className="content view-enter" ref={ref}>
      <ViewState
        loading={score.loading || history.loading}
        error={score.error ?? history.error ?? brandError}
        empty={
          cards.length === 0
            ? 'No dimension scores yet — the daily rollup has not produced results for this brand.'
            : null
        }
      >
        <div className="card" style={{ padding: '22px 24px', marginBottom: 18 }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 16 }}>
            <h3>Brand Perception Index · history</h3>
            <span className="sub">
              {points.length} {points.length === 1 ? 'day' : 'days'} · recency-weighted
            </span>
            <div className="spacer" />
            <div className="legend" onMouseLeave={() => setHl(null)}>
              {cards.map((d) => (
                <span
                  className="it"
                  key={d.key}
                  onMouseEnter={() => setHl(d.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="sw" style={{ background: scoreColor(d.score) }} />
                  {d.label}
                </span>
              ))}
            </div>
          </div>
          {points.length < 2 ? (
            <p style={{ color: 'var(--t3)', fontSize: 13, margin: '8px 0 0' }}>
              A trend needs at least two daily rollups. There{' '}
              {points.length === 1 ? 'is one so far' : 'are none yet'}.
            </p>
          ) : (
            <LineChart
              data={chartRows}
              width={1180}
              height={340}
              yMin={0}
              yMax={100}
              play={play}
              highlight={hl}
              series={cards.map((d) => ({ key: d.key, color: scoreColor(d.score), w: 1.5 }))}
              showDots
            />
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: `repeat(${cards.length || 1},1fr)` }}>
          {cards.map((d) => (
            <button
              key={d.key}
              className="card clickable"
              style={{ padding: '16px 16px 8px', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => nav.openDimension(d.key)}
            >
              <div className="lab kicker">{d.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px' }}>
                <span
                  className="num"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 30,
                    fontWeight: 600,
                    color: scoreColor(d.score),
                  }}
                >
                  {d.score}
                </span>
                {/* No comparison rollup yet means no delta — not a delta of zero. */}
                {d.previous !== null && <Delta value={d.score - d.previous} />}
              </div>
              {points.length >= 2 && (
                <Sparkline
                  data={chartRows}
                  dkey={d.key}
                  color={scoreColor(d.score)}
                  width={180}
                  height={44}
                  play={play}
                />
              )}
              <div className="drill-hint" style={{ margin: '8px 0 6px' }}>
                {d.signalCount.toLocaleString()} signals · dig in →
              </div>
            </button>
          ))}
        </div>
      </ViewState>
    </div>
  );
}
