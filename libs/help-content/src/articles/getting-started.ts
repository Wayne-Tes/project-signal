import type { HelpArticle } from '../types.js';

/**
 * Getting started.
 *
 * Written for someone who has just been given a login and does not yet know what the product
 * measures or why their dashboard is empty. That second question is the single most likely
 * first experience — a new brand has no scored signals — so it gets its own article rather than
 * a footnote, and the empty state links straight to it.
 */
export const GETTING_STARTED: HelpArticle[] = [
  {
    slug: 'what-is-project-signal',
    title: 'What Project Signal does',
    category: 'getting-started',
    summary:
      'Project Signal reads what people publicly say about your brand, scores it, and turns it into one tracked number with the reasons behind it.',
    keywords: ['overview', 'introduction', 'what is this', 'purpose', 'brand intelligence'],
    related: ['understanding-the-index', 'why-is-my-dashboard-empty'],
    body: `
Project Signal watches what people publicly say about your brand and turns it into something you
can track week to week.

## The short version

1. **It collects signals.** A *signal* is one public thing somebody published about you — a review,
   a news article, a video, a post.
2. **It scores each one.** A language model reads the signal and judges how positive or negative
   it is, how confident it is in that judgement, which parts of your brand it touches, and what
   it is about.
3. **It rolls them up.** Those individual judgements become the **Brand Perception Index** — a
   single 0–100 number — plus five dimension scores underneath it.
4. **It tells you why.** Signals about the same subject are grouped, so instead of "your score
   fell four points" you get "delivery delays, 62 mentions, mostly negative, mostly recent".

## What it is not

It is not a social listening firehose, and it does not show you every mention as it happens. It
is deliberately a **slow instrument**: signals fade in influence over 90 days rather than
dropping out, so the number moves when perception genuinely moves, not when one loud week
happens.

It also only sees **public** sources. It has no access to your support tickets, your CRM, or
anything behind a login.

## Where to go next

- [Understanding the Brand Perception Index](/help/understanding-the-index) — what the number
  actually means
- [Why is my dashboard empty?](/help/why-is-my-dashboard-empty) — if you are looking at a blank
  score right now
`.trim(),
  },

  {
    slug: 'why-is-my-dashboard-empty',
    title: 'Why is my dashboard empty?',
    category: 'getting-started',
    summary:
      'A new brand has no score until signals have been collected and scored. This explains what has to happen first, and roughly how long it takes.',
    keywords: [
      'empty',
      'no data',
      'blank',
      'no score',
      'nothing showing',
      'not working',
      'zero',
      'missing',
      'unscored',
    ],
    related: ['adding-a-source', 'what-is-project-signal'],
    body: `
An empty dashboard is almost always a brand that has nothing to score yet, rather than a fault.

## What has to happen before a score appears

1. **A source has to be configured.** Project Signal does not guess where to look. Someone with
   an admin role adds at least one source for the brand — see
   [Adding a data source](/help/adding-a-source).
2. **A collection run has to find something.** Sources are polled on a schedule, not on demand.
3. **The signals have to be scored.** Each one is read by a model. This happens in a queue,
   shortly after collection.
4. **A rollup has to run.** Dimension scores and the overall index are calculated from the scored
   signals.

Until step 4 has completed at least once, the dashboard will tell you the brand has no Brand
Perception Index yet. That message means "not scored", **not** "scored zero" — a score of 0 would
mean uniformly negative sentiment, which is a very different statement.

## If sources are configured and it is still empty

Check, in this order:

- **Is the source actually returning anything?** An RSS feed URL that 404s produces no signals and
  no error on your dashboard.
- **Do your brand's name aliases match how people write about you?** Signals are matched to a
  brand by name. If people write "TES" and your brand is recorded as "Tes Global", add the alias —
  see [Name aliases](/help/name-aliases).
- **Is the brand new?** The index weights recent signals most heavily, but it still needs a
  reasonable number of them before the number is worth reading.
`.trim(),
  },

  {
    slug: 'finding-your-way-around',
    title: 'Finding your way around',
    category: 'getting-started',
    summary: 'What each view in the sidebar is for, and when to use it.',
    keywords: ['navigation', 'sidebar', 'menu', 'views', 'where is', 'layout', 'tour'],
    related: ['what-is-project-signal', 'personalising-the-interface'],
    body: `
The sidebar groups views by what you are trying to do.

## Brand

- **Dashboard** — the current Brand Perception Index, the five dimensions beneath it, and the
  headline movements. Start here.
- **Trends & history** — the same numbers over time. Use this to answer "is this a blip or a
  direction?"

## Intelligence

- **Brand impact** — the subjects doing the most damage to your score right now, ranked. This is
  the "what do I fix first" view.
- **Action roadmap** — suggested actions, prioritised by expected impact.
- **Competitors** — your index against the competitor brands configured for your tenant.

## Delivery

- **Weekly report** — a printable summary. Use **Download PDF** in the top bar.

## Manage

- **Admin** — brands, sources, name aliases and users. Only visible to admins and owners.

## Everywhere

- **Dig into score** (top right) opens the drill-down: index → dimension → subject → the
  individual signals. Every number in this product can be traced to the specific things people
  said, and that path is how you get there.
- The **assistant** is available from any view. Ask it a question about your data and it will
  answer with citations you can open.
`.trim(),
  },

  {
    slug: 'personalising-the-interface',
    title: 'Personalising the interface',
    category: 'getting-started',
    summary:
      'Theme, sidebar style, highlight colour, dashboard hero, typeface and animations — what each setting does and where it is stored.',
    keywords: [
      'theme',
      'dark mode',
      'light mode',
      'colour',
      'color',
      'appearance',
      'settings',
      'accessibility',
      'font',
      'animation',
    ],
    related: ['finding-your-way-around'],
    body: `
Open **Appearance** — the palette button in the top right — to change how the product looks.

| Setting | What it does |
| --- | --- |
| **Theme** | Light, Dark, or System. *System* follows your operating system and keeps following it. |
| **Sidebar** | Light or Navy, independently of the main theme. |
| **Highlight** | The accent colour used for active items, selections and focus rings. |
| **Dashboard hero** | Whether the dashboard leads with the radial gauge or with bars. |
| **Typeface** | The type pairing used throughout. |
| **Animations** | Turns entrance animations on or off. |

## Two things worth knowing

**Settings are stored in your browser**, not on your account. They follow the browser, not you —
a different machine starts from the defaults.

**Turning animations back on does not override your system's reduced-motion setting.** If you
have asked your operating system to reduce motion, that continues to be respected. A preference
should not be able to defeat an accessibility setting.
`.trim(),
  },
];
