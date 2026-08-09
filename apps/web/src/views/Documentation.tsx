'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  getArticle,
  searchHelp,
  type HelpArticle,
} from '@project-signal/help-content';
import { Card, EmptyState, Input, PageHeader } from '@/design-system';
import { Markdown } from '@/features/help/Markdown';

/**
 * Documentation — the help corpus as a page you go to, rather than a panel you summon.
 *
 * The slide-over remains, and is still the right shape for "what is this number?" asked while
 * looking at the number. This is the other half: a contents list beside the article, so the
 * corpus can be read through rather than dipped into, and so a link to a specific article is
 * somewhere a person can actually be sent.
 *
 * Same corpus, same components, one source. A second copy of the content styled differently is
 * how a help centre and its documentation start disagreeing.
 */
export function DocumentationView() {
  const [query, setQuery] = useState('');
  const [slug, setSlug] = useState<string>(HELP_ARTICLES[0]?.slug ?? '');

  const results = useMemo(() => (query.trim() ? searchHelp(query, 12) : []), [query]);
  const article: HelpArticle | undefined = getArticle(slug);
  const searching = query.trim().length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="How Project Signal works"
        subtitle="What every number means, how it is produced, and how to configure the things that feed it."
      />

      <div className="ds-docs">
        <nav className="ds-docs__nav" aria-label="Documentation contents">
          <div className="ds-docs__search">
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            <Input
              type="search"
              placeholder="Search the documentation"
              aria-label="Search the documentation"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {searching ? (
            results.length > 0 ? (
              <ul className="ds-docs__list">
                {results.map(({ article: a }) => (
                  <li key={a.slug}>
                    <button
                      type="button"
                      className={`ds-docs__link${a.slug === slug ? ' ds-docs__link--active' : ''}`}
                      onClick={() => setSlug(a.slug)}
                    >
                      {a.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              /* Names the way out rather than only reporting failure. The assistant can answer
                 what the corpus does not cover, and this is the moment that matters. */
              <p className="ds-docs__empty">
                Nothing matches “{query.trim()}”. Try fewer words, or ask the assistant — it can
                answer questions about your own data.
              </p>
            )
          ) : (
            HELP_CATEGORIES.map((cat) => (
              <section key={cat.id}>
                <h2 className="ds-docs__category">{cat.title}</h2>
                <ul className="ds-docs__list">
                  {HELP_ARTICLES.filter((a) => a.category === cat.id).map((a) => (
                    <li key={a.slug}>
                      <button
                        type="button"
                        className={`ds-docs__link${a.slug === slug ? ' ds-docs__link--active' : ''}`}
                        onClick={() => setSlug(a.slug)}
                      >
                        {a.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>

        <Card className="ds-docs__article">
          {article ? (
            <article>
              <h2 className="ds-docs__title">{article.title}</h2>
              <p className="ds-docs__summary">{article.summary}</p>
              <Markdown onNavigate={(href) => setSlug(href.replace('/help/', ''))}>
                {article.body}
              </Markdown>

              {article.related && article.related.length > 0 && (
                <nav className="ds-docs__related" aria-label="Related articles">
                  <span className="ds-eyebrow">Related</span>
                  {article.related.map((s) => {
                    const rel = getArticle(s);
                    return rel ? (
                      <button
                        type="button"
                        key={s}
                        className="ds-docs__related-item"
                        onClick={() => setSlug(s)}
                      >
                        {rel.title}
                      </button>
                    ) : null;
                  })}
                </nav>
              )}
            </article>
          ) : (
            <EmptyState
              icon={<BookOpen size={22} strokeWidth={1.8} />}
              title="Pick an article"
              body="Choose something from the contents, or search."
            />
          )}
        </Card>
      </div>
    </>
  );
}
