'use client';
import { useInView } from '@/hooks/useInView';
import { PS_COMPETITORS } from '@/lib/data';
import { Delta } from '@/components/primitives';

export function CompetitorsView() {
  const [ref, play] = useInView(0.1);
  const sorted = PS_COMPETITORS.slice().sort((a, b) => b.score - a.score);

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
          How Cadence stacks up
        </h2>
        <p style={{ color: 'var(--t2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Same pipeline, same model, same five dimensions — run across every brand in the set for a
          like-for-like benchmark.
        </p>
      </div>
      <div className="card" style={{ padding: '24px 26px' }}>
        {sorted.map((c, i) => (
          <div className="comp-row" key={c.name}>
            <div className={`cn ${c.you ? 'you' : ''}`}>
              {c.you ? '◆ ' : ''}
              {c.name}
            </div>
            <div className="comp-track">
              <i
                style={{
                  width: play ? `${c.score}%` : 0,
                  background: c.you ? 'var(--peri)' : 'var(--t3)',
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
                color: c.you ? 'var(--peri)' : 'var(--t1)',
              }}
            >
              {c.score}
              <Delta value={c.score - c.prev} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
