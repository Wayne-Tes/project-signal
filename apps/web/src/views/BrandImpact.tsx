'use client';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import { toHeelCards, type ApiCluster } from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import type { NavActions } from '@/lib/types';

export function BrandImpactView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError } = useBrand();
  const { data, loading, error } = useApi<ApiCluster[]>(
    brandId ? `/brands/${brandId}/brand-impact` : null,
  );
  const heels = data ? toHeelCards(data) : [];

  return (
    <div className="content view-enter">
      <div style={{ maxWidth: 720, marginBottom: 24 }}>
        <p className="kicker">Brand impact report</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 600,
            margin: '8px 0 8px',
          }}
        >
          The weaknesses doing the most damage
        </h2>
        <p style={{ color: 'var(--t2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Ranked by damage score — volume × negative sentiment × recency.
        </p>
      </div>

      <ViewState
        loading={loading}
        error={error ?? brandError}
        empty={
          heels.length === 0
            ? 'No weaknesses surfaced yet — nothing scored negatively in the window.'
            : null
        }
      >
        <div className="grid">
          {heels.map((c, i) => (
            <button
              key={c.topic}
              className="heel clickable"
              onClick={() => c.dimensionKey && nav.openDimension(c.dimensionKey)}
            >
              <div className="rank">{i + 1}</div>
              <div>
                <div className="htitle">{c.title}</div>
                <div className="hsum">
                  {c.volume.toLocaleString()} signals, mean sentiment {c.sentiment.toFixed(2)}
                </div>
                <div className="hmeta">
                  {c.dimensionLabel && (
                    <span
                      className="sent-chip"
                      style={{
                        color: 'var(--coral)',
                        borderColor: 'color-mix(in srgb, var(--coral) 35%, transparent)',
                      }}
                    >
                      <span className="dot" style={{ background: 'currentColor' }} />
                      {c.dimensionLabel}
                    </span>
                  )}
                  <span className="mono" style={{ fontSize: 12, color: 'var(--t3)' }}>
                    {c.volume.toLocaleString()} signals
                  </span>
                </div>
              </div>
              <div className="damage-ring">
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 38,
                    fontWeight: 600,
                    color: 'var(--coral)',
                    lineHeight: 1,
                  }}
                >
                  {c.damage}
                </div>
                <div className="kicker">damage</div>
                {c.dimensionKey && (
                  <span
                    className="arr"
                    style={{ color: 'var(--coral)', marginTop: 8, display: 'block', fontSize: 18 }}
                  >
                    →
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </ViewState>
    </div>
  );
}
