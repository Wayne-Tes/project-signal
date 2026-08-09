import { GETTING_STARTED } from './articles/getting-started';
import { MANAGING_DATA } from './articles/managing-data';
import { REPORTING_ADMIN } from './articles/reporting-admin';
import { UNDERSTANDING_SCORES } from './articles/understanding-scores';
import type { HelpArticle, HelpCategory, HelpCategoryMeta, TourStep } from './types';

export type { HelpArticle, HelpCategory, HelpCategoryMeta, TourStep } from './types';

/** Presentation order of the help centre. */
export const HELP_CATEGORIES: readonly HelpCategoryMeta[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'What the product does and how to find your way around it.',
  },
  {
    id: 'understanding-scores',
    title: 'Understanding the scores',
    description: 'What the numbers mean and how they are produced.',
  },
  {
    id: 'managing-data',
    title: 'Managing data',
    description: 'Sources, name aliases and competitors.',
  },
  { id: 'reporting', title: 'Reporting', description: 'Reports and the action roadmap.' },
  {
    id: 'administration',
    title: 'Administration',
    description: 'Users, roles and how tenants are kept apart.',
  },
] as const;

export const HELP_ARTICLES: readonly HelpArticle[] = [
  ...GETTING_STARTED,
  ...UNDERSTANDING_SCORES,
  ...MANAGING_DATA,
  ...REPORTING_ADMIN,
];

/** Slug → article. Built once; the corpus is static. */
const BY_SLUG = new Map(HELP_ARTICLES.map((a) => [a.slug, a]));

export function getArticle(slug: string): HelpArticle | undefined {
  return BY_SLUG.get(slug);
}

export function articlesInCategory(category: HelpCategory): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}

/** The article documenting a given view, for contextual help. */
export function articleForView(view: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.view === view);
}

export interface HelpSearchHit {
  article: HelpArticle;
  /** Higher is better. Only meaningful for ordering within one result set. */
  score: number;
}

/**
 * Searches the corpus.
 *
 * DELIBERATELY NOT A VECTOR SEARCH. The corpus is a few dozen short articles that ship with the
 * code; an embedding index would add a build step, a storage decision and a staleness problem to
 * a search over roughly twenty thousand words. Weighted field matching is worse at paraphrase
 * and better at everything else here — it is instant, needs no infrastructure, and is
 * debuggable, which matters because the assistant's answers are only as good as what this
 * returns.
 *
 * Fields are weighted by how strong a signal a match in them is: a term in the title is a much
 * better indication than the same term buried in prose. `keywords` exists precisely to catch the
 * phrases a user types that the article never says — "nothing showing" finding the article about
 * scoring latency.
 */
export function searchHelp(query: string, limit = 5): HelpSearchHit[] {
  const terms = tokenise(query);
  if (terms.length === 0) return [];

  const hits: HelpSearchHit[] = [];

  for (const article of HELP_ARTICLES) {
    const title = article.title.toLowerCase();
    const summary = article.summary.toLowerCase();
    const body = article.body.toLowerCase();
    const keywords = article.keywords.map((k) => k.toLowerCase());

    let score = 0;
    let matched = 0;

    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += 10;
      if (keywords.some((k) => k.includes(term))) termScore += 8;
      if (summary.includes(term)) termScore += 4;
      if (body.includes(term)) termScore += 1;
      if (termScore > 0) matched += 1;
      score += termScore;
    }

    /* An article matching every term beats one matching a single term many times. Without this,
       a long article that happens to repeat one common word outranks the precise answer. */
    if (matched === 0) continue;

    /* RELEVANCE FLOOR. On a specific, multi-word query, matching one word out of several is
       coincidence rather than relevance — "kubernetes helm chart" matched the trends article on
       the word "chart" alone. Returning that is worse than returning nothing, because the
       assistant will cite whatever it is handed and a weak hit becomes a confident wrong answer
       with a source attached. Short queries are exempt: with one or two words there is no
       majority to require. */
    if (terms.length >= 3 && matched / terms.length < 0.5) continue;

    score *= 1 + (matched - 1) * 0.5;

    /* An exact phrase match is a much stronger signal than the same words scattered. */
    const phrase = query.trim().toLowerCase();
    if (phrase.length > 3 && (title.includes(phrase) || summary.includes(phrase))) score += 15;

    hits.push({ article, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.article.slug.localeCompare(b.article.slug)).slice(0, limit);
}

/**
 * Words worth matching on.
 *
 * Stop words are dropped because they match nearly every article and would flatten the ranking —
 * "how does the index work" should not be dominated by "how", "does" and "the". Single
 * characters go too; they match everything and mean nothing.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from',
  'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'not', 'of', 'on', 'or',
  'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'up', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you',
  'your',
]);

function tokenise(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * The first-run tour.
 *
 * Six steps. The limit is deliberate: a tour long enough to explain everything is a tour nobody
 * finishes, and the things it skips are exactly what the help centre and the assistant are for.
 * Each step earns its place by pointing at something a new user would otherwise not find —
 * particularly the drill-down, which is the product's actual differentiator and is behind a
 * button most people never press.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Project Signal',
    body: 'This takes about a minute. It shows you where the important things are — you can leave at any point and restart it from the help menu.',
    anchor: null,
    article: 'what-is-project-signal',
  },
  {
    id: 'score',
    title: 'Your Brand Perception Index',
    body: 'One 0–100 number for how positively people are currently talking about you. 50 is genuinely neutral, not a pass mark.',
    anchor: '[data-tour="hero"]',
    article: 'understanding-the-index',
  },
  {
    id: 'dimensions',
    title: 'The five dimensions',
    body: 'Trust, quality, service, value and experience. These are usually more useful than the headline number — they tell you which part of the brand is moving.',
    anchor: '[data-tour="dimensions"]',
    article: 'the-five-dimensions',
  },
  {
    id: 'drill',
    title: 'Trace any number to its evidence',
    body: 'Dig into score opens the drill-down: index, then dimension, then subject, then the individual things people actually said. Nothing here is a black box.',
    anchor: '[data-tour="drill"]',
    article: 'brand-impact-explained',
  },
  {
    id: 'assistant',
    title: 'Ask the assistant',
    body: 'Ask a question about your data in plain language. It answers with citations you can open, and it cannot change anything.',
    anchor: '[data-tour="assistant"]',
    article: 'using-the-assistant',
  },
  {
    id: 'help',
    title: 'Help is always here',
    body: 'The help centre explains every number in the product. Each view also has its own article, one click away.',
    anchor: '[data-tour="help"]',
    article: 'finding-your-way-around',
  },
] as const;
