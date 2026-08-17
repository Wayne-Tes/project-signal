import type { Dimension } from '@project-signal/shared-types';

/**
 * The playbook: curated interventions, matched to evidence rather than generated from it.
 *
 * ## Why a library and not an LLM prompt
 *
 * The obvious build is to hand a cluster to a model and ask for advice. It was rejected, for four
 * reasons that matter more than the convenience:
 *
 *   1. **It cannot hallucinate a case study.** A model asked for "what others did about this" will
 *      produce a company, a percentage and a date, all fluent and none checkable. This repository
 *      has already shipped two model ids and a fictional bank's roadmap written that way.
 *   2. **It is auditable.** A play arrives through a pull request, so the human review that lets it
 *      in is the same review that checks its citation. There is no path by which uncited advice
 *      reaches a client.
 *   3. **It is stable.** The same problem gets the same play, which is the only way to ever ask
 *      "does this play work?". Bespoke prose per action is unfalsifiable by construction — no two
 *      recommendations are the same recommendation, so nothing can be measured across them.
 *   4. **It improves.** Plays accumulate outcomes from `tracked_actions`, so the library gets
 *      better from use rather than from re-prompting.
 *
 * A model still has a job — adapting a matched play to the specific wording and evidence of one
 * cluster. It selects and phrases; it does not invent the intervention.
 *
 * ## Evidence is a status, not a decoration
 *
 * `evidenceStatus` is mandatory and honest. Most plays ship as `none`: the mechanism is sound and
 * generally practised, but nobody has yet attached a verifiable source. That is stated in the UI
 * rather than papered over, because a play claiming evidence it does not have is worse than one
 * admitting it has none — the first is a lie a client can catch.
 *
 * `internal` is the status this product can genuinely earn: once `tracked_actions` shows a play
 * used several times with a measured capture rate, the evidence is ours, specific to this brand,
 * and impossible to dispute. That is the strongest form available here and it compounds.
 */
export type EvidenceStatus =
  /** Mechanism only. No verifiable external source has been attached yet. */
  | 'none'
  /** Backed by this tenant's own measured outcomes in `tracked_actions`. */
  | 'internal'
  /** A published, checkable source is attached below. */
  | 'external';

export interface Citation {
  /** What it is, in a phrase. */
  title: string;
  /** A URL a reader can open. Required — a citation nobody can check is not a citation. */
  url: string;
  /** Publisher or author, so the reader can weigh it. */
  source: string;
  /** ISO date the source was published, where it is known. */
  published?: string;
  /**
   * Why this is being cited, in one sentence.
   *
   * Forces the person adding it to state the connection, which is where a weak citation shows
   * itself — "vendor blog asserting their own product helps" reads very differently from
   * "regulator publication with the underlying figures".
   */
  relevance: string;
}

/** When a play applies. All present criteria must match; an absent criterion is not a constraint. */
export interface PlayMatch {
  /** Substrings matched against the cluster topic, lower-cased. Any one hit is enough. */
  topicPatterns?: string[];
  /** The play only applies to clusters touching one of these dimensions. */
  dimensions?: Dimension[];
  /** Only when the cluster's mean sentiment is at or below this. */
  maxSentiment?: number;
  /** Only when at least this many signals carry the topic — some plays need a real pattern. */
  minVolume?: number;
}

export interface Play {
  /** Stable across edits. Referenced by `tracked_actions`, so renaming one orphans its history. */
  id: string;
  title: string;
  /** One sentence a channel manager can read without decoding. */
  summary: string;
  match: PlayMatch;
  /**
   * What to actually do, in order. Concrete enough to assign.
   *
   * The test applied to every step: could a marketing manager put this in a meeting invitation
   * tomorrow? "Improve customer sentiment" fails it. "Reply to every review below 3 stars within
   * 48 hours, naming the specific issue" passes.
   */
  steps: string[];
  /**
   * How you will know it worked — in metrics THIS product actually holds.
   *
   * Not a generic KPI. A measure the roadmap cannot compute is a measure nobody will check.
   */
  measure: string;
  /** Suggested function to own it. A routing hint, not an org chart the product does not have. */
  owner: 'support' | 'product' | 'content' | 'pricing' | 'comms' | 'engineering';
  /** Rough shape of the commitment. Never a promise about when the index moves. */
  horizon: 'now' | 'this quarter' | 'watch';
  evidenceStatus: EvidenceStatus;
  /** Empty unless `evidenceStatus` is `external`. Enforced by a test. */
  evidence: Citation[];
}
