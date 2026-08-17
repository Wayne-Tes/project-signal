/**
 * Period-over-period change: what is new, what is rising, what is falling.
 *
 * WHY THIS EXISTS. The product could say what perception *is* and not what it *did*. The owner's
 * words: *"I can't tell based on all the different scans what new features or new comments are
 * being discussed… over time, be able to track sentiment if it's staying the same, if it's
 * increasing… I need to be able to drill down specific source or the product and see, are we
 * making it better?"* A score with no derivative answers none of that.
 *
 * COMPUTED ON READ, deliberately, and not from a stored snapshot table. Everything here is
 * derivable from `sentiment_results.topics` and the two date columns on `signals`, and it is
 * deterministic — `recencyWeight` is a pure function of an item's distance from `asOf`, so any
 * past day is reproducible from data already held. A snapshot table would add an hourly write
 * amplification of (topics × brands) and a second home for a number that can drift from its
 * source, which is the failure `signals` already had with its denormalised sentiment columns
 * (KNOWN-GAPS #11) and which `PLAN-product-hierarchy.md` §2.3 rejected for the portfolio index on
 * the same grounds.
 *
 * Revisit that decision when a single brand passes ~50,000 signals in the rollup window, or p95
 * on the endpoint passes 500 ms — and record the measurement in the change that reverses it. See
 * `docs/PLAN-change-territory-and-actions.md` §2.1.
 */
import type { SentimentLabel } from '@project-signal/shared-types';

/**
 * Which date decides when something happened.
 *
 * These answer different questions and conflating them is how a "new this week" panel lies.
 *
 * - `ingested` — **what we learned this week.** A review written in March that a newly connected
 *   feed surfaced today is new *to us*, and this is the honest basis for "across a week of
 *   scanning, what is new", which is what was actually asked for.
 * - `published` — **what the world said this week.** The right basis for trend, because
 *   backfilling a March review must not create an August spike.
 *
 * The caller picks, and the response echoes the choice back so the UI can label it. A surface
 * that shows one and implies the other is worse than showing neither.
 */
export type ChangeBasis = 'ingested' | 'published';

/** One scored signal, reduced to what change detection needs. */
export interface ChangeItem {
  signalId: string;
  publishedAt: Date;
  ingestedAt: Date;
  source: string;
  score: number;
  label: SentimentLabel;
  topics: string[];
}

export interface TopicChange {
  topic: string;
  volume: number;
  previousVolume: number;
  /** Mean sentiment this period, −1 … 1. */
  sentiment: number;
  /** Mean sentiment last period, or `null` when the topic did not appear then. */
  previousSentiment: number | null;
  /** `volume - previousVolume`. Positive is more discussion, not better sentiment. */
  volumeDelta: number;
  /** `sentiment - previousSentiment`, or `null` when there is nothing to compare against. */
  sentimentDelta: number | null;
  /** When this topic was first seen at all, across the brand's whole history. */
  firstSeenAt: string | null;
  /** True only when the topic has never been seen before this window. */
  isNew: boolean;
  sampleSignalIds: string[];
}

export interface SourceChange {
  source: string;
  volume: number;
  previousVolume: number;
  sentiment: number | null;
  previousSentiment: number | null;
  sentimentDelta: number | null;
}

export interface ChangeSummary {
  basis: ChangeBasis;
  from: string;
  to: string;
  signalsThisPeriod: number;
  signalsPreviousPeriod: number;
  /**
   * Signals whose publication predates their collection by more than a week.
   *
   * Surfaced separately rather than folded into the count, because a newly connected feed
   * back-filling two years of reviews is not a surge of new conversation, and reporting it as one
   * would be the first thing a channel manager noticed was wrong.
   */
  backfilledThisPeriod: number;
  sentiment: number | null;
  previousSentiment: number | null;
  /** `null`, never `0`, when there is no comparison period. */
  sentimentDelta: number | null;
  newTopics: TopicChange[];
  /** More discussed than last period. A VOLUME movement — it says nothing about sentiment. */
  risingTopics: TopicChange[];
  /** Less discussed than last period, including topics that stopped entirely. */
  fallingTopics: TopicChange[];
  /**
   * Sentiment moved materially, in each direction.
   *
   * These are NOT the volume lists re-sorted, and the difference is the whole question the owner
   * asked — *"are we making it better?"*. A topic discussed exactly as much as last week whose
   * sentiment fell from +0.5 to −0.5 is the single most important thing on the page, and it
   * appears in neither `risingTopics` nor `fallingTopics`, because its volume did not move at
   * all. Ranked by `|sentimentDelta| × volume`, so a big subject moving moderately outranks a
   * two-signal topic swinging wildly.
   */
  improvingTopics: TopicChange[];
  worseningTopics: TopicChange[];
  bySource: SourceChange[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A signal collected more than this long after publication is a backfill, not news. */
export const BACKFILL_THRESHOLD_DAYS = 7;

/** How many contributing signals each topic carries, so the UI can link straight to evidence. */
const SAMPLE_SIZE = 3;

/**
 * How far sentiment must move, on the −1…1 scale, before it counts as a movement.
 *
 * Without a floor, every topic appears in one of the sentiment lists every week: model output
 * varies slightly on re-scoring, and a mean over a handful of signals moves on its own. A page
 * where everything is always "changing" is one people stop reading, which costs more than
 * missing a marginal move.
 *
 * 0.15 of a 2.0-wide scale — 7.5% — is a deliberate opening position, not a tuned value. Revisit
 * it against real weekly data rather than by reasoning about it.
 */
export const SENTIMENT_MOVE_THRESHOLD = 0.15;

function basisDate(item: ChangeItem, basis: ChangeBasis): Date {
  return basis === 'ingested' ? item.ingestedAt : item.publishedAt;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Normalised the same way everywhere a topic is compared — the clusterer lowercases too. */
function normaliseTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

/**
 * Splits items into this period and the one immediately before it, of equal length.
 *
 * Equal length matters: comparing seven days against thirty would make every topic look like it
 * is collapsing, and the direction of that error is the one nobody questions.
 */
export function splitPeriods(
  items: readonly ChangeItem[],
  asOf: Date,
  days: number,
  basis: ChangeBasis,
): { current: ChangeItem[]; previous: ChangeItem[] } {
  const start = new Date(asOf.getTime() - days * MS_PER_DAY);
  const priorStart = new Date(asOf.getTime() - 2 * days * MS_PER_DAY);

  const current: ChangeItem[] = [];
  const previous: ChangeItem[] = [];

  for (const item of items) {
    const at = basisDate(item, basis);
    /* `> asOf` is excluded rather than clamped. A source that back-dates, or a clock skew, would
       otherwise let a future-stamped item count in every period at once. */
    if (at > asOf) continue;
    if (at >= start) current.push(item);
    else if (at >= priorStart) previous.push(item);
  }

  return { current, previous };
}

interface TopicBucket {
  volume: number;
  scores: number[];
  signalIds: string[];
}

function bucketByTopic(items: readonly ChangeItem[]): Map<string, TopicBucket> {
  const byTopic = new Map<string, TopicBucket>();
  for (const item of items) {
    /* One signal carrying three topics contributes to all three. Deduplicated per signal so a
       model returning the same tag twice cannot inflate a topic's volume. */
    for (const topic of new Set(item.topics.map(normaliseTopic))) {
      if (!topic) continue;
      const bucket = byTopic.get(topic) ?? { volume: 0, scores: [], signalIds: [] };
      bucket.volume += 1;
      bucket.scores.push(item.score);
      if (bucket.signalIds.length < SAMPLE_SIZE) bucket.signalIds.push(item.signalId);
      byTopic.set(topic, bucket);
    }
  }
  return byTopic;
}

/**
 * The whole change summary for one brand and one window.
 *
 * `firstSeen` maps a normalised topic to the earliest date it was ever seen for this brand,
 * across ALL history — not just the two windows being compared. That distinction is what makes
 * "new" mean new: a topic discussed in March, quiet in July and back in August is a RETURNING
 * topic, and calling it new would misdirect whoever acts on it. A topic missing from the map is
 * treated as new, because the only way to be absent is to have no earlier occurrence.
 */
export function summariseChange(
  items: readonly ChangeItem[],
  firstSeen: ReadonlyMap<string, Date>,
  options: { asOf: Date; days: number; basis: ChangeBasis },
): ChangeSummary {
  const { asOf, days, basis } = options;
  const { current, previous } = splitPeriods(items, asOf, days, basis);
  const windowStart = new Date(asOf.getTime() - days * MS_PER_DAY);

  const nowTopics = bucketByTopic(current);
  const thenTopics = bucketByTopic(previous);

  const changes: TopicChange[] = [];
  for (const [topic, bucket] of nowTopics) {
    const before = thenTopics.get(topic);
    const sentiment = mean(bucket.scores) ?? 0;
    const previousSentiment = before ? mean(before.scores) : null;
    const first = firstSeen.get(topic) ?? null;

    changes.push({
      topic,
      volume: bucket.volume,
      previousVolume: before?.volume ?? 0,
      sentiment,
      previousSentiment,
      volumeDelta: bucket.volume - (before?.volume ?? 0),
      /* `null` rather than a delta against an assumed zero. A topic nobody mentioned last week
         has no previous sentiment, and reporting "improved by 0.6" against a number that never
         existed is the fabricated-comparison defect that produced `▲ +0` on the dimension bars. */
      sentimentDelta: previousSentiment === null ? null : sentiment - previousSentiment,
      firstSeenAt: first ? first.toISOString() : null,
      /* New only if it has never been seen before this window opened. */
      isNew: first === null || first >= windowStart,
      sampleSignalIds: bucket.signalIds,
    });
  }

  const newTopics = changes
    .filter((c) => c.isNew)
    .sort((a, b) => b.volume - a.volume || a.topic.localeCompare(b.topic));

  /* Rising and falling exclude what is new: a topic appearing from nothing is already reported
     above, and listing it again as "rising" would double-count the only thing on the page a
     reader is trying to prioritise. Ranked by the SIZE of the move, so the biggest change leads
     regardless of direction. */
  const seen = changes.filter((c) => !c.isNew && c.previousVolume > 0);
  const rising = seen
    .filter((c) => c.volumeDelta > 0)
    .sort((a, b) => b.volumeDelta - a.volumeDelta || a.topic.localeCompare(b.topic));

  /* Falling is computed over topics present in EITHER period, because a topic that vanished
     completely is the most extreme fall there is and it has no bucket in the current period at
     all. Reading only the current period would make it invisible — silence looking like calm. */
  const gone: TopicChange[] = [];
  for (const [topic, before] of thenTopics) {
    if (nowTopics.has(topic)) continue;
    const first = firstSeen.get(topic) ?? null;
    const previousSentiment = mean(before.scores);
    gone.push({
      topic,
      volume: 0,
      previousVolume: before.volume,
      sentiment: 0,
      previousSentiment,
      volumeDelta: -before.volume,
      sentimentDelta: null,
      firstSeenAt: first ? first.toISOString() : null,
      isNew: false,
      sampleSignalIds: before.signalIds,
    });
  }

  const falling = [...seen.filter((c) => c.volumeDelta < 0), ...gone].sort(
    (a, b) => a.volumeDelta - b.volumeDelta || a.topic.localeCompare(b.topic),
  );

  /* Sentiment movement, which is a different axis from volume and the one actually asked about.
     Only topics with a real comparison point qualify — `sentimentDelta` is null otherwise, and
     ranking against a comparison that does not exist is the `▲ +0` defect again. */
  const moved = changes.filter(
    (c) => c.sentimentDelta !== null && Math.abs(c.sentimentDelta) >= SENTIMENT_MOVE_THRESHOLD,
  );
  const byWeightedMove = (a: TopicChange, b: TopicChange): number =>
    Math.abs(b.sentimentDelta!) * b.volume - Math.abs(a.sentimentDelta!) * a.volume ||
    a.topic.localeCompare(b.topic);

  const improving = moved.filter((c) => c.sentimentDelta! > 0).sort(byWeightedMove);
  const worsening = moved.filter((c) => c.sentimentDelta! < 0).sort(byWeightedMove);

  const sentiment = mean(current.map((i) => i.score));
  const previousSentiment = mean(previous.map((i) => i.score));

  return {
    basis,
    from: windowStart.toISOString(),
    to: asOf.toISOString(),
    signalsThisPeriod: current.length,
    signalsPreviousPeriod: previous.length,
    backfilledThisPeriod: current.filter(isBackfilled).length,
    sentiment,
    previousSentiment,
    sentimentDelta:
      sentiment === null || previousSentiment === null ? null : sentiment - previousSentiment,
    newTopics,
    risingTopics: rising,
    fallingTopics: falling,
    improvingTopics: improving,
    worseningTopics: worsening,
    bySource: summariseSources(current, previous),
  };
}

/**
 * Collected well after it was published — a backfill rather than new conversation.
 *
 * Matters because connecting a feed imports its whole history at once. Counting that as a week's
 * activity would show a spike that nothing in the world actually did.
 */
export function isBackfilled(item: ChangeItem): boolean {
  const lagDays = (item.ingestedAt.getTime() - item.publishedAt.getTime()) / MS_PER_DAY;
  return lagDays > BACKFILL_THRESHOLD_DAYS;
}

/**
 * The same movement, per source.
 *
 * Sources present in EITHER period appear, so a feed that stopped producing shows as a drop to
 * zero rather than disappearing from the table. A silent feed and a healthy one look identical
 * when only the current period is listed, and telling them apart is the entire point of the
 * breakdown.
 */
export function summariseSources(
  current: readonly ChangeItem[],
  previous: readonly ChangeItem[],
): SourceChange[] {
  const keys = new Set([...current.map((i) => i.source), ...previous.map((i) => i.source)]);

  return [...keys]
    .map((source) => {
      const now = current.filter((i) => i.source === source);
      const then = previous.filter((i) => i.source === source);
      const sentiment = mean(now.map((i) => i.score));
      const previousSentiment = mean(then.map((i) => i.score));
      return {
        source,
        volume: now.length,
        previousVolume: then.length,
        sentiment,
        previousSentiment,
        sentimentDelta:
          sentiment === null || previousSentiment === null ? null : sentiment - previousSentiment,
      };
    })
    .sort((a, b) => b.volume - a.volume || a.source.localeCompare(b.source));
}
