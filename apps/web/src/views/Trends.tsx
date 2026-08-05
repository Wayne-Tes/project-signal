'use client';
import { useState } from 'react';
import { useInView } from '@/hooks/useInView';
import { PS_BRAND, PS_DIMENSIONS, PS_HISTORY } from '@/lib/data';
import { scoreColor } from '@/lib/utils';
import { Delta } from '@/components/primitives';
import { LineChart, Sparkline } from '@/components/charts';
import type { NavActions } from '@/lib/types';

export function TrendsView({ nav }: { nav: NavActions }) {
  const [ref, play] = useInView(0.1);
  const [hl, setHl] = useState<string | null>(null);

  return (
    <div className="content view-enter" ref={ref}>
      <div className="card" style={{ padding: '22px 24px', marginBottom: 18 }}>
        <div className="card-h" style={{ padding: 0, marginBottom: 16 }}>
          <h3>Brand Perception Index · full history</h3>
          <span className="sub">26 weeks · recency-weighted</span>
          <div className="spacer" />
          <div className="legend" onMouseLeave={() => setHl(null)}>
            <span className="it" onMouseEnter={() => setHl('score')} style={{ cursor: 'pointer' }}>
              <span className="sw" style={{ background: scoreColor(PS_BRAND.score) }} />
              Composite
            </span>
            {PS_DIMENSIONS.map((d) => (
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
        <LineChart
          data={PS_HISTORY}
          width={1180}
          height={340}
          yMin={50}
          yMax={90}
          play={play}
          highlight={hl}
          series={[
            { key: 'score', color: scoreColor(PS_BRAND.score), w: 3, area: true },
            ...PS_DIMENSIONS.map((d) => ({ key: d.key, color: scoreColor(d.score), w: 1.5 })),
          ]}
          showDots
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        {PS_DIMENSIONS.map((d) => (
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
              <Delta value={d.score - d.prev} />
            </div>
            <Sparkline
              data={PS_HISTORY}
              dkey={d.key}
              color={scoreColor(d.score)}
              width={180}
              height={44}
              play={play}
            />
            <div className="drill-hint" style={{ margin: '8px 0 6px' }}>
              dig in →
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
