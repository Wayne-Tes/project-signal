'use client';

import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import {
  DIMENSION_LABELS,
  isDimensionKey,
  roundScore,
  toDimensionCards,
  type ApiBrandScore,
  type ApiCluster,
} from '@/lib/brand-data';
import { sourceMeta } from '@/config/sources';
import { SourceGlyph } from './primitives';
import { scoreColor, sentColor, sentLabel } from '@/lib/utils';
import type { NavActions, NavLevel } from '@/lib/types';

/**
 * The drill-down: index → dimension → topic → the individual signals.
 *
 * This is the product's actual differentiator — every number traces to the specific things
 * people said — and until now every level of it was fiction. It rendered `PS_BRAND`,
 * `PS_CLUSTERS` and `PS_SIGNALS`: a fictional bank's score, invented topic clusters, and
 * hand-written "verbatim" quotations attributed to made-up authors on real-looking dates.
 *
 * Fabricated evidence is the worst thing this file could contain. A wrong aggregate is a bug; an
 * invented quotation shown as something a customer said is a different category of problem.
 *
 * Every level now reads the API. Where the API cannot answer, the level says so rather than
 * filling the space.
 */

interface ApiSignal {
  id: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string;
}

function MetricRow({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <div className="metric-row">
      {items.map((m) => (
        <div className="metric" key={m.label}>
          <div className="l">{m.label}</div>
          <div className="v" style={m.tone ? { color: m.tone } : undefined}>
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Level 1 — the index and its five dimensions. */
function OverviewLevel({ onDim }: { onDim: (key: string) => void }) {
  const { brandId, selected } = useBrand();
  const { data, loading } = useApi<ApiBrandScore>(brandId ? `/brands/${brandId}/score` : null);

  if (loading) return <p className="drill-sub">Loading…</p>;

  const index = data?.score ?? null;
  const previous = data?.previousScore ?? null;
  const dimensions = data ? toDimensionCards(data) : [];

  return (
    <>
      <h2 className="drill-title">{selected?.name ?? 'Brand'}</h2>
      <p className="drill-sub">Brand Perception Index and the five dimensions beneath it.</p>

      {index === null ? (
        /* "Not scored" is a different statement from "scored zero", and only one of them is
           true here. */
        <p className="prov">
          This brand has no Brand Perception Index yet — the daily rollup has not scored it.
          Scores appear once signals have been ingested and scored.
        </p>
      ) : (
        <>
          <MetricRow
            items={[
              { label: 'Index', value: String(roundScore(index)), tone: scoreColor(index) },
              {
                label: 'Change',
                value:
                  previous === null ? 'no comparison' : `${index >= previous ? '+' : ''}${roundScore(index - previous)}`,
              },
              { label: 'As at', value: data?.date?.slice(0, 10) ?? '—' },
            ]}
          />

          <div className="drill-list">
            {dimensions.map((d) => (
              <button className="drill-row" key={d.key} onClick={() => onDim(d.key)}>
                <div className="lead" style={{ background: 'var(--surface-track)', color: scoreColor(d.score) }}>
                  {roundScore(d.score)}
                </div>
                <div className="body">
                  <div className="nm">{d.label}</div>
                  <div className="ds">
                    {d.signalCount} signal{d.signalCount === 1 ? '' : 's'} contributed
                  </div>
                </div>
                <div className="arr">→</div>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="prov">
        Weighted by <b>recency × confidence</b>, on a <b>90-day half-life</b>. Every figure here is
        computed from scored signals for this brand.
      </div>
    </>
  );
}

/** Level 2 — one dimension, and the topics touching it. */
function DimensionLevel({ dimKey, onCluster }: { dimKey: string; onCluster: (topic: string) => void }) {
  const { brandId } = useBrand();
  const { data, loading } = useApi<ApiCluster[]>(brandId ? `/brands/${brandId}/brand-impact` : null);

  const label = isDimensionKey(dimKey) ? DIMENSION_LABELS[dimKey] : dimKey;
  /* The API ranks clusters brand-wide; this level shows the ones that touch this dimension.
     Filtering client-side is honest here — the cluster payload names its dimensions. */
  const clusters = (data ?? []).filter((c) => c.dimensions.includes(dimKey));

  return (
    <>
      <h2 className="drill-title">{label}</h2>
      <p className="drill-sub">Topics the scorer tagged to this dimension, ranked by damage.</p>

      {loading ? (
        <p className="drill-sub">Loading…</p>
      ) : clusters.length === 0 ? (
        <p className="prov">
          No topic cluster has been tagged to {label.toLowerCase()} yet. Clusters appear once
          enough signals mentioning the same subject have been scored.
        </p>
      ) : (
        <div className="drill-list">
          {clusters.map((c) => (
            <button className="drill-row" key={c.topic} onClick={() => onCluster(c.topic)}>
              <div className="lead" style={{ background: 'var(--surface-track)', color: sentColor(c.sentiment) }}>
                {c.volume}
              </div>
              <div className="body">
                <div className="nm">{c.topic}</div>
                <div className="ds">
                  {sentLabel(c.sentiment)} · damage {c.damage.toFixed(1)}
                </div>
                <div className="mini-bar">
                  <i style={{ width: `${Math.min(c.negativity * 100, 100)}%`, background: 'var(--coral)' }} />
                </div>
              </div>
              <div className="arr">→</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Level 3 — the actual signals behind one topic. */
function ClusterLevel({ topic }: { topic: string }) {
  const { brandId } = useBrand();
  const clusters = useApi<ApiCluster[]>(brandId ? `/brands/${brandId}/brand-impact` : null);
  /* The `topic` filter added to the signals route for exactly this: the evidence behind a
     cluster, rather than "recent signals" standing in for it. */
  const signals = useApi<{ items: ApiSignal[] }>(
    brandId ? `/brands/${brandId}/signals?limit=20&topic=${encodeURIComponent(topic)}` : null,
  );

  const cluster = (clusters.data ?? []).find((c) => c.topic === topic);
  const items = signals.data?.items ?? [];

  return (
    <>
      <h2 className="drill-title">{topic}</h2>
      <p className="drill-sub">The signals the scorer tagged with this topic.</p>

      {cluster && (
        <MetricRow
          items={[
            { label: 'Signals', value: String(cluster.volume) },
            { label: 'Sentiment', value: sentLabel(cluster.sentiment), tone: sentColor(cluster.sentiment) },
            { label: 'Damage', value: cluster.damage.toFixed(1) },
          ]}
        />
      )}

      {signals.loading ? (
        <p className="drill-sub">Loading…</p>
      ) : items.length === 0 ? (
        <p className="prov">
          No individual signals are available for this topic. The cluster is computed from scored
          results; the underlying signals may have been collected before topic tagging.
        </p>
      ) : (
        <div className="drill-list">
          {items.map((s) => {
            const meta = sourceMeta(s.source);
            return (
              <div className="signal" key={s.id}>
                <div className="sig-top">
                  <SourceGlyph name={s.source} size={16} />
                  <span className="auth">{meta.label}</span>
                  <span className="when">{s.publishedAt?.slice(0, 10)}</span>
                </div>
                {/* No quotation is rendered. The API returns signal METADATA — the verbatim text
                    lives in object storage and is not exposed by any endpoint. The previous
                    version filled this space with invented quotations attributed to invented
                    authors, which is the single most damaging thing this file could do. The
                    honest affordance is a link to where it was actually published. */}
                <div className="sig-foot">
                  {s.sourceUrl ? (
                    <a className="link" href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                      read the original ↗
                    </a>
                  ) : (
                    <span className="conf">no source URL recorded</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The drill-down drawer.
 *
 * THE STACKED STEPS ARE THE POINT, and they went missing. Each level you pass through collapses
 * to a narrow spine — `01 INDEX`, `02 REPUTATION`, `03 <topic>` — standing as its own column to
 * the left of the panel you are reading, so the route you took from a number to the things people
 * actually said is visible the whole way down, and any earlier step is one click away.
 *
 * The rewrite that deleted the mock data (`f3e9977`) replaced this render with a single panel and
 * took the spines with it. Nothing noticed, because the CSS for them — `.drill-panel.stacked`,
 * `.drill-spine`, `.drill-spine .lvl` — stayed in `globals.css` the entire time, styling elements
 * that no longer existed. A breadcrumb was left behind, which tells you where you are but not
 * how deep you went, and collapses three levels of evidence into one line of text.
 */
export function DrillDown({ path, nav }: { path: NavLevel[]; nav: NavActions }) {
  if (path.length === 0) return null;

  const crumb = (lvl: NavLevel): string => {
    if (lvl.kind === 'overview') return 'Index';
    if (lvl.kind === 'dimension') {
      const key = (lvl as { dimKey: string }).dimKey;
      return isDimensionKey(key) ? DIMENSION_LABELS[key] : key;
    }
    return (lvl as { clusterId: string }).clusterId;
  };

  /* Zero-padded, so 01 and 10 are the same width and the spines line up. */
  const stepNumber = (i: number): string => String(i + 1).padStart(2, '0');

  return (
    <>
      <div className="drill-scrim" onClick={nav.close} aria-hidden="true" />
      <div className="drill-stack">
        {path.map((lvl, i) => {
          const isCurrent = i === path.length - 1;

          /* Every level except the last renders as a spine. A button rather than a div with an
             onClick: it is the way back to that step, and it has to be reachable by keyboard and
             announced as an action. The original was a plain div and was not. */
          if (!isCurrent) {
            return (
              <button
                type="button"
                className="drill-panel stacked"
                key={`${lvl.kind}-${i}`}
                onClick={() => nav.to(i)}
                aria-label={`Back to step ${i + 1}: ${crumb(lvl)}`}
              >
                <span className="drill-spine">
                  <span className="lvl">{stepNumber(i)}</span>
                  &nbsp;&nbsp;
                  {crumb(lvl)}
                </span>
              </button>
            );
          }

          return (
            <div className="drill-panel" key={`${lvl.kind}-${i}`} data-testid="drill-panel">
              <div className="drill-head">
                <div className="crumbs">
                  {path.map((p, j) => (
                    <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      {j > 0 && <span className="sep">›</span>}
                      <span
                        className={`c${j === path.length - 1 ? ' cur' : ''}`}
                        onClick={() => nav.to(j)}
                      >
                        {crumb(p)}
                      </span>
                    </span>
                  ))}
                </div>
                <button className="drill-close" onClick={nav.close} aria-label="Close drill-down">
                  ✕
                </button>
              </div>

              <div className="drill-body">
                {lvl.kind === 'overview' && <OverviewLevel onDim={nav.openDimension} />}
                {lvl.kind === 'dimension' && (
                  <DimensionLevel
                    dimKey={(lvl as { dimKey: string }).dimKey}
                    onCluster={(topic) => nav.openCluster(topic, (lvl as { dimKey: string }).dimKey)}
                  />
                )}
                {lvl.kind === 'cluster' && (
                  <ClusterLevel topic={(lvl as { clusterId: string }).clusterId} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}