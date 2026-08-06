'use client';
import { useEffect, useState } from 'react';
import { useInView } from '@/hooks/useInView';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';
import { toCompetitorRows, type ApiBrandScore, type CompetitorRow } from '@/lib/brand-data';
import { Delta } from '@/components/primitives';
import { ViewState } from '@/components/ViewState';

export function CompetitorsView() {
  const [ref, play] = useInView(0.1);
  const { brands, loading: brandsLoading, error: brandsError } = useBrand();
  const [rows, setRows] = useState<CompetitorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One /score call per brand: the comparison is the same pipeline run across the set, so
  // there is no single endpoint for it. The competitive set is a handful of brands, not a
  // list that grows unbounded.
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
    <div className="content view-enter" ref={ref}>
      <div style={{ maxWidth: 720, marginBottom: 24 }}>
        <p className="kicker">Competitive set</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 600,
            margin: '8px 0 8px',
          }}
        >
          {owned ? `How ${owned.name} stacks up` : 'How the set compares'}
        </h2>
        <p style={{ color: 'var(--t2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Same pipeline, same model, same five dimensions — run across every brand in the set for a
          like-for-like benchmark.
        </p>
      </div>

      <ViewState
        loading={brandsLoading || (rows === null && !error && !brandsError)}
        error={error ?? brandsError}
        empty={rows?.length === 0 ? 'No brands in this tenant yet.' : null}
      >
        <div className="card" style={{ padding: '24px 26px' }}>
          {rows?.map((c, i) => (
            <div className="comp-row" key={c.id}>
              <div className={`cn ${c.isOwned ? 'you' : ''}`}>
                {c.isOwned ? '◆ ' : ''}
                {c.name}
              </div>
              <div className="comp-track">
                <i
                  style={{
                    width: play && c.score !== null ? `${c.score}%` : 0,
                    background: c.isOwned ? 'var(--peri)' : 'var(--t3)',
                    transition: `width 1.2s ${i * 0.12}s cubic-bezier(.2,.8,.2,1)`,
                  }}
                />
              </div>
              <div
                style={{
                  textAlign: 'right',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: 18,
                  color: c.isOwned ? 'var(--peri)' : 'var(--t1)',
                }}
              >
                {c.score === null ? (
                  // Not yet scored is not a score of zero — say so rather than draw a bar at 0.
                  <span style={{ fontSize: 13, color: 'var(--t3)' }}>not yet scored</span>
                ) : (
                  <>
                    {c.score}
                    {c.previous !== null && <Delta value={c.score - c.previous} />}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </ViewState>
    </div>
  );
}
