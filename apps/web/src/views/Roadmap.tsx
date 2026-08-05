'use client';
import { PS_ROADMAP, PS_DIMENSIONS, clusterById } from '@/lib/data';
import type { NavActions } from '@/lib/types';

export function RoadmapView({ nav }: { nav: NavActions }) {
  return (
    <div className="content view-enter">
      <div
        style={{
          maxWidth: 720,
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <p className="kicker">Action roadmap</p>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 600,
              margin: '8px 0 8px',
            }}
          >
            Prioritised fixes, with projected impact
          </h2>
          <p style={{ color: 'var(--t2)', fontSize: 14.5, lineHeight: 1.6 }}>
            Generated weekly by Gemini Pro. Each recommendation cites the evidence cluster behind it
            and the estimated lift to the index.
          </p>
        </div>
        <div className="card stat" style={{ minWidth: 180 }}>
          <div className="lab">Total projected uplift</div>
          <div className="num" style={{ color: 'var(--mint)' }}>
            +15.5<span style={{ fontSize: 16, color: 'var(--t3)' }}> pts</span>
          </div>
          <div className="foot">if all actions shipped</div>
        </div>
      </div>
      <div className="grid">
        {PS_ROADMAP.map((a) => (
          <div key={a.id} className="act">
            <div className="act-h">
              <span className={`pri ${a.priority}`}>{a.priority}</span>
              <span className="atitle">{a.title}</span>
              <div className="impact">
                <div className="v">+{a.impact}</div>
                <div className="l">pts impact</div>
              </div>
            </div>
            <div className="act-body">
              <div className="act-desc">{a.desc}</div>
              <div className="act-why">{a.why}</div>
              <div className="act-foot">
                <span>
                  Dimension <b>{PS_DIMENSIONS.find((d) => d.key === a.dimension)?.label}</b>
                </span>
                <span>
                  Effort <b>{a.effort}</b>
                </span>
                <span>
                  Confidence <b>{Math.round(a.confidence * 100)}%</b>
                </span>
                <button
                  className="drill-hint"
                  style={{ marginLeft: 'auto', cursor: 'pointer' }}
                  onClick={() => {
                    const e0 = a.evidence[0];
                    if (e0) {
                      const c = clusterById(e0);
                      if (c) nav.openCluster(e0, c.dimKey);
                    }
                  }}
                >
                  view evidence →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
