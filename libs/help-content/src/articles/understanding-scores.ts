import type { HelpArticle } from '../types';

/**
 * How the numbers are produced.
 *
 * Every formula and constant in this file is taken from `libs/scoring/src/` — the half-life,
 * the weighting, the 0–100 mapping and the damage construction. If the scoring library changes,
 * these articles are wrong and the assistant will confidently repeat them, so they are covered
 * by a test that pins the constants they quote.
 */
export const UNDERSTANDING_SCORES: HelpArticle[] = [
  {
    slug: 'understanding-the-index',
    title: 'Understanding the Brand Perception Index',
    category: 'understanding-scores',
    summary:
      'The 0–100 headline number: what it measures, how it is calculated, and what a given value actually means.',
    keywords: ['bpi', 'index', 'score', 'number', 'headline', 'overall', 'how is it calculated'],
    view: 'dashboard',
    related: ['the-five-dimensions', 'how-recency-works', 'why-is-my-dashboard-empty'],
    body: `
The **Brand Perception Index** is a single 0–100 number summarising how positively people are
currently talking about your brand.

## How a signal becomes a number

Each signal is scored by a model on a scale from **−1** (most negative) to **+1** (most positive).
That is mapped onto the 0–100 index:

    index = ((sentiment + 1) / 2) × 100

So **50 is genuinely neutral**, not a pass mark. 0 would mean uniformly, maximally negative — a
value you should never expect to see in practice.

## How signals are combined

Signals are not averaged evenly. Each one is weighted by:

    weight = recency × confidence

- **Recency** — how recently it was published. See [How recency works](/help/how-recency-works).
- **Confidence** — how sure the model was about its own judgement. A signal the model found
  ambiguous counts for less than one it read clearly.

The index is then the weighted average across the five dimensions.

## What a value means

| Range | Reading |
| --- | --- |
| 70–100 | Strongly positive |
| 55–70 | Positive |
| 45–55 | Genuinely mixed or neutral |
| 30–45 | Negative |
| 0–30 | Strongly negative |

## What it deliberately is not

It is **not** a percentage, a satisfaction score, or a market share. It has no absolute meaning
outside this product — its value is in the direction it moves and in how it compares to the
competitors configured alongside it.

An **unscored** brand shows no index at all. That is distinct from a score of 0.
`.trim(),
  },

  {
    slug: 'the-five-dimensions',
    title: 'The five dimensions',
    category: 'understanding-scores',
    summary:
      'Trust, quality, service, value and experience — what each one covers and how they combine into the index.',
    keywords: ['dimensions', 'trust', 'quality', 'service', 'value', 'experience', 'breakdown', 'weights'],
    related: ['understanding-the-index', 'brand-impact-explained'],
    body: `
Every signal is tagged with the parts of your brand it touches. There are five, fixed:

| Dimension | What it covers |
| --- | --- |
| **Trust** | Honesty, reliability, whether people believe what you say |
| **Quality** | Whether the product or service is any good |
| **Service** | How people are treated — support, responsiveness, resolution |
| **Value** | Whether it is felt to be worth the money |
| **Experience** | What using it actually feels like, end to end |

A signal can touch several dimensions, or none — a piece of pure brand-awareness coverage may
carry sentiment without being about any of them.

## How they combine

Each dimension is scored independently as a weighted average of the signals tagged to it, using
the same recency × confidence weighting as the overall index. The five are then combined using
per-brand weights. **By default all five are weighted equally — 0.2 each.**

## Reading them

The dimension scores are usually more actionable than the headline number. An index of 58 made of
five scores around 58 is a very different brand from an index of 58 made of strong quality and
collapsing service — and only the second one tells you what to do on Monday.

A dimension with **no signals** shows as unscored rather than as zero. It means nobody has talked
about that aspect of your brand in the window, which is itself worth noticing.
`.trim(),
  },

  {
    slug: 'how-recency-works',
    title: 'How recency works — the 90-day half-life',
    category: 'understanding-scores',
    summary:
      'Older signals fade rather than dropping out. This explains the decay curve and why your score moves slowly.',
    keywords: [
      'recency',
      'decay',
      'half-life',
      'old data',
      'time',
      'window',
      'why is my score not moving',
      'slow',
      '90 days',
    ],
    related: ['understanding-the-index', 'trends-and-history'],
    body: `
Signals lose influence with age on an **exponential decay with a 90-day half-life**:

    weight = 2 ^ (−age in days / 90)

| Age of signal | Counts for |
| --- | --- |
| Today | 100% |
| 90 days | 50% |
| 180 days | 25% |
| 365 days | about 6% |

## Why a half-life and not a cut-off

A fixed window — "the last 90 days" — makes the score jump every time an influential signal ages
out of it, which produces movements that look like real change and are not. Fading means
influence declines smoothly and nothing ever disappears overnight.

## What this means in practice

**Your score is meant to move slowly.** A single bad week will move it a little; a bad quarter
will move it a lot. If you are looking for same-day reaction to an incident, look at the
individual signals in the drill-down rather than at the index.

**Old problems keep costing you until they are outweighed.** Fixing something does not delete the
signals about it — it lets newer, better signals gradually outweigh them. Expect the index to
recover over weeks, not days.
`.trim(),
  },

  {
    slug: 'brand-impact-explained',
    title: 'Brand impact — what is hurting you most',
    category: 'understanding-scores',
    summary:
      'How subjects are ranked by damage, what the damage score is made of, and how to use the view.',
    keywords: [
      'brand impact',
      'damage',
      'clusters',
      'topics',
      'what is hurting',
      'worst',
      'priorities',
      'achilles',
    ],
    view: 'brand-impact',
    related: ['the-five-dimensions', 'action-roadmap-explained'],
    body: `
**Brand impact** answers "what should I fix first?" It groups signals by subject and ranks those
groups by how much damage each is doing.

## The damage score

For each subject:

    damage = volume × negativity × recency

- **Volume** — how many signals are about it. A single furious review is not a brand problem.
- **Negativity** — how negative those signals are on average, from 0 to 1.
- **Recency** — how recent they are on average, using the same decay as everything else.

All three have to be present to matter. A large, very negative cluster from eighteen months ago
scores low, correctly — it is history. A small, recent, mildly annoyed cluster also scores low.
What rises to the top is **a lot of people, unhappy, recently**.

The view shows the **top three** subjects.

## The mirror

The same construction with positivity instead of negativity gives you **strengths** — what is
working. It is built the same way deliberately, so "what is hurting" and "what is helping" are
directly comparable rather than one being a ranked list and the other an impression.

## Using it

Open a subject to see the dimensions it touches and the actual signals behind it. **Every ranking
in this product can be traced to the specific things people said** — if a cluster does not look
right when you read the underlying signals, trust the signals.
`.trim(),
  },

  {
    slug: 'trends-and-history',
    title: 'Reading trends and history',
    category: 'understanding-scores',
    summary: 'How to tell a real movement from noise, and what the volume bars are telling you.',
    keywords: ['trends', 'history', 'over time', 'chart', 'movement', 'change', 'volume'],
    view: 'trends',
    related: ['how-recency-works', 'understanding-the-index'],
    body: `
**Trends & history** plots the index and the dimension scores over time.

## Telling signal from noise

Because of the 90-day half-life, the index is heavily damped. That has a useful consequence:

- **A small wobble is noise.** Day-to-day movement of a point or two usually reflects which
  signals happened to arrive, not a change in how people feel.
- **A sustained direction is real.** Several weeks of consistent movement is a genuine shift, and
  by the time it is visible here it has usually been visible in Brand impact for a while.

## Volume matters as much as score

Always read the score against the volume of signals behind it. A score built from twelve signals
is a rumour; the same score from twelve hundred is a finding. A sudden volume spike with a stable
score usually means an event drew attention without changing opinion — which is worth knowing on
its own.

## Comparing dimensions

The most useful reading is usually **divergence**: dimensions that used to move together and have
stopped. Service falling while quality holds is a specific, actionable story in a way the
headline number never is.
`.trim(),
  },
];
