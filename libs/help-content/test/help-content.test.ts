import { describe, expect, it } from 'vitest';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  TOUR_STEPS,
  articleForView,
  articlesInCategory,
  getArticle,
  searchHelp,
} from '../src/index.js';

/**
 * The corpus is CONTENT, so most of these tests are integrity checks rather than behaviour
 * checks. That is the right emphasis: the ways this breaks are a dead cross-reference, a
 * duplicate slug, or an article that quotes a scoring constant the code no longer uses — and
 * every one of those ships silently and is then repeated to a user by the assistant as fact.
 */

describe('corpus integrity', () => {
  it('has no duplicate slugs', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(slugs).toHaveLength(new Set(slugs).size);
  });

  it('gives every article a category that exists', () => {
    const ids = new Set(HELP_CATEGORIES.map((c) => c.id));
    for (const a of HELP_ARTICLES) expect(ids.has(a.category), `${a.slug}`).toBe(true);
  });

  it('resolves every `related` cross-reference', () => {
    for (const a of HELP_ARTICLES) {
      for (const slug of a.related ?? []) {
        expect(getArticle(slug), `${a.slug} → ${slug}`).toBeDefined();
      }
    }
  });

  it('resolves every in-body /help/ link', () => {
    /* A dead link in prose is invisible until a user clicks it, and the assistant will happily
       repeat one in an answer. */
    for (const a of HELP_ARTICLES) {
      for (const match of a.body.matchAll(/\]\(\/help\/([a-z0-9-]+)\)/g)) {
        const slug = match[1];
        if (!slug) continue;
        expect(getArticle(slug), `${a.slug} links to missing /help/${slug}`).toBeDefined();
      }
    }
  });

  it('never links an article to itself', () => {
    for (const a of HELP_ARTICLES) expect(a.related ?? []).not.toContain(a.slug);
  });

  it('gives every article a title, a one-sentence summary and keywords', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.title.length, a.slug).toBeGreaterThan(3);
      expect(a.summary.length, a.slug).toBeGreaterThan(20);
      expect(a.keywords.length, a.slug).toBeGreaterThan(2);
      expect(a.body.length, a.slug).toBeGreaterThan(200);
    }
  });

  it('starts article headings at ## so the title supplies the h1', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.body.split('\n').filter((l) => /^# /.test(l)), a.slug).toEqual([]);
    }
  });

  it('maps at most one article to each view', () => {
    /* articleForView returns the FIRST match, so two articles claiming one view means one of
       them is unreachable from that view's help button — silently. */
    const views = HELP_ARTICLES.map((a) => a.view).filter((v): v is string => Boolean(v));
    expect(views).toHaveLength(new Set(views).size);
  });

  it('populates every category', () => {
    for (const c of HELP_CATEGORIES) {
      expect(articlesInCategory(c.id).length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('scoring facts quoted by the corpus', () => {
  /**
   * These pin the numbers the articles state against the scoring library. If someone changes
   * the half-life or the default weights, the help centre starts lying and the assistant
   * repeats it with a citation, which is worse than saying nothing. Imported lazily so this lib
   * does not take a build-order dependency on @project-signal/scoring.
   */
  it('states the half-life the scoring library actually uses', async () => {
    const { HALF_LIFE_DAYS } = await import('@project-signal/scoring');
    const article = getArticle('how-recency-works');
    expect(article?.body).toContain(`${HALF_LIFE_DAYS}-day half-life`);
    expect(article?.body).toContain(`/ ${HALF_LIFE_DAYS})`);
  });

  it('names exactly the dimensions the scoring library defines', async () => {
    const { DIMENSIONS } = await import('@project-signal/scoring');
    const body = getArticle('the-five-dimensions')?.body.toLowerCase() ?? '';
    for (const d of DIMENSIONS) expect(body, d).toContain(d);
    expect(DIMENSIONS).toHaveLength(5);
  });

  it('states the default dimension weighting correctly', async () => {
    const { DEFAULT_DIMENSION_WEIGHTS } = await import('@project-signal/scoring');
    const weights = Object.values(DEFAULT_DIMENSION_WEIGHTS);
    expect(new Set(weights).size, 'article claims all five are weighted equally').toBe(1);
    expect(getArticle('the-five-dimensions')?.body).toContain(`${weights[0]} each`);
  });

  it('states the number of Brand impact subjects the view surfaces', async () => {
    const { BRAND_IMPACT_TOP_N } = await import('@project-signal/scoring');
    expect(BRAND_IMPACT_TOP_N).toBe(3);
    expect(getArticle('brand-impact-explained')?.body).toContain('top three');
  });
});

describe('searchHelp', () => {
  it('finds an article by its title', () => {
    expect(searchHelp('brand impact')[0]?.article.slug).toBe('brand-impact-explained');
  });

  it('finds an article by a keyword the prose never uses', () => {
    /* The whole reason `keywords` exists. Nothing in the empty-dashboard article says
       "nothing showing", which is exactly what a stuck user types. */
    const hit = searchHelp('nothing showing')[0];
    expect(hit?.article.slug).toBe('why-is-my-dashboard-empty');
  });

  it('answers the question a confused new user actually asks', () => {
    for (const q of ['no data', 'blank dashboard', 'why is my score missing']) {
      const slugs = searchHelp(q).map((h) => h.article.slug);
      expect(slugs, q).toContain('why-is-my-dashboard-empty');
    }
  });

  it('ranks an article matching every term above one matching a single term often', () => {
    const hits = searchHelp('half-life decay recency');
    expect(hits[0]?.article.slug).toBe('how-recency-works');
  });

  it('returns nothing for a query of only stop words', () => {
    /* Otherwise "how do I" returns the whole corpus ranked by length, and the assistant
       cheerfully cites the longest article as the answer to everything. */
    expect(searchHelp('how do I the a')).toEqual([]);
  });

  it('returns nothing for a query about something the product does not do', () => {
    expect(searchHelp('kubernetes ingress sidecar')).toEqual([]);
  });

  it('rejects a coincidental single-word match on a specific query', () => {
    /* REGRESSION. "kubernetes helm chart" returned the trends article, because it happens to
       carry the keyword "chart". One word out of three is coincidence, and handing a weak hit
       to the assistant turns it into a confident wrong answer with a citation attached — worse
       than returning nothing. Short queries stay exempt: with one or two words there is no
       majority to require. */
    expect(searchHelp('kubernetes helm chart')).toEqual([]);
    expect(searchHelp('chart').length).toBeGreaterThan(0);
  });

  it('respects the limit', () => {
    expect(searchHelp('brand', 2)).toHaveLength(2);
  });

  it('is stable for equal scores', () => {
    expect(searchHelp('brand', 3).map((h) => h.article.slug)).toEqual(
      searchHelp('brand', 3).map((h) => h.article.slug),
    );
  });
});

describe('articleForView', () => {
  it('finds the article documenting a view', () => {
    expect(articleForView('brand-impact')?.slug).toBe('brand-impact-explained');
    expect(articleForView('admin')?.slug).toBe('adding-a-source');
  });

  it('returns undefined for a view with no article', () => {
    expect(articleForView('no-such-view')).toBeUndefined();
  });
});

describe('the tour', () => {
  it('has unique step ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('points every "learn more" at an article that exists', () => {
    for (const s of TOUR_STEPS) {
      if (s.article) expect(getArticle(s.article), s.id).toBeDefined();
    }
  });

  it('gives every step something to say', () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.body.length, s.id).toBeGreaterThan(30);
    }
  });

  it('anchors steps to a selector or explicitly to nothing', () => {
    /* `null` means "centre this step". An empty string would look deliberate and would resolve
       to no element, silently pointing the spotlight at the top-left corner. */
    for (const s of TOUR_STEPS) {
      expect(s.anchor === null || s.anchor.length > 0, s.id).toBe(true);
    }
  });

  it('stays short enough to finish', () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(7);
  });
});
