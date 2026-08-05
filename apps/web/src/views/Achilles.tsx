'use client';
import { PS_ACHILLES, PS_SOURCES } from '@/lib/data';
import type { NavActions } from '@/lib/types';

export function AchillesView({ nav }: { nav: NavActions }) {
  return (
    <div className="content view-enter">
      <div style={{ maxWidth: 720, marginBottom: 24 }}>
        <p className="kicker">Achilles Heel report</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 600,
            margin: '8px 0 8px',
          }}
        >
          The three weaknesses doing the most damage
        </h2>
        <p style={{ color: 'var(--t2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Ranked by damage score — volume × negative sentiment × recency. Each links to the verbatim
          evidence behind it.
        </p>
      </div>
      <div className="grid">
        {PS_ACHILLES.map((c, i) => (
          <button
            key={c.id}
            className="heel clickable"
            onClick={() => nav.openCluster(c.id, c.dimension!)}
          >
            <div className="rank">{i + 1}</div>
            <div>
              <div className="htitle">{c.title}</div>
              <div className="hsum">{c.summary}</div>
              <div className="hmeta">
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
                <span className="mono" style={{ fontSize: 12, color: 'var(--t3)' }}>
                  {c.volume.toLocaleString()} signals
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--coral)' }}>
                  {c.trend} pts
                </span>
                <div className="mixbar" style={{ width: 160 }}>
                  {Object.entries(c.mix).map(([k, v]) => {
                    const t = Object.values(c.mix).reduce((a, b) => a + b, 0);
                    return (
                      <span
                        key={k}
                        style={{ width: `${(v / t) * 100}%`, background: PS_SOURCES[k]?.tone }}
                      />
                    );
                  })}
                </div>
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
              <span
                className="arr"
                style={{ color: 'var(--coral)', marginTop: 8, display: 'block', fontSize: 18 }}
              >
                →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
