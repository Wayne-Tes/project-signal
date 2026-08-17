/**
 * API → presentation mapping for the analytical views.
 *
 * Deliberately pure and free of React or fetch, so the reshaping logic is unit-testable without
 * a browser or a signed-in session. The views behind `AuthGate` cannot be exercised until a
 * real Identity Platform project exists (KNOWN-GAPS #16), so this is where the correctness
 * actually gets proven.
 */

/** Five dimensions, fixed across the codebase. Order drives display order. */
export const DIMENSION_KEYS = ['trust', 'quality', 'service', 'value', 'experience'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  trust: 'Trust',
  quality: 'Quality',
  service: 'Service',
  value: 'Value',
  experience: 'Experience',
};

// --- API response shapes (mirror apps/api/src/routes/scores.ts) ---------------

export interface ApiBrand {
  id: string;
  name: string;
  slug: string;
  isOwned: boolean;
}

export interface ApiDimensionRow {
  dimension: string;
  score: number;
  date: string;
  signalCount: number;
}

/**
 * `GET /brands/:id/stats` — the coverage funnel and the source counts.
 *
 * `classifiedSignals` and `lastRollupDate` are the funnel's last two stages and were added
 * because the first two are not enough to tell a healthy brand from a broken one. See
 * `coverageFooter` below.
 */
export interface ApiStats {
  signalsThisWeek: number;
  signalsPreviousWeek: number;
  totalSignals: number;
  scoredSignals: number;
  /** Scored AND tagged to at least one dimension — the step that actually reaches the index. */
  classifiedSignals: number;
  /** The last day the rollup produced anything for this brand. Null means it never has. */
  lastRollupDate: string | null;
  activeSources: number;
  configuredSources: number;
}

export interface ApiBrandScore {
  score: number | null;
  previousScore: number | null;
  date: string | null;
  previousDate: string | null;
  dimensions: ApiDimensionRow[];
  /**
   * The same dimensions at `previousDate`, or empty when there is no comparison rollup.
   *
   * The API always computed these — it needs them for `previousScore` — and used to discard
   * them. Without them no view could produce a real per-dimension delta, which is how every
   * dimension bar came to render `▲ +0`.
   */
  previousDimensions: ApiDimensionRow[];
}

export interface ApiCluster {
  topic: string;
  volume: number;
  negativity: number;
  /**
   * Mean positivity, the mirror of `negativity`.
   *
   * The API has always returned this and `strength`; the front end only modelled the negative
   * half, which is part of why the drill-down could only ever describe what was going wrong.
   */
  positivity: number;
  recency: number;
  damage: number;
  strength: number;
  sentiment: number;
  dimensions: string[];
}

// --- Presentation shapes -----------------------------------------------------

export interface DimensionCard {
  key: DimensionKey;
  label: string;
  score: number;
  /** Same dimension at the comparison date, or null when there is no earlier rollup. */
  previous: number | null;
  signalCount: number;
}

export interface HistoryPoint {
  date: string;
  label: string;
  /** Per-dimension score for the day; a dimension with no rollup that day is absent. */
  scores: Partial<Record<DimensionKey, number>>;
}

export interface CompetitorRow {
  id: string;
  name: string;
  score: number | null;
  previous: number | null;
  isOwned: boolean;
}

export interface HeelCard {
  topic: string;
  title: string;
  volume: number;
  damage: number;
  sentiment: number;
  dimensionKey: DimensionKey | null;
  dimensionLabel: string | null;
}

// --- Mapping -----------------------------------------------------------------

export function isDimensionKey(value: string): value is DimensionKey {
  return (DIMENSION_KEYS as readonly string[]).includes(value);
}

/** Rounds for display without pretending to more precision than the index carries. */
export function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Builds the five dimension cards from a `/score` response.
 *
 * Dimensions the brand has no data for are omitted rather than shown as zero — the API omits
 * them for the same reason. A card with no comparison point reports `previous: null`, which the
 * view must render as "no change data", not as a delta of zero.
 */
export function toDimensionCards(
  score: ApiBrandScore,
  previousRows: readonly ApiDimensionRow[] = [],
): DimensionCard[] {
  const prevByKey = new Map(previousRows.map((r) => [r.dimension, r.score]));

  return DIMENSION_KEYS.flatMap((key) => {
    const row = score.dimensions.find((d) => d.dimension === key);
    if (!row) return [];
    const previous = prevByKey.get(key);
    return [
      {
        key,
        label: DIMENSION_LABELS[key],
        score: roundScore(row.score),
        previous: previous === undefined ? null : roundScore(previous),
        signalCount: row.signalCount,
      },
    ];
  });
}

/**
 * Collapses the flat `(date, dimension, score)` history into one point per date.
 *
 * The API returns a row per dimension per day; the chart wants a row per day. Dates with a
 * partial rollup keep whichever dimensions ran, rather than being dropped.
 */
export function toHistory(rows: readonly ApiDimensionRow[]): HistoryPoint[] {
  const byDate = new Map<string, Partial<Record<DimensionKey, number>>>();

  for (const row of rows) {
    if (!isDimensionKey(row.dimension)) continue;
    const bucket = byDate.get(row.date) ?? {};
    bucket[row.dimension] = roundScore(row.score);
    byDate.set(row.date, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({ date, label: formatDayLabel(date), scores }));
}

/** `2026-08-06` → `6 Aug`. Kept here so the chart axis and tooltips cannot drift apart. */
export function formatDayLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return `${parsed.getUTCDate()} ${parsed.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

/**
 * Builds the competitor comparison.
 *
 * A brand with no rollup keeps a `null` score and is sorted last: it has not been measured,
 * which is not the same as measuring zero. Owned brands are flagged so the view can mark them.
 */
export function toCompetitorRows(
  brands: readonly ApiBrand[],
  scores: ReadonlyMap<string, ApiBrandScore>,
): CompetitorRow[] {
  return brands
    .map((brand) => {
      const score = scores.get(brand.id);
      return {
        id: brand.id,
        name: brand.name,
        score: score?.score == null ? null : roundScore(score.score),
        previous: score?.previousScore == null ? null : roundScore(score.previousScore),
        isOwned: brand.isOwned,
      };
    })
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}

/**
 * Turns damage-ranked clusters into display cards.
 *
 * `title` is the raw topic tag with its first letter capitalised — the model produces these, so
 * there is no curated copy to draw on and inventing a headline would be fabricating content.
 */
export function toHeelCards(clusters: readonly ApiCluster[]): HeelCard[] {
  return clusters.map((cluster) => {
    const primary = cluster.dimensions.find(isDimensionKey) ?? null;
    return {
      topic: cluster.topic,
      title: capitalise(cluster.topic),
      volume: cluster.volume,
      damage: roundScore(cluster.damage),
      sentiment: cluster.sentiment,
      dimensionKey: primary,
      dimensionLabel: primary ? DIMENSION_LABELS[primary] : null,
    };
  });
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// --- Action roadmap ----------------------------------------------------------

export type ActionPriority = 'Critical' | 'High' | 'Medium';

export interface ActionCard {
  topic: string;
  title: string;
  priority: ActionPriority;
  /** Share of current total damage this subject accounts for, 0-100. */
  impactShare: number;
  volume: number;
  sentiment: number;
  dimensionKey: DimensionKey | null;
  dimensionLabel: string | null;
}

/**
 * Derives the action roadmap from real Brand impact clusters.
 *
 * WHAT THIS REPLACES. The Roadmap view rendered `PS_ROADMAP` — a hand-written list of
 * recommendations for a fictional bank, complete with invented "+3.4 pts" impacts, effort
 * estimates and confidence percentages. Every number on that page was fabricated, and the page
 * described them as "generated weekly by Gemini Pro", which was untrue on both counts.
 *
 * WHAT IT DOES INSTEAD. Each ranked cluster becomes one action, ordered by the damage the API
 * already computes (volume x negativity x recency). Priority is a band over that ranking, and
 * `impactShare` is this subject's share of total current damage.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. No "points of uplift", no effort estimate, no confidence
 * score. The product cannot know any of those: it has no model of what a fix costs, and the
 * index moves on a 90-day half-life so no honest point prediction exists. A share of current
 * damage is a real, defensible quantity derived from real signals — an invented uplift is not,
 * and inventing one is how a user comes to distrust every other number on the page.
 */
export function toActionCards(clusters: readonly ApiCluster[]): ActionCard[] {
  const totalDamage = clusters.reduce((sum, c) => sum + (c.damage ?? 0), 0);

  return clusters.map((c, index) => {
    const dimension = c.dimensions.find(isDimensionKey) ?? null;
    return {
      topic: c.topic,
      title: c.topic,
      /* Bands over the existing ranking rather than thresholds on the raw damage value:
         damage is unbounded and scale-dependent, so a fixed threshold would mark everything
         Critical for a high-volume brand and nothing for a small one. */
      priority: index === 0 ? 'Critical' : index === 1 ? 'High' : 'Medium',
      impactShare: totalDamage > 0 ? roundScore(((c.damage ?? 0) / totalDamage) * 100) : 0,
      volume: c.volume,
      sentiment: c.sentiment,
      dimensionKey: dimension,
      dimensionLabel: dimension ? DIMENSION_LABELS[dimension] : null,
    };
  });
}

// --- Coverage funnel ---------------------------------------------------------

/**
 * Which stage of the pipeline is losing signals, said in one line.
 *
 * WHAT THIS REPLACES. The Dashboard's coverage tile reported `scoredSignals / totalSignals` and
 * nothing else. That reads as perfectly healthy in the one case that matters most: a brand whose
 * signals are all scored but tagged to no dimension reaches no index, no cluster and no
 * drill-down, and produces no rollup rows at all. "100 of 100 scored" was true and completely
 * misleading, and two brands sat in that state until the owner noticed rather than the product.
 *
 * Ordered most-severe-first, because a bare percentage collapses four different situations —
 * nothing collected, nothing scored, nothing classified, nothing rolled up — into the same "0%",
 * and they need four different responses from whoever reads it.
 */
export function coverageFooter(stats: ApiStats | null | undefined): string {
  if (!stats || stats.totalSignals === 0) return 'nothing collected for this brand yet';

  const { totalSignals, scoredSignals, classifiedSignals, lastRollupDate } = stats;

  if (scoredSignals === 0) return `${totalSignals.toLocaleString()} collected, none scored yet`;
  if (classifiedSignals === 0)
    return `${scoredSignals.toLocaleString()} scored, none tagged to a dimension`;
  if (!lastRollupDate)
    return `${classifiedSignals.toLocaleString()} classified, but no rollup has run`;

  const unscored = totalSignals - scoredSignals;
  const unclassified = scoredSignals - classifiedSignals;
  const trailing =
    unscored > 0
      ? ` · ${unscored.toLocaleString()} awaiting scoring`
      : unclassified > 0
        ? ` · ${unclassified.toLocaleString()} scored into no dimension`
        : '';

  return `${classifiedSignals.toLocaleString()} of ${totalSignals.toLocaleString()} in the index${trailing}`;
}

/**
 * Colour by whether the funnel is delivering, not by the raw percentage.
 *
 * A brand can sit at 0% because it is new, which is fine, or because everything it collects
 * falls out between scoring and the rollup, which is not. Only the second is coloured as a
 * problem — alarming on the first would train people to ignore the colour, which is the reason
 * the anomaly banner was removed rather than left showing nothing.
 *
 * Returns a CUSTOM PROPERTY, never a literal hex: literals survive every test and then break the
 * runtime palette switcher in the light theme (KNOWN-GAPS #19, #20).
 */
export function coverageTone(stats: ApiStats | null | undefined): string {
  if (!stats || stats.totalSignals === 0) return 'var(--t1)';
  if (stats.scoredSignals > 0 && (stats.classifiedSignals === 0 || !stats.lastRollupDate))
    return 'var(--coral)';
  return 'var(--t1)';
}

// --- What changed ------------------------------------------------------------

export interface ApiTopicChange {
  topic: string;
  volume: number;
  previousVolume: number;
  sentiment: number;
  previousSentiment: number | null;
  volumeDelta: number;
  sentimentDelta: number | null;
  firstSeenAt: string | null;
  isNew: boolean;
  sampleSignalIds: string[];
}

export interface ApiSourceChange {
  source: string;
  volume: number;
  previousVolume: number;
  sentiment: number | null;
  previousSentiment: number | null;
  sentimentDelta: number | null;
}

/** `GET /brands/:id/whats-new` — mirrors apps/api/src/routes/change.ts. */
export interface ApiWhatsNew {
  basis: 'ingested' | 'published';
  from: string;
  to: string;
  signalsThisPeriod: number;
  signalsPreviousPeriod: number;
  backfilledThisPeriod: number;
  sentiment: number | null;
  previousSentiment: number | null;
  sentimentDelta: number | null;
  newTopics: ApiTopicChange[];
  risingTopics: ApiTopicChange[];
  fallingTopics: ApiTopicChange[];
  improvingTopics: ApiTopicChange[];
  worseningTopics: ApiTopicChange[];
  bySource: ApiSourceChange[];
}

/**
 * A signed number for display, with an explicit answer for "there is nothing to compare".
 *
 * Returns `null` for an absent comparison so the caller must decide what to render, rather than
 * receiving a `"+0"` it will show as a green improvement. That substitution is exactly the defect
 * that put `▲ +0` on every dimension bar, and the only reliable guard against it is refusing to
 * produce the string in the first place.
 */
export function formatDelta(value: number | null, digits = 0): string | null {
  if (value === null || Number.isNaN(value)) return null;
  const rounded = Number(value.toFixed(digits));
  /* A true zero is a real finding — "measured, and it did not move" — and reads as such. */
  if (rounded === 0) return 'no change';
  /* U+2212 minus, not a hyphen: it aligns with the digits in a tabular-numeric column. */
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

/**
 * Colour for a movement in SENTIMENT.
 *
 * Deliberately not reused for volume. More conversation is not good news or bad news on its own —
 * a surge of praise and a surge of complaints are both "rising" — so colouring volume by
 * direction would assert something the number does not say.
 */
export function sentimentTone(delta: number | null): string {
  if (delta === null || delta === 0) return 'var(--t2)';
  return delta > 0 ? 'var(--mint)' : 'var(--coral)';
}

/**
 * One sentence a channel manager can read without decoding the page.
 *
 * The test of this view is whether a weekly report could be written from what is on screen, and
 * that starts with a plain summary rather than five tables the reader has to reconcile.
 */
export function changeHeadline(data: ApiWhatsNew | null | undefined, days: number): string {
  if (!data) return '';
  const period = days === 7 ? 'this week' : `in the last ${days} days`;

  if (data.signalsThisPeriod === 0) {
    return data.signalsPreviousPeriod > 0
      ? `Nothing collected ${period} — ${data.signalsPreviousPeriod.toLocaleString()} arrived in the period before it.`
      : `Nothing collected ${period}.`;
  }

  const collected =
    data.basis === 'ingested'
      ? `${data.signalsThisPeriod.toLocaleString()} signal${data.signalsThisPeriod === 1 ? '' : 's'} collected ${period}`
      : `${data.signalsThisPeriod.toLocaleString()} signal${data.signalsThisPeriod === 1 ? '' : 's'} published ${period}`;

  /* Backfill is called out rather than buried. Connecting a feed imports its whole history at
     once, and reporting that as a week's conversation is the first thing a reader would spot as
     wrong — after they had already acted on it. */
  const backfill =
    data.backfilledThisPeriod > 0
      ? `, of which ${data.backfilledThisPeriod.toLocaleString()} ${data.backfilledThisPeriod === 1 ? 'is' : 'are'} older material newly picked up`
      : '';

  const movement =
    data.sentimentDelta === null
      ? 'No earlier period to compare against yet'
      : data.sentimentDelta === 0
        ? 'Sentiment is unchanged'
        : `Sentiment is ${data.sentimentDelta > 0 ? 'up' : 'down'} ${Math.abs(data.sentimentDelta).toFixed(2)}`;

  const newCount = data.newTopics.length;
  const subjects =
    newCount === 0
      ? 'no subjects are new'
      : `${newCount} new subject${newCount === 1 ? '' : 's'}`;

  return `${collected}${backfill}. ${movement}, and ${subjects}.`;
}
