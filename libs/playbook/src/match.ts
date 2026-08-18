import type { Dimension } from '@project-signal/shared-types';
import { PLAYS } from './plays.js';
import type { Play } from './types.js';

/** The shape a cluster needs to be matched. Structural, so `TopicCluster` satisfies it directly. */
export interface MatchableCluster {
  topic: string;
  volume: number;
  sentiment: number;
  dimensions: Dimension[];
}

/**
 * How specific a play's criteria are.
 *
 * Ranking by specificity is what stops the generic plays winning every time. `close-the-territory-
 * gap` matches almost any cluster, and if plays were returned in declaration order it would be the
 * first suggestion for a subject that is plainly a pricing complaint. Counting the constraints a
 * play chose to impose is a fair proxy for how confidently it claims to apply.
 */
function specificity(play: Play): number {
  const m = play.match;
  return (
    /**
     * A topic-pattern hit is worth more than every other criterion COMBINED, and that is a
     * correction rather than a preference.
     *
     * It was originally 3, against 2 for dimensions — which let `correct-the-record`
     * (dimensions + sentiment + volume = 4) tie with `safeguarding-response`
     * (patterns + volume = 4) and win on the alphabetical tie-break. A safeguarding concern was
     * answered with "contact the publication about a factual error", which is the wrong advice
     * on the one subject where wrong advice is least affordable.
     *
     * The asymmetry is real: a pattern is a direct textual hit on what the complaint is ABOUT,
     * while a dimension is broad — there are five, and most clusters touch two of them. Weighting
     * them comparably treats a coincidence as evidence.
     */
    (m.topicPatterns?.length ? 5 : 0) +
    (m.dimensions?.length ? 2 : 0) +
    (m.maxSentiment !== undefined ? 1 : 0) +
    (m.minVolume !== undefined ? 1 : 0)
  );
}

function matches(play: Play, cluster: MatchableCluster): boolean {
  const m = play.match;
  const topic = cluster.topic.trim().toLowerCase();

  /* Any one pattern hitting is enough — a cluster tagged "app crashes" should match a play
     listening for "crash" without the play having to enumerate every phrasing. */
  if (m.topicPatterns?.length && !m.topicPatterns.some((p) => topic.includes(p.toLowerCase()))) {
    return false;
  }
  if (m.dimensions?.length && !m.dimensions.some((d) => cluster.dimensions.includes(d))) {
    return false;
  }
  if (m.maxSentiment !== undefined && cluster.sentiment > m.maxSentiment) return false;
  if (m.minVolume !== undefined && cluster.volume < m.minVolume) return false;
  return true;
}

/**
 * The plays that apply to one cluster, most specific first.
 *
 * RETURNS AN ARRAY, AND MAY RETURN AN EMPTY ONE. There is deliberately no fallback play for the
 * unmatched case: "no play applies" is a real and useful answer, and inventing generic advice to
 * fill the space is how a roadmap becomes wallpaper that nobody reads. The `watch-only` play
 * exists for subjects that genuinely warrant no action, which is a different statement from
 * having nothing to say.
 */
export function playsFor(cluster: MatchableCluster, plays: readonly Play[] = PLAYS): Play[] {
  return plays
    .filter((p) => matches(p, cluster))
    .slice()
    .sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id));
}

/** One play, or null. What the roadmap shows as the recommended next step. */
export function bestPlayFor(cluster: MatchableCluster, plays: readonly Play[] = PLAYS): Play | null {
  return playsFor(cluster, plays)[0] ?? null;
}

export function playById(id: string, plays: readonly Play[] = PLAYS): Play | null {
  return plays.find((p) => p.id === id) ?? null;
}
