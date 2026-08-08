'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useInView } from '@/hooks/useInView';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';
import { toCompetitorRows, type ApiBrandScore, type CompetitorRow } from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, PageHeader, Stack, Trend } from '@/design-system';

export function CompetitorsView() {
  const [ref, play] = useInView(0.1);
  const { brands, loading: brandsLoading, error: brandsError } = useBrand();
  const [rows, setRows] = useState<CompetitorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One /score call per brand: the comparison is the same pipeline run across the
  // set, so there is no single endpoint for it. The competitive set is a handful
  // of brands, not a list that grows unbounded.
  useEffect(() => {
    if (brands.length === 0) return;
    let cancelled = false;

    Promise.all(
      brands.map((b) =>
        apiFetch<ApiBrandScore>(`/brands/${b.id}/score`)
          .then((s) => [b.id, s] as const)
          .catch(() => null),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const scores = new Map(results.filter((r): r is readonly [string, ApiBrandScore] => !!r));
        setRows(toCompetitorRows(brands, scores));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load scores');
      });

    return () => {
      cancelled = true;
    };
  }, [brands]);

  const owned = rows?.find((r) => r.isOwned);

  return (
    <div ref={ref}>
      <PageHeader
        eyebrow="Competitive set"
        title={owned ? `How ${owned.name} stacks up` : 'How the set compares'}
        subtitle="Same pipeline, same model, same five dimensions — run across every brand in the set for a like-for-like benchmark."
      />

      <ViewState
        loading={brandsLoading || (rows === null && !error && !brandsError)}
        error={error ?? brandsError}
        empty={null}
      >
        {rows?.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BarChart3 size={22} strokeWidth={1.8} />}
              title="No brands in this tenant yet"
              body="Add a brand and its competitors from the Admin area to see a benchmark."
            />
          </Card>
        ) : (
          <Card>
            <Stack gap="var(--s-4)">
              {rows?.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(140px, 1fr) 3fr auto',
                    alignItems: 'center',
                    gap: 'var(--s-4)',
                  }}
                >
                  <div className="ds-row" style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: c.isOwned ? 'var(--fw-bold)' : 'var(--fw-regular)',
                        color: 'var(--text-heading)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.name}
                    </span>
                    {/* The owned brand is marked with a word, not just a colour —
                        "yours" survives greyscale and screen readers. */}
                    {c.isOwned && <Badge tone="info">Yours</Badge>}
                  </div>

                  <div
                    style={{
                      height: 10,
                      borderRadius: 'var(--radius-pill)',
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--border-hairline)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: play && c.score !== null ? `${c.score}%` : 0,
                        background: c.isOwned ? 'var(--accent)' : 'var(--text-faint)',
                        transition: `width 1.2s ${i * 0.12}s var(--ease)`,
                      }}
                    />
                  </div>

                  <div style={{ textAlign: 'right', minWidth: 96 }}>
                    {c.score === null ? (
                      // Not yet scored is NOT a score of zero — say so rather than
                      // draw a bar at zero, which reads as a terrible result.
                      <span className="ds-hint">not yet scored</span>
                    ) : (
                      <div className="ds-row" style={{ justifyContent: 'flex-end' }}>
                        <span
                          className="ds-kpi__value"
                          style={{
                            fontSize: 'var(--fs-h2)',
                            color: c.isOwned ? 'var(--accent)' : 'var(--text-heading)',
                          }}
                        >
                          {c.score}
                        </span>
                        {c.previous !== null && (
                          <Trend
                            direction={
                              c.score === c.previous ? 'flat' : c.score > c.previous ? 'up' : 'down'
                            }
                            value={Math.abs(c.score - c.previous).toFixed(0)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Stack>
          </Card>
        )}
      </ViewState>
    </div>
  );
}
