import { ARR_BAND_WEIGHT, type ArrBand } from '@project-signal/shared-types';

/**
 * Ranking what customers say by what it puts at risk, rather than by how often it is said.
 *
 * ## Why the rest of the product's ranking is wrong for this channel
 *
 * Every other view ranks by volume — `damage = volume × negativity × recency` — and for public
 * signals that is right: a hundred people saying the same thing IS the finding.
 *
 * The CRM channel inverts it. One renewal-risk note from a 250k+ account is not one-fiftieth of
 * fifty app-store reviews, and volume ranking would bury it under a subject that fifty small
 * accounts mentioned in passing. Worse, CRM volume is a function of how diligently each CSM writes
 * notes, so ranking by it partly ranks the note-taking habits of the account team.
 *
 * So exposure is `distinct accounts × their band weights`. Distinct accounts, because ten notes
 * about one unhappy customer is one unhappy customer — and a chatty CSM would otherwise outrank a
 * quiet one covering a bigger book.
 */

export interface ExposureItem {
  topic: string;
  accountId: string | null;
  arrBand: ArrBand | null;
  /** Model sentiment, −1 … 1. */
  score: number;
}

export interface ExposureRank {
  topic: string;
  /** Distinct accounts raising it. The headline number for this channel. */
  accounts: number;
  /** Interactions. Reported for context; deliberately not what ranks. */
  mentions: number;
  /** Summed band weights of the affected accounts. */
  exposure: number;
  /** Mean sentiment across the interactions. */
  sentiment: number;
  /** Highest band among the affected accounts, so a single large account is visible. */
  topBand: ArrBand | null;
}

/**
 * An unbanded account still counts as an account.
 *
 * Weighting it zero would make a theme raised only by accounts nobody has banded disappear
 * entirely — and "we have not filled in the CRM field" is not a reason to hide what a customer
 * said. One is the floor, so it ranks below any banded account but above nothing.
 */
const UNBANDED_WEIGHT = 1;

export function rankByExposure(items: readonly ExposureItem[]): ExposureRank[] {
  interface Bucket {
    accounts: Map<string, ArrBand | null>;
    scores: number[];
    mentions: number;
  }
  const byTopic = new Map<string, Bucket>();

  for (const item of items) {
    const topic = item.topic.trim().toLowerCase();
    if (!topic) continue;
    /* Annotated rather than inferred: the fallback literal is not contextually typed by the Map's
       value type, so `scores` infers as `never[]` and the push below fails to compile. */
    const bucket: Bucket = byTopic.get(topic) ?? {
      accounts: new Map<string, ArrBand | null>(),
      scores: [],
      mentions: 0,
    };
    bucket.mentions += 1;
    bucket.scores.push(item.score);
    /* Keyed by account so ten notes about one customer count once. A null account — a CRM
       interaction not yet matched to a record — is keyed by nothing and contributes mentions
       without inflating the account count, which is the honest treatment: we know somebody said
       it, we do not know who. */
    if (item.accountId) bucket.accounts.set(item.accountId, item.arrBand);
    byTopic.set(topic, bucket);
  }

  const ranked: ExposureRank[] = [];
  for (const [topic, bucket] of byTopic) {
    const bands = [...bucket.accounts.values()];
    const exposure = bands.reduce(
      (sum, band) => sum + (band ? ARR_BAND_WEIGHT[band] : UNBANDED_WEIGHT),
      0,
    );
    const topBand = bands
      .filter((b): b is ArrBand => b !== null)
      .sort((a, b) => ARR_BAND_WEIGHT[b] - ARR_BAND_WEIGHT[a])[0];

    ranked.push({
      topic,
      accounts: bucket.accounts.size,
      mentions: bucket.mentions,
      exposure,
      sentiment: bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length,
      topBand: topBand ?? null,
    });
  }

  /* Most exposed first; ties broken by how negative it is, so two subjects putting the same
     revenue at risk are ordered by which is going worse. */
  return ranked.sort((a, b) => b.exposure - a.exposure || a.sentiment - b.sentiment);
}

export interface Corroborated {
  topic: string;
  /** Distinct accounts raising it privately. */
  accounts: number;
  /** Public signals carrying it. */
  publicVolume: number;
  publicSentiment: number;
  reportedSentiment: number;
}

/**
 * Subjects raised BOTH publicly and privately.
 *
 * **The one finding neither channel can produce alone**, and the reason for connecting a CRM at
 * all. A complaint that appears independently in public reviews and in what customers tell their
 * account manager is corroborated by two populations who did not speak to each other — which is
 * as close to proof as this product gets, and the thing a channel manager can take into a meeting
 * and be believed about.
 *
 * Matching is on the normalised topic tag, which is the same key the clusterer emits on both
 * sides. That is a real limitation: the scorer might tag the same underlying complaint `pricing`
 * publicly and `cost` privately, and this would miss it. Fuzzy matching was considered and
 * rejected — a false corroboration is far more damaging than a missed one, because its whole
 * value is the claim that two independent sources agree.
 */
export function corroborate(
  publicItems: readonly { topic: string; score: number }[],
  reportedItems: readonly ExposureItem[],
): Corroborated[] {
  const pub = new Map<string, number[]>();
  for (const item of publicItems) {
    const topic = item.topic.trim().toLowerCase();
    if (!topic) continue;
    pub.set(topic, [...(pub.get(topic) ?? []), item.score]);
  }

  const out: Corroborated[] = [];
  for (const rank of rankByExposure(reportedItems)) {
    const scores = pub.get(rank.topic);
    if (!scores?.length) continue;
    out.push({
      topic: rank.topic,
      accounts: rank.accounts,
      publicVolume: scores.length,
      publicSentiment: scores.reduce((a, b) => a + b, 0) / scores.length,
      reportedSentiment: rank.sentiment,
    });
  }

  /* Most publicly visible first — corroboration matters most where the public evidence is
     already loud enough for somebody outside the company to notice. */
  return out.sort((a, b) => b.publicVolume - a.publicVolume);
}
