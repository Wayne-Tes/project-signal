/**
 * The help corpus — types.
 *
 * WHY TYPED OBJECTS RATHER THAN MARKDOWN FILES. The corpus has two consumers with opposite
 * needs: the web help centre renders it in a browser, and the API's assistant searches it in
 * Node. A directory of `.md` files would need a loader in each — a bundler plugin on one side,
 * a filesystem read on the other — and the two would drift, with the assistant answering from
 * a file the UI does not show. Typed objects are one module both import, and the compiler
 * checks every cross-reference.
 *
 * The article BODY is still markdown, because prose wants to be prose.
 */

/** Where an article sits in the help centre. Order is presentation order. */
export type HelpCategory = 'getting-started' | 'understanding-scores' | 'managing-data' | 'reporting' | 'administration';

export interface HelpArticle {
  /** URL-safe, stable. Changing one breaks every deep link and every citation. */
  slug: string;
  title: string;
  category: HelpCategory;
  /** One sentence. Shown in search results and used by the assistant to decide relevance. */
  summary: string;
  /**
   * Search terms a user would actually type that the prose does not contain.
   *
   * Not a duplicate of the title: these exist so "why is my dashboard empty" finds the article
   * that explains scoring latency without the phrase appearing in it.
   */
  keywords: string[];
  /** Markdown. Headings start at `##` — the article title supplies the `#`. */
  body: string;
  /** Slugs of related articles. Validated at test time, so a typo cannot ship. */
  related?: string[];
  /**
   * The view this article documents, if any.
   *
   * Drives contextual help: the help button on a view opens its article rather than the index.
   * Must match a `ViewId` in apps/web/src/config/navigation.ts.
   */
  view?: string;
}

export interface HelpCategoryMeta {
  id: HelpCategory;
  title: string;
  description: string;
}

/** One step of the first-run tour. */
export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * CSS selector for the element to highlight, or `null` for a centred step.
   *
   * A selector that matches nothing must degrade to a centred step rather than pointing at the
   * top-left corner — a tour that highlights empty space is worse than one that does not
   * highlight at all.
   */
  anchor: string | null;
  /** Article to open from this step's "Learn more" link. */
  article?: string;
}
