'use client';
import { useInView } from '@/hooks/useInView';
import { useCountUp } from '@/hooks/useCountUp';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import {
  toDimensionCards,
  toHeelCards,
  toHistory,
  type ApiBrandScore,
  type ApiCluster,
  type ApiDimensionRow,
  type DimensionCard,
} from '@/lib/brand-data';
import { scoreColor } from '@/lib/utils';
import { Delta } from '@/components/primitives';
import { RadialGauge } from '@/components/RadialGauge';
import { DimBar } from '@/components/DimBar';
import { LineChart, Sparkline } from '@/components/charts';
import { ViewState } from '@/components/ViewState';
import type { NavActions } from '@/lib/types';

interface BrandStats {
  signalsThisWeek: number;
  signalsPreviousWeek: number;
  totalSignals: number;
  scoredSignals: number;
  activeSources: number;
  configuredSources: number;
}

function HeroBars({
  cards,
  score,
  play,
}: {
  cards: DimensionCard[];
  score: number;
  play: boolean;
}) {
  const shown = useCountUp(Math.round(score), { play, duration: 1600 });
  return (
    <div style={{ width: '100%', padding: '8px 0 4px', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 92,
          lineHeight: 1,
          color: scoreColor(score),
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {shown}
      </div>
      <div className="kicker" style={{ marginTop: 4 }}>
        composite index
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 22 }}>
        {cards.map((d, i) => (
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

/**
 * The dashboard overview.
 *
 * Two panels were removed rather than left on mock data: the anomaly banner (alerting is Epic
 * 13, nothing detects anomalies) and signal volume by source (no endpoint aggregates weekly
 * counts per source). A hard-coded narrative caption about an "April support incident" went
 * with them — it described a fictional brand's history.
 */
export function Dashboard({ nav, hero = 'Radial gauge' }: { nav: NavActions; hero?: string }) {
  const [ref, play] = useInView(0.1);
  const { brandId, error: brandError } = useBrand();

  const score = useApi<ApiBrandScore>(brandId ? `/brands/${brandId}/score` : null);
  const history = useApi<ApiDimensionRow[]>(brandId ? `/brands/${brandId}/dimension-scores` : null);
  const stats = useApi<BrandStats>(brandId ? `/brands/${brandId}/stats` : null);
  const heels = useApi<ApiCluster[]>(brandId ? `/brands/${brandId}/brand-impact` : null);
  const strengths = useApi<ApiCluster[]>(brandId ? `/brands/${brandId}/strengths` : null);

  const cards = score.data ? toDimensionCards(score.data) : [];
  const points = history.data ? toHistory(history.data) : [];
  const chartRows = points.map((p) => ({ label: p.label, ...p.scores }));
  const composite = score.data?.score ?? null;
  const previous = score.data?.previousScore ?? null;

  const vshown = useCountUp(stats.data?.signalsThisWeek ?? 0, { duration: 1500, play });
  const weekDelta =
    stats.data && stats.data.signalsPreviousWeek > 0
      ? +(
          ((stats.data.signalsThisWeek - stats.data.signalsPreviousWeek) /
            stats.data.signalsPreviousWeek) *
          100
        ).toFixed(1)
      : null;

  const topNeg = heels.data ? toHeelCards(heels.data) : [];
  const topPos = strengths.data ? toHeelCards(strengths.data) : [];

  return (
    <div className="content view-enter" ref={ref}>
      <ViewState
        loading={score.loading || stats.loading}
        error={score.error ?? stats.error ?? brandError}
        empty={
          composite === null
            ? 'This brand has no Brand Perception Index yet — the daily rollup has not scored it.'
            : null
        }
      >
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
              <HeroBars cards={cards} score={composite ?? 0} play={play} />
            ) : (
              <RadialGauge
                value={composite ?? 0}
                size={236}
                stroke={15}
                play={play}
                sub={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    {/* No earlier rollup means no delta to show — not a delta of zero. */}
                    {previous !== null && composite !== null ? (
                      <>
                        <Delta value={+(composite - previous).toFixed(1)} />
                        <span style={{ color: 'var(--t3)', fontSize: 12 }}>vs previous</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--t3)', fontSize: 12 }}>no prior rollup</span>
                    )}
                  </div>
                }
              />
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
                <span className="kicker">trend</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {points.length} {points.length === 1 ? 'day' : 'days'}
                </span>
              </div>
              {points.length >= 2 ? (
                <Sparkline
                  data={chartRows}
                  dkey={cards[0]?.key ?? 'trust'}
                  color={scoreColor(composite ?? 0)}
                  width={312}
                  height={56}
                  play={play}
                />
              ) : (
                <p style={{ color: 'var(--t3)', fontSize: 12, margin: 0 }}>
                  A trend needs at least two daily rollups.
                </p>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
            <div className="card-h" style={{ padding: 0, marginBottom: 8 }}>
              <h3>Perception dimensions</h3>
              <span className="sub">click any to dig down</span>
              <div className="spacer" />
              <span className="drill-hint">
                {cards.length} {cards.length === 1 ? 'dimension' : 'dimensions'}
              </span>
            </div>
            {cards.map((d, i) => (
              <DimBar
                key={d.key}
                dim={{
                  key: d.key,
                  label: d.label,
                  score: d.score,
                  prev: d.previous ?? d.score,
                  weight: 0,
                  blurb: `${d.signalCount.toLocaleString()} signals`,
                }}
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
              {weekDelta === null ? (
                'no prior week to compare'
              ) : (
                <>
                  <Delta value={weekDelta} suffix="%" /> vs last week
                </>
              )}
            </div>
          </div>
          <div className="card stat">
            <div className="lab">Active sources</div>
            <div className="num">
              {stats.data?.activeSources ?? 0}
              <span style={{ fontSize: 16, color: 'var(--t3)' }}>
                {' '}
                / {stats.data?.configuredSources ?? 0}
              </span>
            </div>
            <div className="foot">configured for this brand</div>
          </div>
          {/* Replaces "Competitive rank" and "Open critical actions". Rank needs every brand's
              composite (the Competitors view does that), and open actions need the roadmap,
              which nothing produces. Scoring coverage is real and answers a question the
              operator actually has. */}
          <div className="card stat">
            <div className="lab">Scoring coverage</div>
            <div className="num">
              {stats.data && stats.data.totalSignals > 0
                ? Math.round((stats.data.scoredSignals / stats.data.totalSignals) * 100)
                : 0}
              <span style={{ fontSize: 16, color: 'var(--t3)' }}>%</span>
            </div>
            <div className="foot">
              {(stats.data?.scoredSignals ?? 0).toLocaleString()} of{' '}
              {(stats.data?.totalSignals ?? 0).toLocaleString()} scored
            </div>
          </div>
          <div className="card stat">
            <div className="lab">Worst cluster damage</div>
            <div className="num" style={{ color: 'var(--coral)' }}>
              {topNeg[0]?.damage ?? 0}
            </div>
            <div className="foot">{topNeg[0]?.title ?? 'nothing negative surfaced'}</div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 18 }}>
          <div className="card" style={{ padding: '20px 22px' }}>
            <div className="card-h" style={{ padding: 0, marginBottom: 14 }}>
              <h3>Dimension history</h3>
              <span className="sub">
                {points.length} {points.length === 1 ? 'day' : 'days'}
              </span>
              <div className="spacer" />
              <div className="legend">
                {cards.map((d) => (
                  <span className="it" key={d.key}>
                    <span className="sw" style={{ background: scoreColor(d.score) }} />
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
            {points.length >= 2 ? (
              <LineChart
                data={chartRows}
                width={1180}
                height={250}
                yMin={0}
                yMax={100}
                play={play}
                series={cards.map((d) => ({ key: d.key, color: scoreColor(d.score), w: 1.6 }))}
              />
            ) : (
              <p style={{ color: 'var(--t3)', fontSize: 13, margin: 0 }}>
                Not enough history to plot yet.
              </p>
            )}
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
              {topNeg.length === 0 && (
                <p style={{ color: 'var(--t3)', fontSize: 13, margin: 0 }}>
                  Nothing scored negatively in the window.
                </p>
              )}
              {topNeg.map((c) => (
                <button
                  key={c.topic}
                  className="drill-row"
                  onClick={() => c.dimensionKey && nav.openDimension(c.dimensionKey)}
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
              <span className="drill-hint">by strength</span>
            </div>
            <div className="drill-list">
              {topPos.length === 0 && (
                <p style={{ color: 'var(--t3)', fontSize: 13, margin: 0 }}>
                  Nothing scored positively in the window.
                </p>
              )}
              {topPos.map((c) => (
                <button
                  key={c.topic}
                  className="drill-row"
                  onClick={() => c.dimensionKey && nav.openDimension(c.dimensionKey)}
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
      </ViewState>
    </div>
  );
}
