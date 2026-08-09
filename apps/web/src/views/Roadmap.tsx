'use client';

import { ListChecks } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import { toActionCards, type ApiCluster } from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, Grid, PageHeader, Row } from '@/design-system';
import type { NavActions } from '@/lib/types';

/**
 * Action roadmap — what to fix first, derived from real Brand impact clusters.
 *
 * This view previously rendered `PS_ROADMAP`: hand-written recommendations for a fictional bank
 * with invented point-uplifts, effort estimates and confidence percentages, above a header
 * claiming they were "generated weekly by Gemini Pro". None of that was true, and a header
 * asserting an LLM produced a fabricated list is worse than the fabrication alone.
 *
 * Every number here now comes from the API's damage ranking. Effort, confidence and projected
 * uplift are GONE rather than reimplemented: the product has no model of what a fix costs, and
 * with a 90-day half-life on the index there is no honest point prediction to make. Share of
 * current damage is a real quantity; "+3.4 pts" was not.
 */
export function RoadmapView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError } = useBrand();
  const { data, loading, error } = useApi<ApiCluster[]>(
    brandId ? `/brands/${brandId}/brand-impact` : null,
  );
  const actions = data ? toActionCards(data) : [];

  const tone = (p: string): 'critical' | 'warn' | 'info' =>
    p === 'Critical' ? 'critical' : p === 'High' ? 'warn' : 'info';

  return (
    <>
      <PageHeader
        eyebrow="Action roadmap"
        title="What to fix first"
        subtitle="Ordered by the damage each subject is doing now — volume × negative sentiment × recency. Open one to read the signals behind it."
      />

      <ViewState loading={loading} error={error ?? brandError} empty={null}>
        {actions.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ListChecks size={22} strokeWidth={1.8} />}
              title="No actions to rank yet"
              body="Actions are derived from the subjects damaging your score. Nothing has scored negatively enough to rank — which is also what you see before any signals have been scored."
            />
          </Card>
        ) : (
          <Grid min="360px">
            {actions.map((a, i) => (
              <Card
                key={a.topic}
                accent={tone(a.priority)}
                stagger={i * 40}
                onClick={a.dimensionKey ? () => nav.openDimension(a.dimensionKey!) : undefined}
              >
                <Row gap="var(--s-2)">
                  <Badge tone={tone(a.priority)}>{a.priority}</Badge>
                  {a.dimensionLabel && <Badge tone="neutral">{a.dimensionLabel}</Badge>}
                  <span style={{ flex: 1 }} />
                  <span className="ds-eyebrow">#{i + 1}</span>
                </Row>

                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-h3)',
                    fontWeight: 'var(--fw-semibold)',
                    color: 'var(--text-heading)',
                    margin: 'var(--s-3) 0 var(--s-2)',
                  }}
                >
                  {a.title}
                </h3>

                <p
                  style={{
                    color: 'var(--text-body)',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 'var(--lh-relaxed)',
                    margin: 0,
                  }}
                >
                  {a.volume} signal{a.volume === 1 ? '' : 's'} mention this, and it accounts for{' '}
                  <strong>{a.impactShare}%</strong> of the damage currently weighing on your index.
                </p>

                <div style={{ marginTop: 'var(--s-4)' }}>
                <Row gap="var(--s-4)">
                  <div>
                    <div className="ds-eyebrow">Share of damage</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-stat)',
                        fontWeight: 'var(--fw-semibold)',
                        color: 'var(--status-critical)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {a.impactShare}%
                    </div>
                  </div>
                  <div>
                    <div className="ds-eyebrow">Signals</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-stat)',
                        fontWeight: 'var(--fw-semibold)',
                        color: 'var(--text-heading)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {a.volume}
                    </div>
                  </div>
                </Row>
                </div>
              </Card>
            ))}
          </Grid>
        )}
      </ViewState>
    </>
  );
}
