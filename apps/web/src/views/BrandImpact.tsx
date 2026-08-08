'use client';

import { Target } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import { toHeelCards, type ApiCluster } from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, Grid, PageHeader, Row, Trend } from '@/design-system';
import type { NavActions } from '@/lib/types';

/**
 * Brand impact — the topic clusters doing the most damage.
 *
 * Composed entirely from design-system primitives; the view contributes layout
 * and data mapping and no styling of its own. Damage is
 * volume x negative sentiment x recency, computed by the API.
 */
export function BrandImpactView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError } = useBrand();
  const { data, loading, error } = useApi<ApiCluster[]>(
    brandId ? `/brands/${brandId}/brand-impact` : null,
  );
  const clusters = data ? toHeelCards(data) : [];

  return (
    <>
      <PageHeader
        eyebrow="Brand impact"
        title="The weaknesses doing the most damage"
        subtitle="Ranked by damage score — volume × negative sentiment × recency."
      />

      <ViewState loading={loading} error={error ?? brandError} empty={null}>
        {clusters.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Target size={22} strokeWidth={1.8} />}
              title="Nothing has scored negatively yet"
              // States what is true rather than reassuring. An empty result here
              // is genuinely ambiguous — no damage, or nothing scored at all —
              // and the second is far more likely early on.
              body="No topic cluster has enough negative signal to rank. This is also what you see before any signals have been scored."
            />
          </Card>
        ) : (
          <Grid min="320px">
            {clusters.map((c, i) => (
              <Card
                key={c.topic}
                accent="critical"
                stagger={i * 40}
                onClick={c.dimensionKey ? () => nav.openDimension(c.dimensionKey!) : undefined}
              >
                <Row gap="var(--s-4)">
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <Row gap="var(--s-2)">
                      <span className="ds-eyebrow">#{i + 1}</span>
                      {c.dimensionLabel && <Badge tone="critical">{c.dimensionLabel}</Badge>}
                    </Row>
                    <h3
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 'var(--fw-bold)',
                        fontSize: 'var(--fs-h3)',
                        color: 'var(--text-heading)',
                        margin: 'var(--s-2) 0 4px',
                      }}
                    >
                      {c.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                      {c.volume.toLocaleString()} signals · mean sentiment {c.sentiment.toFixed(2)}
                    </p>
                  </div>

                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div className="ds-kpi__value" style={{ color: 'var(--status-critical)' }}>
                      {c.damage}
                    </div>
                    <div className="ds-eyebrow">damage</div>
                    {/* Damage rising is bad, so the trend must not colour a rise
                        green — hence upIsGood={false}. */}
                    <div style={{ marginTop: 'var(--s-1)' }}>
                      <Trend direction="up" value="" upIsGood={false} />
                    </div>
                  </div>
                </Row>
              </Card>
            ))}
          </Grid>
        )}
      </ViewState>
    </>
  );
}
