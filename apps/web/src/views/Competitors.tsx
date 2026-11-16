'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useInView } from '@/hooks/useInView';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';
import {
  toCompetitorRows,
  withTerritory,
  type ApiBrandScore,
  type CompetitorRow,
} from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, PageHeader, Stack, Trend } from '@/design-system';

export function CompetitorsView() {
  const [ref, play] = useInView(0.1);
  const { brands, territory, loading: brandsLoading, error: brandsError } = useBrand();
  const [rows, setRows] = useState<CompetitorRow[] | null>(null);
  /** Brands whose score request FAILED — not the same as brands that have no score. */
  const [failed, setFailed] = useState<string[]>([]);

  // One /score call per brand: the comparison is the same pipeline run across the
  // set, so there is no single endpoint for it. The competitive set is a handful
  // of brands, not a list that grows unbounded.
  //
  // TERRITORY-FILTERED like every other analytical view. It was not: under a UK lens this view
  // compared every brand's global index while the rest of the app showed UK numbers.
  useEffect(() => {
    if (brands.length === 0) return;
    let cancelled = false;
    setRows(null);
    setFailed([]);

    void Promise.all(
      brands.map((b) =>
        apiFetch<ApiBrandScore>(withTerritory(`/brands/${b.id}/score`, territory))
          .then((s) => ({ id: b.id, score: s }))
          .catch(() => ({ id: b.id, score: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const scores = new Map<string, ApiBrandScore>();
      const errored: string[] = [];
      for (const r of results) {
        if (r.score) scores.set(r.id, r.score);
        else errored.push(r.id);
      }
      setRows(toCompetitorRows(brands, scores));
      setFailed(errored);
    });

    return () => {
      cancelled = true;
    };
  }, [brands, territory]);

  const owned = rows?.find((r) => r.isOwned);
  const failedNames = brands.filter((b) => failed.includes(b.id)).map((b) => b.name);

  return (
    <div ref={ref}>
      <PageHeader
        eyebrow="Competitive set"
        title={owned ? `How ${owned.name} stacks up` : 'How the set compares'}
        subtitle="Same pipeline, same model, same five dimensions — run across every brand in the set for a like-for-like benchmark."
      />

      <ViewState
        loading={brandsLoading || (rows === null && !brandsError)}
        error={brandsError}
        empty={null}
      >
        {failedNames.length > 0 && (
          /* A failed request used to render as "not yet scored" — a statement about the brand,
             made from an error. Said separately so the two are never confused. */
          <p className="ds-hint" role="alert" style={{ color: 'var(--status-critical)' }}>
            Scores could not be loaded for {failedNames.join(', ')}. Those rows show no score
            because the request failed, not because the brand is unscored.
          </p>
        )}
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
                      <span className="ds-hint">
                        {failed.includes(c.id) ? 'could not load' : 'not yet scored'}
                      </span>
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
