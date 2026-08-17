'use client';

import { useState } from 'react';
import { ListChecks, Target, TrendingDown } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import {
  achievableSummary,
  formatHorizon,
  roadmapHeadline,
  withTerritory,
  type ApiAction,
  type ApiRoadmap,
} from '@/lib/brand-data';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, Grid, PageHeader, PanelHeader, Stack } from '@/design-system';
import type { NavActions } from '@/lib/types';

/**
 * Action roadmap — what to fix, what it is worth, and what you are aiming at.
 *
 * WHAT THIS REPLACES, TWICE OVER. It first rendered `PS_ROADMAP`: hand-written recommendations for
 * a fictional bank with invented point-uplifts and effort estimates, under a header claiming an
 * LLM produced them. That was deleted. What replaced it ranked real clusters by damage — honest,
 * but it only restated the complaint: *"that just goes back to telling me what the feedback is.
 * There's nothing there that is an actual plan on how to fix these things."*
 *
 * A plan needs a destination and a price. This page now carries both:
 *
 *   - a TARGET, with its provenance stated, derived from the tracked competitor set or set by the
 *     owner — never an imported "industry standard", because the Brand Perception Index is defined
 *     by this codebase and no external body publishes a benchmark for it;
 *   - a CEILING per action — what resolving it is worth, computed by re-running the composite with
 *     that subject's negativity removed;
 *   - whether the listed work is ENOUGH to close the gap, which is the question a quarter gets
 *     planned around.
 *
 * What it still does NOT claim: effort, confidence, or a date by which a fix will land. The
 * product has no model for any of them, and the fabricated versions are exactly what was deleted.
 */
export function RoadmapView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError, territory } = useBrand();
  const { role } = useAuth();
  const { data, loading, error } = useApi<ApiRoadmap>(
    brandId ? withTerritory(`/brands/${brandId}/roadmap`, territory) : null,
  );

  const canSetTarget = role === 'admin' || role === 'owner';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const saveTarget = async (value: number | null): Promise<void> => {
    if (!brandId) return;
    setSaveError('');
    try {
      await apiFetch(`/brands/${brandId}/target`, {
        method: 'PATCH',
        body: JSON.stringify({ targetScore: value }),
      });
      setEditing(false);
      /* The page does not refetch itself — `useApi` has no invalidation hook — so say the save
         landed rather than leaving the old number on screen looking like a failure. */
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the target');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Action roadmap"
        title="What to fix, and what it is worth"
        subtitle="Ranked by the damage each subject is doing now. Every figure is measured or computed from your own signals — there is no imported industry benchmark for this index, because none exists."
      />

      <ViewState loading={loading} error={error ?? brandError} empty={null}>
        {!data ? null : (
          <Stack gap="var(--s-5)">
            <Card>
              <p className="chg-headline">{roadmapHeadline(data)}</p>

              {achievableSummary(data) && (
                <p className="rm-sub">{achievableSummary(data)}</p>
              )}

              {/* The finding worth interrupting for. Decay does NOT move this index — it is a
                  weighted mean, invariant under a uniform rescaling of its weights — so "wait and
                  it recovers" is arithmetically false. When the signals ageing out are the
                  positive ones, doing nothing actively makes it worse. */}
              {data.projection?.decliningWithoutAction && (
                <p className="rm-warn">
                  <TrendingDown size={15} strokeWidth={1.9} aria-hidden="true" /> On current
                  signals this declines without action — the older, more positive coverage is
                  ageing out of the scoring window.
                </p>
              )}

              {data.projection?.daysToTarget !== null && data.projection && (
                <p className="rm-sub">
                  Reaches the target in {formatHorizon(data.projection.daysToTarget)} assuming{' '}
                  {data.projection.assumption} — a bound, not a forecast.
                </p>
              )}

              <div className="rm-benchmarks">
                {data.benchmarks.competitorCount > 0 && (
                  <span>
                    Competitors: median{' '}
                    <strong>{data.benchmarks.competitorMedian?.toFixed(1)}</strong>, best{' '}
                    <strong>{data.benchmarks.competitorBest?.toFixed(1)}</strong> (
                    {data.benchmarks.competitorCount} tracked)
                  </span>
                )}
                {data.benchmarks.internalBest && (
                  <span>
                    Your strongest scope: <strong>{data.benchmarks.internalBest.label}</strong> at{' '}
                    {data.benchmarks.internalBest.value.toFixed(1)}
                  </span>
                )}
                {data.benchmarks.competitorCount === 0 && !data.benchmarks.internalBest && (
                  <span>
                    No competitor tracked and no second territory — add either to get a measured
                    benchmark rather than a guessed one.
                  </span>
                )}
              </div>

              {canSetTarget && (
                <div className="rm-target">
                  {editing ? (
                    <>
                      <label htmlFor="targetScore" className="ds-eyebrow">
                        Target index
                      </label>
                      <input
                        id="targetScore"
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Target index"
                      />
                      <button
                        type="button"
                        className="ds-chip"
                        onClick={() => void saveTarget(draft === '' ? null : Number(draft))}
                      >
                        Save
                      </button>
                      <button type="button" className="ds-chip" onClick={() => setEditing(false)}>
                        Cancel
                      </button>
                      {/* Clearing returns the brand to a competitor-derived default. Without a way
                          back, a target typed in error is permanent. */}
                      <button type="button" className="ds-chip" onClick={() => void saveTarget(null)}>
                        Clear
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ds-chip"
                      onClick={() => {
                        setDraft(data.target ? String(data.target.value) : '');
                        setSaved(false);
                        setEditing(true);
                      }}
                    >
                      <Target size={14} strokeWidth={1.9} aria-hidden="true" />{' '}
                      {data.target?.source === 'owner' ? 'Change target' : 'Set a target'}
                    </button>
                  )}
                  {saved && <span className="rm-saved">Saved — reload to see it applied.</span>}
                  {saveError && <span className="rm-error">{saveError}</span>}
                </div>
              )}
            </Card>

            {data.actions.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<ListChecks size={22} strokeWidth={1.8} />}
                  title="Nothing is damaging your score"
                  body="Actions are derived from the subjects doing measurable damage. Nothing has scored negatively enough to rank — which is also what you see before any signals have been scored."
                />
              </Card>
            ) : (
              <Grid min="380px">
                {data.actions.map((a, i) => (
                  <ActionCard key={a.topic} action={a} rank={i + 1} onOpen={() => nav.openTopic(a.topic)} />
                ))}
              </Grid>
            )}
          </Stack>
        )}
      </ViewState>
    </>
  );
}

function ActionCard({
  action,
  rank,
  onOpen,
}: {
  action: ApiAction;
  rank: number;
  onOpen: () => void;
}) {
  const worth = action.ifResolved?.delta ?? 0;

  return (
    <Card accent={rank === 1 ? 'critical' : rank === 2 ? 'warn' : 'info'} onClick={onOpen}>
      <PanelHeader
        title={action.topic}
        subtitle={`${action.volume} signal${action.volume === 1 ? '' : 's'} · ${action.damageShare.toFixed(0)}% of current damage`}
        actions={<span className="ds-eyebrow">#{rank}</span>}
      />

      {worth > 0 ? (
        <p className="rm-worth">
          Resolving this moves the index from{' '}
          <strong>{action.ifResolved!.from.toFixed(1)}</strong> to{' '}
          <strong>{action.ifResolved!.to.toFixed(1)}</strong>
          <span className="rm-delta"> +{worth.toFixed(1)}</span>
          {/* THE CEILING, NOT A FORECAST. The `+3.4 pts` this replaces was believed precisely
              because it looked like a prediction, so the qualifier is not optional copy. */}
          <span className="rm-caveat">
            {' '}
            — the most it can be worth, if nobody were negative about it any more. It assumes
            nothing about how much is achievable, or when.
          </span>
        </p>
      ) : (
        <p className="rm-worth rm-caveat">
          No measurable index gain — this subject carries volume but little negativity.
        </p>
      )}

      <p className="rm-evidence">
        Based on {action.ifResolved?.affectedSignals ?? 0} negative signal
        {(action.ifResolved?.affectedSignals ?? 0) === 1 ? '' : 's'}. Open to read them.
      </p>

      <div className="rm-dims">
        {action.dimensions.slice(0, 3).map((d) => (
          <Badge key={d} tone="neutral">
            {d}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
