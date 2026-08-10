'use client';

import { useState } from 'react';
import { LineChart as LineChartIcon, TrendingUp } from 'lucide-react';
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
import { LineChart, Sparkline } from '@/components/charts';
import { ViewState } from '@/components/ViewState';
import {
  Card,
  EmptyState,
  Grid,
  PageHeader,
  PanelHeader,
  Row,
  Stack,
  Trend,
} from '@/design-system';
import type { NavActions } from '@/lib/types';

export function TrendsView({ nav }: { nav: NavActions }) {
  const [ref, play] = useInView(0.1);
  const [highlight, setHighlight] = useState<string | null>(null);
  const { brandId, error: brandError } = useBrand();

  const score = useApi<ApiBrandScore>(brandId ? `/brands/${brandId}/score` : null);
  const history = useApi<ApiDimensionRow[]>(brandId ? `/brands/${brandId}/dimension-scores` : null);

  const cards = score.data ? toDimensionCards(score.data, score.data.previousDimensions) : [];
  const points = history.data ? toHistory(history.data) : [];

  // The chart takes a flat row per point; `scores` is a partial map, so a
  // dimension missing on a given day is absent rather than plotted as zero.
  const chartRows = points.map((p) => ({ label: p.label, ...p.scores }));

  return (
    <div ref={ref}>
      <PageHeader
        eyebrow="Trends & history"
        title="How perception has moved"
        subtitle="Daily rollups of the Brand Perception Index, recency-weighted with a 90-day half-life."
      />

      <ViewState
        loading={score.loading || history.loading}
        error={score.error ?? history.error ?? brandError}
        empty={null}
      >
        {cards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<TrendingUp size={22} strokeWidth={1.8} />}
              title="No dimension scores yet"
              body="The daily rollup has not produced results for this brand. Scores appear after signals have been ingested and scored."
            />
          </Card>
        ) : (
          <Stack gap="var(--s-5)">
            <Card>
              <PanelHeader
                icon={<LineChartIcon size={20} strokeWidth={1.8} />}
                title="Brand Perception Index · history"
                subtitle={`${points.length} ${points.length === 1 ? 'day' : 'days'} · recency-weighted`}
                actions={
                  <Row gap="var(--s-3)">
                    {cards.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        className="ds-chip"
                        onMouseEnter={() => setHighlight(d.key)}
                        onMouseLeave={() => setHighlight(null)}
                        onFocus={() => setHighlight(d.key)}
                        onBlur={() => setHighlight(null)}
                        onClick={() => nav.openDimension(d.key)}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: scoreColor(d.score),
                          }}
                        />
                        {d.label}
                      </button>
                    ))}
                  </Row>
                }
              />

              {points.length < 2 ? (
                // Two rollups are genuinely required to draw a line. Saying so
                // is more useful than an empty chart frame.
                <p className="ds-hint" style={{ margin: 0 }}>
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
                  highlight={highlight}
                  series={cards.map((d) => ({ key: d.key, color: scoreColor(d.score), w: 1.5 }))}
                  showDots
                />
              )}
            </Card>

            <Grid min="220px">
              {cards.map((d, i) => (
                <Card key={d.key} stagger={i * 40} onClick={() => nav.openDimension(d.key)}>
                  <div className="ds-kpi__label">{d.label}</div>
                  <Row gap="var(--s-2)">
                    <span
                      className="ds-kpi__value"
                      style={{ color: scoreColor(d.score), fontSize: 'var(--fs-h1)' }}
                    >
                      {d.score}
                    </span>
                    {/* No comparison rollup means NO delta — not a delta of zero. */}
                    {d.previous !== null && (
                      <Trend
                        direction={
                          d.score === d.previous ? 'flat' : d.score > d.previous ? 'up' : 'down'
                        }
                        value={Math.abs(d.score - d.previous).toFixed(0)}
                      />
                    )}
                  </Row>
                  {points.length >= 2 && (
                    <div style={{ margin: 'var(--s-2) 0' }}>
                      <Sparkline
                        data={chartRows}
                        dkey={d.key}
                        color={scoreColor(d.score)}
                        width={180}
                        height={44}
                        play={play}
                      />
                    </div>
                  )}
                  <div className="ds-hint">{d.signalCount.toLocaleString()} signals · dig in →</div>
                </Card>
              ))}
            </Grid>
          </Stack>
        )}
      </ViewState>
    </div>
  );
}
