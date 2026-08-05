'use client';
import { useInView } from '@/hooks/useInView';
import { useCountUp } from '@/hooks/useCountUp';
import {
  PS_BRAND,
  PS_DIMENSIONS,
  PS_CLUSTERS,
  PS_SOURCES,
  PS_HISTORY,
  PS_VOLUME,
  PS_ALERT,
  clusterById,
} from '@/lib/data';
import { scoreColor } from '@/lib/utils';
import { Delta, SourceGlyph } from '@/components/primitives';
import { RadialGauge } from '@/components/RadialGauge';
import { DimBar } from '@/components/DimBar';
import { LineChart, Sparkline, VolumeBars } from '@/components/charts';
import type { NavActions } from '@/lib/types';

function HeroBars({ play }: { play: boolean }) {
  const shown = useCountUp(PS_BRAND.score, { play, duration: 1600 });
  const col = scoreColor(PS_BRAND.score);
  return (
    <div style={{ width: '100%', padding: '8px 0 4px', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 92,
          lineHeight: 1,
          color: col,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {shown}
      </div>
      <div className="kicker" style={{ marginTop: 4 }}>
        composite index
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 22 }}>
        {PS_DIMENSIONS.map((d, i) => (
          <div key={d.key} style={{ flex: 1 }}>
            <div
              style={{
                height: 90,
                borderRadius: 6,
                background: 'var(--surface-3)',
                display: 'flex',
                alignItems: 'flex-end',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: play ? `${d.score}%` : 0,
                  background: scoreColor(d.score),
                  transition: `height 1.1s ${i * 0.12 + 0.2}s cubic-bezier(.2,.8,.2,1)`,
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                color: 'var(--t3)',
                marginTop: 6,
              }}
            >
              {d.label.slice(0, 4)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard({ nav, hero = 'Radial gauge' }: { nav: NavActions; hero?: string }) {
  const [ref, play] = useInView(0.1);
  const vshown = useCountUp(PS_BRAND.signalsThisWeek, { duration: 1500, play });

  const topNeg = [
    PS_CLUSTERS['service']![0]!,
    PS_CLUSTERS['quality']![0]!,
    PS_CLUSTERS['trust']![0]!,
  ];
  const topPos = [
    PS_CLUSTERS['value']![0]!,
    PS_CLUSTERS['experience']![0]!,
    PS_CLUSTERS['trust']![1]!,
  ];

  return (
    <div className="content view-enter" ref={ref}>
      {PS_ALERT.active && (
        <div
          className="alert-banner"
          style={{ marginBottom: 20, cursor: 'pointer' }}
          onClick={() => {
            const c = clusterById(PS_ALERT.cluster);
            if (c) nav.openCluster(PS_ALERT.cluster, c.dimKey);
          }}
        >
          <span className="pulse" />
          <div style={{ flex: 1 }}>
            <div className="at">
              Anomaly detected · {PS_ALERT.metric} {PS_ALERT.delta} pts
            </div>
            <div className="ad">
              {PS_ALERT.detail}{' '}
              <span className="mono" style={{ color: 'var(--t3)' }}>
                · {PS_ALERT.window}
              </span>
            </div>
          </div>
          <span className="drill-hint">{PS_ALERT.when} · investigate →</span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div
          className="card clickable"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            cursor: 'pointer',
          }}
          onClick={nav.openOverview}
        >
          <div
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <span className="kicker">Brand Perception Index</span>
            <span className="drill-hint">dig in →</span>
          </div>
          {hero === 'Bars' ? (
            <HeroBars play={play} />
          ) : (
            <RadialGauge
              value={PS_BRAND.score}
              size={236}
              stroke={15}
              play={play}
              sub={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <Delta value={PS_BRAND.score - PS_BRAND.prevScore} />{' '}
                  <span style={{ color: 'var(--t3)', fontSize: 12 }}>vs prev period</span>
                </div>
              }
            />
          )}
          {hero === 'Bars' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Delta value={PS_BRAND.score - PS_BRAND.prevScore} />{' '}
              <span style={{ color: 'var(--t3)', fontSize: 12 }}>vs prev period</span>
            </div>
          )}
          <div style={{ width: '100%', marginTop: 8 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <span className="kicker">26-week trend</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>
                {PS_BRAND.period}
              </span>
            </div>
            <Sparkline
              data={PS_HISTORY}
              color={scoreColor(PS_BRAND.score)}
              width={312}
              height={56}
              play={play}
            />
          </div>
        </div>

        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 8 }}>
            <h3>Perception dimensions</h3>
            <span className="sub">click any to dig down</span>
            <div className="spacer" />
            <span className="drill-hint">5 dimensions</span>
          </div>
          {PS_DIMENSIONS.map((d, i) => (
            <DimBar
              key={d.key}
              dim={d}
              play={play}
              delay={i * 120}
              onClick={() => nav.openDimension(d.key)}
            />
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 18 }}>
        <div className="card stat">
          <div className="lab">Signals this week</div>
          <div className="num">{Number(vshown).toLocaleString()}</div>
          <div className="foot">
            <Delta
              value={
                +(
                  ((PS_BRAND.signalsThisWeek - PS_BRAND.signalsPrevWeek) /
                    PS_BRAND.signalsPrevWeek) *
                  100
                ).toFixed(1)
              }
              suffix="%"
            />{' '}
            vs last week
          </div>
        </div>
        <div className="card stat">
          <div className="lab">Active sources</div>
          <div className="num">
            {PS_BRAND.sourcesActive}
            <span style={{ fontSize: 16, color: 'var(--t3)' }}> / 8</span>
          </div>
          <div className="foot" style={{ gap: 4 }}>
            {['Google', 'Trustpilot', 'App Store', 'YouTube', 'News', 'X'].map((s) => (
              <SourceGlyph key={s} name={s} size={15} />
            ))}
          </div>
        </div>
        <div className="card stat">
          <div className="lab">Competitive rank</div>
          <div className="num">
            #2<span style={{ fontSize: 16, color: 'var(--t3)' }}> of 4</span>
          </div>
          <div className="foot">8 pts behind leader Northwind</div>
        </div>
        <div className="card stat">
          <div className="lab">Open critical actions</div>
          <div className="num" style={{ color: 'var(--coral)' }}>
            2
          </div>
          <div className="foot">+6.4 pts potential uplift</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', marginTop: 18 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 14 }}>
            <h3>Dimension history</h3>
            <span className="sub">26 weeks</span>
            <div className="spacer" />
            <div className="legend">
              {PS_DIMENSIONS.map((d) => (
                <span className="it" key={d.key}>
                  <span className="sw" style={{ background: scoreColor(d.score) }} />
                  {d.label}
                </span>
              ))}
            </div>
          </div>
          <LineChart
            data={PS_HISTORY}
            width={680}
            height={250}
            yMin={50}
            yMax={90}
            play={play}
            series={PS_DIMENSIONS.map((d) => ({
              key: d.key,
              color: scoreColor(d.score),
              w: d.key === 'service' ? 2.6 : 1.6,
            }))}
            highlight="service"
          />
          <p className="mono" style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Service (highlighted) dipped during the April support incident and is still recovering.
          </p>
        </div>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 14 }}>
            <h3>Signal volume by source</h3>
            <span className="sub">12 weeks</span>
          </div>
          <VolumeBars vol={PS_VOLUME} width={420} height={210} play={play} />
          <div className="legend" style={{ marginTop: 10 }}>
            {PS_VOLUME.sources.map((s) => (
              <span className="it" key={s}>
                <span className="sw" style={{ background: PS_SOURCES[s]?.tone }} />
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 14 }}>
            <h3 style={{ color: 'var(--coral)' }}>Top negative clusters</h3>
            <div className="spacer" />
            <span className="drill-hint">by damage</span>
          </div>
          <div className="drill-list">
            {topNeg.map((c) => (
              <button
                key={c.id}
                className="drill-row"
                onClick={() => {
                  const cl = clusterById(c.id);
                  if (cl) nav.openCluster(c.id, cl.dimKey);
                }}
              >
                <div
                  className="lead"
                  style={{
                    background: 'color-mix(in srgb, var(--coral) 15%, transparent)',
                    color: 'var(--coral)',
                    fontSize: 14,
                  }}
                >
                  {c.damage}
                </div>
                <div className="body">
                  <div className="nm" style={{ fontSize: 13.5 }}>
                    {c.title}
                  </div>
                  <div className="ds">
                    {c.volume.toLocaleString()} signals · {c.sentiment.toFixed(2)}
                  </div>
                </div>
                <span className="arr">→</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-h" style={{ padding: 0, marginBottom: 14 }}>
            <h3 style={{ color: 'var(--mint)' }}>Top positive clusters</h3>
            <div className="spacer" />
            <span className="drill-hint">strengths</span>
          </div>
          <div className="drill-list">
            {topPos.map((c) => (
              <button
                key={c.id}
                className="drill-row"
                onClick={() => {
                  const cl = clusterById(c.id);
                  if (cl) nav.openCluster(c.id, cl.dimKey);
                }}
              >
                <div
                  className="lead"
                  style={{
                    background: 'color-mix(in srgb, var(--mint) 15%, transparent)',
                    color: 'var(--mint)',
                    fontSize: 18,
                  }}
                >
                  ＋
                </div>
                <div className="body">
                  <div className="nm" style={{ fontSize: 13.5 }}>
                    {c.title}
                  </div>
                  <div className="ds">
                    {c.volume.toLocaleString()} signals · +{c.sentiment.toFixed(2)}
                  </div>
                </div>
                <span className="arr">→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
