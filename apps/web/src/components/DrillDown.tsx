'use client';
import { useEffect } from 'react';
import type { NavLevel, NavActions } from '@/lib/types';
import {
  PS_BRAND,
  PS_DIMENSIONS,
  PS_CLUSTERS,
  PS_SOURCES,
  PS_SIGNALS,
  PS_HISTORY,
  signalsFor,
  clusterById,
} from '@/lib/data';
import { scoreColor, sentColor, sentLabel } from '@/lib/utils';
import { useCountUp } from '@/hooks/useCountUp';
import { Delta, SourceBadge, SourceGlyph, Stars, SentChip } from './primitives';
import { LineChart } from './charts';

function MixBar({ mix }: { mix: Record<string, number> }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="mixbar">
        {Object.entries(mix).map(([k, v]) => (
          <span
            key={k}
            style={{ width: `${(v / total) * 100}%`, background: PS_SOURCES[k]?.tone }}
            title={`${k} ${Math.round((v / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="mix-legend">
        {Object.entries(mix).map(([k, v]) => (
          <span className="it" key={k}>
            <SourceGlyph name={k} size={13} /> {PS_SOURCES[k]?.short}
            <b className="mono" style={{ color: 'var(--t3)' }}>
              {Math.round((v / total) * 100)}%
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

function OverviewLevel({ onDim }: { onDim: (key: string) => void }) {
  const shown = useCountUp(PS_BRAND.score, { duration: 1200 });
  return (
    <div>
      <p className="kicker">Composite index</p>
      <h2 className="drill-title">{PS_BRAND.scoreLabel}</h2>
      <p className="drill-sub">
        A weighted composite of five perception dimensions. Drill into any dimension to see
        what&apos;s driving it — down to the individual review or comment.
      </p>
      <div className="metric-row">
        <div className="metric">
          <div className="l">Score</div>
          <div className="v" style={{ color: scoreColor(PS_BRAND.score) }}>
            {shown}
          </div>
        </div>
        <div className="metric">
          <div className="l">Δ vs prev</div>
          <div className="v">
            <Delta value={PS_BRAND.score - PS_BRAND.prevScore} />
          </div>
        </div>
        <div className="metric">
          <div className="l">Signals / wk</div>
          <div className="v">{(PS_BRAND.signalsThisWeek / 1000).toFixed(1)}k</div>
        </div>
      </div>
      <p className="kicker" style={{ marginBottom: 10 }}>
        Contributing dimensions
      </p>
      <div className="drill-list">
        {PS_DIMENSIONS.map((d) => (
          <button key={d.key} className="drill-row" onClick={() => onDim(d.key)}>
            <div
              className="lead"
              style={{
                background: `color-mix(in srgb, ${scoreColor(d.score)} 16%, transparent)`,
                color: scoreColor(d.score),
              }}
            >
              {d.score}
            </div>
            <div className="body">
              <div className="nm">
                {d.label} <Delta value={d.score - d.prev} />
              </div>
              <div className="ds">
                Weight {Math.round(d.weight * 100)}% · {d.blurb}
              </div>
              <div className="mini-bar">
                <i style={{ width: `${d.score}%`, background: scoreColor(d.score) }} />
              </div>
            </div>
            <span className="arr">→</span>
          </button>
        ))}
      </div>
      <div className="prov">
        <b>Provenance.</b> Composite recomputed hourly from{' '}
        {PS_BRAND.signalsThisWeek.toLocaleString()} processed signals this week across{' '}
        {PS_BRAND.sourcesActive} sources. Recency-weighted, 90-day half-life. Model: Gemini Flash ·
        confidence-filtered ≥ 0.6.
      </div>
    </div>
  );
}

function DimensionLevel({
  dimKey,
  onCluster,
}: {
  dimKey: string;
  onCluster: (id: string) => void;
}) {
  const dim = PS_DIMENSIONS.find((d) => d.key === dimKey)!;
  const clusters = (PS_CLUSTERS[dimKey] || []).slice().sort((a, b) => b.damage - a.damage);
  const shown = useCountUp(dim.score, { duration: 1100 });
  return (
    <div>
      <p className="kicker">Dimension</p>
      <h2 className="drill-title">{dim.label}</h2>
      <p className="drill-sub">{dim.blurb}</p>
      <div className="metric-row">
        <div className="metric">
          <div className="l">Score</div>
          <div className="v" style={{ color: scoreColor(dim.score) }}>
            {shown}
          </div>
        </div>
        <div className="metric">
          <div className="l">Δ 8 weeks</div>
          <div className="v">
            <Delta value={dim.score - dim.prev} />
          </div>
        </div>
        <div className="metric">
          <div className="l">Weight</div>
          <div className="v">{Math.round(dim.weight * 100)}%</div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: '8px 8px 0' }}>
        <LineChart
          data={PS_HISTORY}
          width={460}
          height={150}
          yMin={50}
          yMax={90}
          series={[{ key: dimKey, color: scoreColor(dim.score), area: true, w: 2.4 }]}
          showDots
        />
      </div>
      <p className="kicker" style={{ marginBottom: 10 }}>
        Topic clusters driving this dimension
      </p>
      <div className="drill-list">
        {clusters.map((c) => (
          <button key={c.id} className="drill-row" onClick={() => onCluster(c.id)}>
            <div
              className="lead"
              style={{
                background: `color-mix(in srgb, ${sentColor(c.sentiment)} 16%, transparent)`,
                color: sentColor(c.sentiment),
              }}
            >
              {c.sentiment > 0 ? '＋' : '－'}
            </div>
            <div className="body">
              <div className="nm">{c.title}</div>
              <div className="ds">
                {c.volume.toLocaleString()} signals · {sentLabel(c.sentiment)}{' '}
                {c.sentiment.toFixed(2)} ·{' '}
                <span style={{ color: c.trend < 0 ? 'var(--coral)' : 'var(--mint)' }}>
                  {c.trend > 0 ? '+' : ''}
                  {c.trend} pts
                </span>
              </div>
              <div className="mixbar" style={{ marginTop: 7 }}>
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
            <span className="arr">→</span>
          </button>
        ))}
      </div>
      <div className="prov">
        <b>How this is computed.</b> {dim.label} = weighted mean of sentiment for items tagged to
        this dimension, recency-decayed. Clusters ranked by damage = volume × negativity × recency.
      </div>
    </div>
  );
}

function ClusterLevel({ clusterId }: { clusterId: string }) {
  const c = clusterById(clusterId)!;
  const signals = PS_SIGNALS[clusterId] || signalsFor(clusterId, c.mix);
  const dam = useCountUp(c.damage, { duration: 1100 });
  return (
    <div>
      <p className="kicker">
        Topic cluster · {PS_DIMENSIONS.find((d) => d.key === c.dimKey)?.label}
      </p>
      <h2 className="drill-title">{c.title}</h2>
      <p className="drill-sub">{c.summary}</p>
      <div className="metric-row">
        <div className="metric">
          <div className="l">Damage score</div>
          <div className="v" style={{ color: c.damage > 50 ? 'var(--coral)' : 'var(--mint)' }}>
            {dam}
          </div>
        </div>
        <div className="metric">
          <div className="l">Volume</div>
          <div className="v">{c.volume.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="l">Sentiment</div>
          <div className="v" style={{ color: sentColor(c.sentiment) }}>
            {c.sentiment > 0 ? '+' : ''}
            {c.sentiment.toFixed(2)}
          </div>
        </div>
      </div>
      <p className="kicker" style={{ marginBottom: 10 }}>
        Where this signal comes from
      </p>
      <MixBar mix={c.mix} />
      <p className="kicker" style={{ margin: '24px 0 10px' }}>
        Contributing items · {signals.length} of {c.volume.toLocaleString()} shown
      </p>
      <div className="drill-list">
        {signals.map((s, i) => (
          <div className="signal" key={i} style={{ animation: `viewIn .4s ${i * 0.05}s both` }}>
            <div className="sig-top">
              <SourceBadge name={s.source} />
              <Stars n={s.rating} />
              <span className="when">{s.when}</span>
            </div>
            <div className="auth" style={{ marginBottom: 6, color: 'var(--t2)' }}>
              {s.author}
            </div>
            <div className="txt">{s.text}</div>
            <div className="sig-foot">
              <SentChip value={s.sentiment} />
              {s.topics.slice(0, 3).map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
              <span className="conf">
                conf <b>{Math.round(s.confidence * 100)}%</b>
              </span>
            </div>
            <div style={{ marginTop: 10 }}>
              <a className="link" href="#" onClick={(e) => e.preventDefault()}>
                open source ↗
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="prov">
        <b>Audit trail.</b> Every item retains source URL, capture timestamp, raw text, model
        version & confidence in Cloud Storage for 12 months. This is the evidence chain behind the
        score above.
      </div>
    </div>
  );
}

export function DrillDown({ path, nav }: { path: NavLevel[]; nav: NavActions }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') nav.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  if (!path.length) return null;

  const labelFor = (lvl: NavLevel) => {
    if (lvl.kind === 'overview') return 'Index';
    if (lvl.kind === 'dimension')
      return PS_DIMENSIONS.find((d) => d.key === lvl.dimKey)?.label ?? lvl.dimKey;
    return clusterById(lvl.clusterId)?.title ?? lvl.clusterId;
  };
  const spineNum = (i: number) => String(i + 1).padStart(2, '0');

  return (
    <>
      <div className="drill-scrim" onClick={nav.close} />
      <div className="drill-stack">
        {path.map((lvl, i) => {
          const isLast = i === path.length - 1;
          if (!isLast) {
            return (
              <div className="drill-panel stacked" key={i} onClick={() => nav.to(i)}>
                <div className="drill-spine">
                  <span className="lvl">{spineNum(i)}</span>&nbsp;&nbsp;{labelFor(lvl)}
                </div>
              </div>
            );
          }
          return (
            <div className="drill-panel" key={i}>
              <div className="drill-head">
                <div className="crumbs">
                  {path.map((p, j) => (
                    <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      {j > 0 && <span className="sep">›</span>}
                      <span
                        className={`c ${j === path.length - 1 ? 'cur' : ''}`}
                        onClick={() => nav.to(j)}
                      >
                        {labelFor(p)}
                      </span>
                    </span>
                  ))}
                </div>
                <button className="drill-close" onClick={nav.close} aria-label="Close">
                  ✕
                </button>
                <div style={{ height: 4 }} />
              </div>
              <div className="drill-body" key={`body${i}`}>
                {lvl.kind === 'overview' && <OverviewLevel onDim={nav.openDimension} />}
                {lvl.kind === 'dimension' && (
                  <DimensionLevel
                    dimKey={lvl.dimKey}
                    onCluster={(cid) => nav.openCluster(cid, lvl.dimKey)}
                  />
                )}
                {lvl.kind === 'cluster' && <ClusterLevel clusterId={lvl.clusterId} />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
