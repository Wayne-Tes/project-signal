/**
 * Targets, benchmarks, and what an action is actually worth.
 *
 * WHY THIS EXISTS. The Action roadmap ranked subjects by damage and stopped there: a card saying
 * "12 signals mention this and it accounts for 34% of the damage" restates the complaint and
 * proposes nothing. The owner's words: *"that just goes back to telling me what the feedback is.
 * There's nothing there that is an actual plan."*
 *
 * A plan needs a destination. This module supplies it, and it does so **without importing a single
 * number from outside the system**.
 *
 * ## There is no industry standard for the Brand Perception Index, and there cannot be
 *
 * The BPI is defined by this codebase — a 0–100 composite with a 90-day half-life and per-brand
 * dimension weights. No external body publishes benchmarks for it. Any sentence of the form "the
 * industry average for Trust is 68" would be **invented**, and it would be invented in exactly the
 * place a client is most likely to quote us.
 *
 * This repository has already shipped a fictional bank's roadmap with fabricated `+3.4 pts`
 * uplifts, and two model ids written from memory. A hallucinated benchmark is the same failure
 * with a client's name attached.
 *
 * So every benchmark here is **measured, not asserted**: the tracked competitor set (same
 * pipeline, same scoring), the brand's own best territory or product, or a target the owner sets
 * deliberately. All three are verifiable inside the product by the person reading them.
 */
import type { Dimension } from '@project-signal/shared-types';
import { compositeScore, scoreAllDimensions } from './score.js';
import { DEFAULT_DIMENSION_WEIGHTS, HALF_LIFE_DAYS, type ScoredItem } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Where a target came from. Shown to the user — a target with no provenance is just a number. */
export type TargetSource = 'owner' | 'competitor-median' | 'competitor-best' | 'internal-best';

export interface Target {
  value: number;
  source: TargetSource;
  /** Human-readable provenance, e.g. "median of 3 tracked competitors". */
  label: string;
}

export interface Benchmarks {
  /** Median of the tracked competitor set. Null when none are tracked or none are scored. */
  competitorMedian: number | null;
  competitorBest: number | null;
  competitorCount: number;
  /** The brand's own strongest scope — a territory or a product — and which one. */
  internalBest: { value: number; label: string } | null;
}

/**
 * The median, not the mean.
 *
 * One competitor with almost no signals produces a wild score, and a mean lets that single
 * outlier set the whole brand's target. A median of three is still fragile, which is why the
 * count is reported alongside it rather than hidden — a target derived from one competitor should
 * be read differently from one derived from eight.
 */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Picks the target, preferring what the owner decided over what we inferred.
 *
 * DEFAULTS TO SOMETHING RATHER THAN NOTHING. An unset target means the roadmap has nothing to aim
 * at, and it quietly degenerates back into the ranked list it already was. So a default is derived
 * from the competitor set where one exists, and the source is always stated so nobody mistakes an
 * inference for a decision.
 *
 * `competitor-median` rather than `competitor-best` as the default: beating the median is a
 * credible quarter's work, and a target nobody believes is a target nobody uses. The best score is
 * still reported, as the stretch.
 *
 * Returns null when there is genuinely nothing to aim at — no owner target, no scored competitor,
 * no internal comparison. That is a real state, and inventing a round number like 75 to fill it
 * would be the fabrication this whole module exists to avoid.
 */
export function resolveTarget(
  ownerTarget: number | null | undefined,
  benchmarks: Benchmarks,
): Target | null {
  if (ownerTarget !== null && ownerTarget !== undefined && Number.isFinite(ownerTarget)) {
    return { value: ownerTarget, source: 'owner', label: 'set for this brand' };
  }
  if (benchmarks.competitorMedian !== null) {
    return {
      value: benchmarks.competitorMedian,
      source: 'competitor-median',
      label: `median of ${benchmarks.competitorCount} tracked competitor${benchmarks.competitorCount === 1 ? '' : 's'}`,
    };
  }
  if (benchmarks.internalBest !== null) {
    return {
      value: benchmarks.internalBest.value,
      source: 'internal-best',
      label: `your strongest scope — ${benchmarks.internalBest.label}`,
    };
  }
  return null;
}

export interface Counterfactual {
  /** The composite as it stands. */
  from: number;
  /** The composite with this subject's negativity removed. */
  to: number;
  /** `to - from`. Positive, or zero when the subject carries no negativity. */
  delta: number;
  /** Signals the calculation moved. */
  affectedSignals: number;
}

/**
 * What resolving one subject is worth, as arithmetic rather than as a guess.
 *
 * **THE CEILING, NOT A FORECAST.** This answers "if nobody were negative about this any more,
 * where would the index be" — the maximum the subject can be worth. It says nothing about how
 * much of that is achievable, or when. That distinction has to survive into the UI copy, because
 * the fabricated `+3.4 pts` this replaces was believed precisely because it looked like a
 * prediction.
 *
 * NEGATIVE SCORES ARE NEUTRALISED, NOT REMOVED. Dropping the items entirely would also drop their
 * positive mentions and change every count, producing a number that overstates the gain. Clamping
 * each affected item to `max(0, score)` models exactly the claim being made — the complaints stop
 * being complaints — and leaves genuinely positive mentions of the same subject untouched.
 */
export function counterfactual(
  items: readonly ScoredItem[],
  topic: string,
  asOf: Date,
  weights: Readonly<Partial<Record<Dimension, number>>> = DEFAULT_DIMENSION_WEIGHTS,
): Counterfactual | null {
  const key = topic.trim().toLowerCase();
  const before = compositeScore(scoreAllDimensions(items, asOf), weights);
  if (before === null) return null;

  let affected = 0;
  const resolved = items.map((item) => {
    if (item.score >= 0) return item;
    if (!item.topics.some((t) => t.trim().toLowerCase() === key)) return item;
    affected += 1;
    return { ...item, score: 0 };
  });

  const after = compositeScore(scoreAllDimensions(resolved, asOf), weights);
  if (after === null) return null;

  return {
    from: before,
    to: after,
    /* Clamped at zero. Floating-point noise can make a no-op counterfactual come out fractionally
       negative, and "resolving this would LOWER your score by 0.0001" is nonsense on a card. */
    delta: Math.max(0, after - before),
    affectedSignals: affected,
  };
}

export interface Projection {
  /** The composite this many days out, with no new signals. */
  points: { day: number; score: number }[];
  /** Days until `target` is reached under decay alone, or null if not within the horizon. */
  daysToTarget: number | null;
  /** True when decay makes things WORSE — recent signals are more negative than the old ones. */
  decliningWithoutAction: boolean;
}

/** How far ahead a projection looks. Four half-lives; beyond that the assumption is fantasy. */
export const PROJECTION_HORIZON_DAYS = HALF_LIFE_DAYS * 4;

/**
 * The rollup's window. Items older than this are not scored at all — see `LOOKBACK_DAYS` in
 * `apps/ingestion/src/rollup.ts` and `BRAND_IMPACT_LOOKBACK_DAYS` in the API's scores route.
 */
export const LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

/**
 * Where the index goes on its own, if nothing new arrives.
 *
 * ## Decay does NOT move this score, and assuming it did was wrong
 *
 * The obvious model — "old complaints fade, so the index recovers" — is **arithmetically false
 * here**, and a test written against it is what exposed that. `scoreDimension` is a WEIGHTED MEAN.
 * Advancing `asOf` by T days multiplies every item's `recencyWeight` by the same constant
 * `2^(-T/90)`, and a weighted mean is invariant under a uniform scaling of its weights. The score
 * comes out identical to fifteen decimal places.
 *
 * So the honest answer to "what happens if we do nothing" is usually **nothing happens**, and that
 * is a far more useful thing to tell a channel manager than a comforting recovery curve. The index
 * does not heal by itself.
 *
 * ## What genuinely does move it
 *
 * The **lookback cut-off**, not the decay. The rollup scores only items published within
 * `LOOKBACK_DAYS`, so as time passes the oldest signals leave the set entirely — and *that*
 * changes the mean. This function therefore applies the same window at each future date, which
 * makes every point exactly what the rollup will itself compute on that day.
 *
 * The other mover is new signals arriving, which is behaviour and is deliberately not modelled.
 * The assumption ("nothing new arrives") is false in reality and must be stated wherever this is
 * shown; its value is as a bound, and bracketing honestly beats predicting confidently.
 *
 * **It can go DOWN.** If the signals ageing out are the positive ones, doing nothing makes things
 * worse — reported as `decliningWithoutAction` rather than buried in a chart nobody reads.
 */
export function project(
  items: readonly ScoredItem[],
  asOf: Date,
  target: number | null,
  weights: Readonly<Partial<Record<Dimension, number>>> = DEFAULT_DIMENSION_WEIGHTS,
  horizonDays: number = PROJECTION_HORIZON_DAYS,
  lookbackDays: number = LOOKBACK_DAYS,
): Projection | null {
  const at = (day: number): number | null => {
    const then = new Date(asOf.getTime() + day * MS_PER_DAY);
    const since = new Date(then.getTime() - lookbackDays * MS_PER_DAY);
    /* The same window the rollup applies, so each point is what it will actually compute that
       day — not a curve derived from a different rule than the one that produces the number. */
    const inWindow = items.filter((i) => i.publishedAt >= since);
    return compositeScore(scoreAllDimensions(inWindow, then), weights);
  };

  const start = at(0);
  if (start === null) return null;

  const points: { day: number; score: number }[] = [];
  let daysToTarget: number | null = null;

  /* Weekly steps. Daily would be 360 recomputations of the whole item set for a line nobody can
     read at that resolution, and the half-life makes weekly granularity indistinguishable. */
  for (let day = 0; day <= horizonDays; day += 7) {
    const score = at(day);
    if (score === null) continue;
    points.push({ day, score });
    if (daysToTarget === null && target !== null && score >= target) daysToTarget = day;
  }

  const end = points[points.length - 1]?.score ?? start;

  return {
    points,
    daysToTarget,
    /* Half a point of tolerance: a mean drifting by hundredths is noise, not a decline, and
       flagging it would put a warning on almost every brand. */
    decliningWithoutAction: end < start - 0.5,
  };
}

/**
 * The gap to a target, and whether it is already met.
 *
 * A separate function rather than a subtraction at each call site because "already there" needs to
 * read differently from "0.0 to go", and getting that wrong is how a brand that has hit its target
 * is shown a roadmap urging it to close a gap of zero.
 */
export function gapTo(current: number | null, target: Target | null): number | null {
  if (current === null || target === null) return null;
  return Math.max(0, target.value - current);
}

// --- Outcomes ----------------------------------------------------------------

/**
 * What happened after an action was accepted.
 *
 * `unmeasurable` is a first-class verdict, not an error state. An action accepted yesterday, or on
 * a brand whose rollup has not run since, genuinely has no outcome yet — and reporting "no change"
 * for it would be a claim we cannot support. The distinction between "we measured and nothing
 * moved" and "we cannot tell yet" is the difference between an experiment log and a comfort
 * blanket.
 */
export type OutcomeVerdict = 'improved' | 'unchanged' | 'worsened' | 'unmeasurable';

export interface Outcome {
  verdict: OutcomeVerdict;
  /** Index movement since the baseline, or null when it cannot be measured. */
  indexDelta: number | null;
  /**
   * Change in the subject's damage score. Context only — **the verdict never keys off this.**
   *
   * `damage = volume × negativity × recency`, so it is volume-sensitive in a way that makes it a
   * treacherous measure of success. Drowning complaints in fresh praise RAISES damage: volume and
   * recency both climb faster than mean negativity falls. Verified against real data — an action
   * that took the index from 23.1 to 61.7 moved damage from 2.51 to 2.87, upward.
   *
   * So a rise here is not failure and a fall is not proof. The index is what the target is set
   * against and the index is what the verdict uses; this is reported beside it because a change in
   * how much a subject is discussed is worth seeing, not because it grades the work.
   */
  damageDelta: number | null;
  /**
   * How much of the claimed ceiling actually materialised, as a percentage.
   *
   * THE NUMBER THAT MAKES THE LOG WORTH KEEPING. Over enough actions it says whether the ceiling
   * is a useful predictor at all, and whether a given play works — neither of which any amount of
   * borrowed case-study evidence can tell you about YOUR brand.
   *
   * Null when there was no ceiling claimed, or nothing measurable to compare it to. Uncapped on
   * purpose: a result above 100% means other things improved too, and clamping it would hide that
   * the attribution is loose rather than pretending it is precise.
   */
  capturedPercent: number | null;
  /** Days between the baseline and the measurement. */
  elapsedDays: number | null;
}

/**
 * How far the index must move before it counts as movement.
 *
 * The composite drifts by fractions on re-scoring alone. Without a floor, every action would be
 * reported as "improved" or "worsened" the day after it was accepted, which would make the log
 * noise rather than evidence. Half a point on a 0–100 scale is a deliberate opening position; it
 * should be revisited against real outcome data, not reasoned about further.
 */
export const OUTCOME_MOVE_THRESHOLD = 0.5;

/** Below this, the index has not had time to respond and any verdict would be premature. */
export const OUTCOME_MIN_DAYS = 7;

export function evaluateOutcome(input: {
  baselineIndex: number | null;
  baselineDamage: number | null;
  ceilingDelta: number | null;
  currentIndex: number | null;
  currentDamage: number | null;
  baselineAt: Date;
  asOf: Date;
}): Outcome {
  const elapsedDays = Math.floor((input.asOf.getTime() - input.baselineAt.getTime()) / MS_PER_DAY);

  const measurable =
    input.baselineIndex !== null && input.currentIndex !== null && elapsedDays >= OUTCOME_MIN_DAYS;

  const indexDelta =
    input.baselineIndex !== null && input.currentIndex !== null
      ? input.currentIndex - input.baselineIndex
      : null;

  const damageDelta =
    input.baselineDamage !== null && input.currentDamage !== null
      ? input.currentDamage - input.baselineDamage
      : null;

  if (!measurable || indexDelta === null) {
    return { verdict: 'unmeasurable', indexDelta, damageDelta, capturedPercent: null, elapsedDays };
  }

  const verdict: OutcomeVerdict =
    indexDelta > OUTCOME_MOVE_THRESHOLD
      ? 'improved'
      : indexDelta < -OUTCOME_MOVE_THRESHOLD
        ? 'worsened'
        : 'unchanged';

  const capturedPercent =
    input.ceilingDelta !== null && input.ceilingDelta > 0
      ? (indexDelta / input.ceilingDelta) * 100
      : null;

  return { verdict, indexDelta, damageDelta, capturedPercent, elapsedDays };
}
