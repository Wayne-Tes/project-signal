import type { Play } from './types.js';

/**
 * The seed playbook.
 *
 * ## Read this before adding a play
 *
 * **Every one of these ships with `evidenceStatus: 'none'`, and that is deliberate rather than
 * lazy.** The mechanisms are ordinary, widely-practised marketing and support operations; what
 * none of them has yet is a *verifiable source* attached by a human who read it.
 *
 * Writing plausible citations from memory was the alternative, and it is exactly the failure this
 * codebase keeps paying for: a retired model id, one that never existed, and a fictional bank's
 * roadmap with invented uplifts. A fabricated case study is worse than an absent one, because a
 * client can check it.
 *
 * So the honest sequence is: ship the mechanism, mark it unevidenced, and let evidence arrive two
 * ways —
 *
 *   - **external**, when somebody researches a real source, adds it with a URL and a relevance
 *     note, and a reviewer approves it in a pull request;
 *   - **internal**, which is the stronger form and the one this product earns on its own: once
 *     `tracked_actions` records a play used several times with a measured capture rate, the
 *     evidence is ours, about this brand, and impossible to dispute.
 *
 * A play is not worse for saying it is unevidenced. It is worse for pretending otherwise.
 *
 * ## The steps are the product
 *
 * Each step has to survive one test: could a marketing manager put it in a meeting invitation
 * tomorrow? "Improve customer sentiment" fails. "Reply to every review below three stars within 48
 * hours, naming the specific issue" passes. Anything failing that test is advice about advice.
 */
export const PLAYS: Play[] = [
  {
    id: 'respond-to-negative-reviews',
    title: 'Reply to every negative review, publicly and specifically',
    summary:
      'Unanswered complaints read as indifference to everyone who arrives later. A specific public reply changes what the next reader sees.',
    match: { dimensions: ['service', 'trust'], maxSentiment: -0.2, minVolume: 2 },
    steps: [
      'List every signal in this subject scoring below −0.4 and sort by date, newest first.',
      'Reply publicly to each within 48 hours, naming the specific problem rather than thanking them for feedback.',
      'Where the cause is fixed, say what changed and when — a dated fix is checkable, an apology is not.',
      'Assign one named owner for the platform; rotating responsibility is why response rates decay.',
    ],
    measure:
      'Service and Trust dimension scores, and the share of this subject’s signals scoring below −0.4 in the next 30 days.',
    owner: 'support',
    horizon: 'now',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'fix-then-announce',
    title: 'Fix the top recurring defect, then tell the people who reported it',
    summary:
      'A repeated technical complaint is one problem reported many times. Fixing it silently converts none of the existing negative coverage.',
    match: {
      topicPatterns: ['crash', 'bug', 'error', 'broken', 'not working', 'glitch', 'slow', 'loading'],
      maxSentiment: -0.1,
      minVolume: 2,
    },
    steps: [
      'Open this subject’s signals and group them by what actually broke — the topic tag is a label, not a diagnosis.',
      'Fix the single most-reported cause first, even if it is not the most severe.',
      'Reply to each original reporter naming the release that fixed it.',
      'Post the fix wherever the complaints were made, not only in a release note nobody reads.',
    ],
    measure:
      'Quality dimension score, and whether this subject appears in "Getting worse" in the next two periods.',
    owner: 'engineering',
    horizon: 'this quarter',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'close-the-territory-gap',
    title: 'Copy what your strongest territory is doing',
    summary:
      'A gap between two of your own markets is a real difference with a real cause, and somebody in the building already knows what it is.',
    /* THREE, not one. Verified against live data: every subject on the deployed brand had volume
       1, so this play — the least constrained one — won every match on an alphabetical tie-break
       and proposed a cross-market comparison project off a single complaint. That is the
       over-reaction `watch-only` exists to prevent, and it costs credibility for the next real
       finding. A territory gap is only a gap when there is a pattern on both sides. */
    match: { minVolume: 3 },
    steps: [
      'Compare this subject in your strongest territory against this one — the roadmap header names which is strongest.',
      'Ask that market’s team what they do differently on this subject specifically.',
      'Copy the one practice that is cheapest to replicate, not the most impressive.',
      'Re-measure after a full period before copying a second.',
    ],
    measure:
      'The gap between this territory’s index and your strongest territory’s, on the same date.',
    owner: 'comms',
    horizon: 'this quarter',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'ask-satisfied-customers',
    title: 'Ask satisfied customers to review, on the platform that is dragging',
    summary:
      'Review scores are dominated by the motivated minority. The index moves when the quiet majority is invited.',
    match: { maxSentiment: 0.1, minVolume: 3 },
    steps: [
      'Identify which source carries this subject’s worst sentiment — the "By source" table on What’s changed shows it.',
      'Ask for a review at a moment of demonstrated success, not on a schedule.',
      'Never script the wording or offer an incentive: platforms remove incentivised reviews, and the removal is worse than the absence.',
      'Point the request at the dragging platform specifically rather than a generic link.',
    ],
    measure:
      'Signal volume and mean sentiment for that source over the next two periods, on the What’s changed by-source table.',
    owner: 'content',
    horizon: 'this quarter',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'explain-the-price',
    title: 'Explain what the price includes, where the complaint is made',
    summary:
      'Most pricing complaints are value complaints. They are answered by making the comparison explicit, not by discounting.',
    match: {
      topicPatterns: ['pricing', 'price', 'cost', 'expensive', 'subscription', 'value for money', 'fee'],
      dimensions: ['value'],
      minVolume: 2,
    },
    steps: [
      'Read this subject’s signals and separate "too expensive" from "I did not know what I was paying for" — they need opposite responses.',
      'Publish what a tier includes at the point of purchase, not three clicks away.',
      'Where a cheaper competitor is named in the signals, address that comparison directly rather than ignoring it.',
      'Do not discount as the first move — it converts a value complaint into a price expectation.',
    ],
    measure: 'Value dimension score, and the share of this subject’s signals mentioning a competitor.',
    owner: 'pricing',
    horizon: 'this quarter',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'reduce-onboarding-friction',
    title: 'Cut the first-week friction the signals name',
    summary:
      'Onboarding complaints come from people who wanted it to work. They are the cheapest sentiment to recover.',
    match: {
      topicPatterns: ['onboarding', 'setup', 'getting started', 'training', 'first time', 'account', 'login', 'sign up'],
      dimensions: ['experience'],
      minVolume: 2,
    },
    steps: [
      'List the specific steps named in this subject’s signals — not the funnel you think exists.',
      'Remove or defer the single step named most often.',
      'Give first-week users one named contact rather than a help centre link.',
      'Re-read the signals after a period: the complaint usually moves to the next step rather than disappearing, and that is progress.',
    ],
    measure: 'Experience dimension score, and this subject’s volume in the next period.',
    owner: 'product',
    horizon: 'this quarter',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'correct-the-record',
    title: 'Correct a factual error at its source',
    summary:
      'An inaccurate article keeps being read and keeps being cited. Correcting the original beats publishing a rebuttal nobody finds.',
    match: { dimensions: ['trust'], maxSentiment: -0.3, minVolume: 1 },
    steps: [
      'Establish first whether the claim is actually wrong — a correction request on an accurate story costs more trust than the story did.',
      'Contact the publication directly with the specific correction and the evidence, not a general complaint.',
      'Publish your own account only after the correction is refused, and link the evidence.',
      'Do not mass-report or brigade: platforms treat it as manipulation and the response becomes the story.',
    ],
    measure: 'Trust dimension score, and whether this subject recurs in the next two periods.',
    owner: 'comms',
    horizon: 'now',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'publish-what-changed',
    title: 'Publish a dated changelog for the thing being complained about',
    summary:
      'Repeat complaints about a known issue usually mean nobody can tell whether it is being worked on.',
    match: { maxSentiment: -0.2, minVolume: 4 },
    steps: [
      'Publish a dated page for this subject saying what is known, what is being done, and when the next update lands.',
      'Update it on the date you promised even when there is no progress — a missed update is the thing that erodes trust, not slow progress.',
      'Link it from every reply about this subject.',
    ],
    measure:
      'Whether this subject’s volume falls while its sentiment rises — the signature of an answered concern rather than a suppressed one.',
    owner: 'comms',
    horizon: 'now',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'route-to-support-not-public',
    title: 'Give the complaint somewhere better to go',
    summary:
      'Public channels absorb complaints that a support queue would resolve, because the support route is harder to find than the review box.',
    match: { dimensions: ['service'], maxSentiment: -0.2, minVolume: 3 },
    steps: [
      'Check how many steps a user takes to reach support from where these signals were posted.',
      'Put a direct route in the profile, bio or listing of that platform.',
      'Reply publicly, then move the detail privately — and say publicly that it was resolved.',
    ],
    measure: 'Service dimension score, and this subject’s volume on that source specifically.',
    owner: 'support',
    horizon: 'now',
    evidenceStatus: 'none',
    evidence: [],
  },
  {
    id: 'watch-only',
    title: 'Watch this one — do not act yet',
    summary:
      'A subject with little volume and mild sentiment does not justify a workstream. Acting on noise costs credibility for the next real finding.',
    match: { minVolume: 1 },
    steps: [
      'Add nothing to the plan. Re-check on What’s changed next period.',
      'Act if volume roughly doubles or sentiment falls below −0.3.',
    ],
    measure: 'Volume and sentiment for this subject next period.',
    owner: 'comms',
    horizon: 'watch',
    evidenceStatus: 'none',
    evidence: [],
  },
];
