'use client';

import { getArticle, type HelpArticle } from '@project-signal/help-content';
import { safeInAppPath } from '@/lib/safe-url';
import { Markdown } from './Markdown';

/** `/help/<slug>` → `<slug>`, or undefined for anything that is not a help path. */
export function helpSlug(href: string | undefined): string | undefined {
  const path = safeInAppPath(href);
  return path?.startsWith('/help/') ? path.slice('/help/'.length) || undefined : undefined;
}

/**
 * One help article: title, summary, body and related links.
 *
 * Shared by the help-centre drawer and the Documentation page. Each held its own copy of this
 * markup, and the two had to be kept in step by hand — "same corpus, same components, one source"
 * was the stated intent, and the article itself was the part that was not.
 *
 * `variant` only selects the class prefix each surface is styled under.
 */
export function ArticleView({
  article,
  onOpen,
  variant,
}: {
  article: HelpArticle;
  onOpen: (slug: string) => void;
  variant: 'drawer' | 'page';
}) {
  const c =
    variant === 'drawer'
      ? {
          title: 'ds-drawer__article-title',
          summary: 'ds-drawer__article-summary',
          related: 'ds-help__related',
          item: 'ds-help__related-item',
        }
      : {
          title: 'ds-docs__title',
          summary: 'ds-docs__summary',
          related: 'ds-docs__related',
          item: 'ds-docs__related-item',
        };

  return (
    <article>
      <h2 className={c.title}>{article.title}</h2>
      <p className={c.summary}>{article.summary}</p>
      <Markdown
        onNavigate={(href) => {
          const slug = helpSlug(href);
          if (slug) onOpen(slug);
        }}
      >
        {article.body}
      </Markdown>

      {article.related && article.related.length > 0 && (
        <nav className={c.related} aria-label="Related articles">
          <span className="ds-eyebrow">Related</span>
          {article.related.map((s) => {
            const rel = getArticle(s);
            return rel ? (
              <button type="button" key={s} className={c.item} onClick={() => onOpen(s)}>
                {rel.title}
              </button>
            ) : null;
          })}
        </nav>
      )}
    </article>
  );
}
