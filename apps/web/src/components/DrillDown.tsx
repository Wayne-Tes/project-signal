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

/**
 * The signals themselves, however they were narrowed.
 *
 * Shared by the dimension and topic levels. No quotation is rendered — see the note in
 * `ClusterLevel` — so this is metadata and a link to where it was actually published.
 */
function SignalList({ items }: { items: ApiSignal[] }) {
  return (
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
            {/* The API returns signal METADATA — the verbatim text lives in object storage and is
                not exposed by any endpoint. The version of this file that predated the API filled
                this space with invented quotations attributed to invented authors, which is the
                single most damaging thing it could do. The honest affordance is the link. */}
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
  );
}

/**
 * Level 2 — one dimension: the topics driving it, and the signals underneath them.
 *
 * THIS LEVEL USED TO CONTRADICT THE ONE ABOVE IT. It read `/brand-impact` and filtered
 * client-side, and `/brand-impact` excludes every cluster with zero damage by design — a topic
 * nobody is negative about is not a weakness. So a dimension people were POSITIVE about had no
 * qualifying cluster at all, and this level answered "no topic cluster has been tagged to
 * experience yet" directly beneath a row reading "5 signals contributed". The better a dimension
 * scored, the more certain its drill-down was to be empty.
 *
 * It now reads `/topics?dimension=`, which ranks every cluster touching the dimension by presence
 * rather than by damage, and it ALWAYS lists the contributing signals beneath — so the level
 * cannot dead-end even before any topic has formed. Level 1 promises the number traces to
 * evidence; this is that evidence.
 */
function DimensionLevel({ dimKey, onCluster }: { dimKey: string; onCluster: (topic: string) => void }) {
  const { brandId } = useBrand();
  const topics = useApi<ApiCluster[]>(
    brandId ? `/brands/${brandId}/topics?dimension=${encodeURIComponent(dimKey)}` : null,
  );
  const signals = useApi<{ items: ApiSignal[] }>(
    brandId
      ? `/brands/${brandId}/signals?limit=20&dimension=${encodeURIComponent(dimKey)}`
      : null,
  );

  const label = isDimensionKey(dimKey) ? DIMENSION_LABELS[dimKey] : dimKey;
  const clusters = topics.data ?? [];
  const items = signals.data?.items ?? [];
  const loading = topics.loading || signals.loading;

  return (
    <>
      <h2 className="drill-title">{label}</h2>
      <p className="drill-sub">
        Topics driving this dimension — what is helping as well as what is hurting — and the
        signals behind them.
      </p>

      {loading ? (
        <p className="drill-sub">Loading…</p>
      ) : (
        <>
          {clusters.length > 0 && (
            <div className="drill-list">
              {clusters.map((c) => (
                <button className="drill-row" key={c.topic} onClick={() => onCluster(c.topic)}>
                  <div className="lead" style={{ background: 'var(--surface-track)', color: sentColor(c.sentiment) }}>
                    {c.volume}
                  </div>
                  <div className="body">
                    <div className="nm">{c.topic}</div>
                    <div className="ds">
                      {/* Damage on a positive cluster is always 0.0 and reads as an error. Each
                          cluster reports whichever of the two measures it actually carries. */}
                      {sentLabel(c.sentiment)} ·{' '}
                      {c.damage > 0
                        ? `damage ${c.damage.toFixed(1)}`
                        : c.strength > 0
                          ? `strength ${c.strength.toFixed(1)}`
                          : `${c.volume} signal${c.volume === 1 ? '' : 's'}`}
                    </div>
                    <div className="mini-bar">
                      <i
                        style={{
                          width: `${Math.min(Math.max(c.negativity, c.positivity) * 100, 100)}%`,
                          background: sentColor(c.sentiment),
                        }}
                      />
                    </div>
                  </div>
                  <div className="arr">→</div>
                </button>
              ))}
            </div>
          )}

          {items.length > 0 ? (
            <>
              {/* Labelled, because without a heading the signals read as belonging to the last
                  topic above them rather than to the dimension. */}
              <p className="drill-sub" style={{ marginTop: clusters.length > 0 ? 20 : 0 }}>
                {clusters.length > 0
                  ? `Signals tagged to ${label.toLowerCase()}`
                  : `No topic has formed yet, but these signals were scored on ${label.toLowerCase()}.`}
              </p>
              <SignalList items={items} />
            </>
          ) : (
            clusters.length === 0 && (
              <p className="prov">
                Nothing has been scored on {label.toLowerCase()} yet. Signals appear here once the
                scorer has tagged them to this dimension.
              </p>
            )
          )}
        </>
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
  /* A positive topic reaches this level now that the dimension above it no longer hides one, and
     its damage is 0.0 by construction. Reporting the measure the cluster actually carries keeps
     the row from reading as a bug. */
  const impact =
    cluster && cluster.damage > 0
      ? { label: 'Damage', value: cluster.damage.toFixed(1) }
      : { label: 'Strength', value: (cluster?.strength ?? 0).toFixed(1) };

  return (
    <>
      <h2 className="drill-title">{topic}</h2>
      <p className="drill-sub">The signals the scorer tagged with this topic.</p>

      {cluster && (
        <MetricRow
          items={[
            { label: 'Signals', value: String(cluster.volume) },
            { label: 'Sentiment', value: sentLabel(cluster.sentiment), tone: sentColor(cluster.sentiment) },
            impact,
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
        <SignalList items={items} />
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