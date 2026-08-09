'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Search, X } from 'lucide-react';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  articleForView,
  getArticle,
  searchHelp,
  type HelpArticle,
} from '@project-signal/help-content';
import { Button, Input } from '@/design-system';
import { Markdown } from './Markdown';

/**
 * The help centre.
 *
 * A slide-over panel rather than a route, deliberately: help is almost always needed *while*
 * looking at something, and navigating away to read it loses the thing that prompted the
 * question. Opening it from a view lands on that view's article — the same corpus, entered at
 * the point the user is actually stuck.
 *
 * The corpus is imported directly rather than fetched. It ships with the bundle, so help works
 * before the API answers, and — more usefully — it works when the API is the thing that is
 * broken, which is exactly when someone opens the help.
 */

export interface HelpCentreProps {
  open: boolean;
  onClose: () => void;
  /** The view the user came from; selects the article to open on. */
  view?: string;
  /** Opens directly on an article, e.g. from an assistant citation. */
  initialSlug?: string;
  /** Lets the tour be restarted from here — the only place a user can find it again. */
  onStartTour?: () => void;
}

export function HelpCentre({ open, onClose, view, initialSlug, onStartTour }: HelpCentreProps) {
  const [query, setQuery] = useState('');
  const [slug, setSlug] = useState<string | undefined>(initialSlug);

  /* Opening the panel resets it to the right place: an explicit article if one was requested,
     otherwise the current view's article, otherwise the index. Without this, reopening shows
     wherever the user happened to be last, which reads as the panel ignoring the button. */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSlug(initialSlug ?? (view ? articleForView(view)?.slug : undefined));
  }, [open, initialSlug, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useMemo(() => (query.trim() ? searchHelp(query, 8) : []), [query]);
  const article: HelpArticle | undefined = slug ? getArticle(slug) : undefined;

  if (!open) return null;

  return (
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="ds-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Help centre"
        data-testid="help-centre"
      >
        <header className="ds-drawer__head">
          {article ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSlug(undefined)}
              icon={<ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />}
            >
              All articles
            </Button>
          ) : (
            <span className="ds-drawer__title">
              <BookOpen size={17} strokeWidth={1.8} aria-hidden="true" /> Help centre
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<X size={17} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onClose}
          >
            Close help
          </Button>
        </header>

        <div className="ds-drawer__body">
          {article ? (
            <article>
              <h2 className="ds-drawer__article-title">{article.title}</h2>
              <p className="ds-drawer__article-summary">{article.summary}</p>
              <Markdown onNavigate={(href) => setSlug(href.replace('/help/', ''))}>
                {article.body}
              </Markdown>

              {article.related && article.related.length > 0 && (
                <nav className="ds-help__related" aria-label="Related articles">
                  <span className="ds-eyebrow">Related</span>
                  {article.related.map((s) => {
                    const rel = getArticle(s);
                    if (!rel) return null;
                    return (
                      <button
                        type="button"
                        key={s}
                        className="ds-help__related-item"
                        onClick={() => setSlug(s)}
                      >
                        {rel.title}
                      </button>
                    );
                  })}
                </nav>
              )}
            </article>
          ) : (
            <>
              <div className="ds-help__search">
                <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                <Input
                  type="search"
                  placeholder="Search help — try “why is my dashboard empty”"
                  aria-label="Search help"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {query.trim() ? (
                results.length > 0 ? (
                  <ul className="ds-help__results">
                    {results.map(({ article: a }) => (
                      <li key={a.slug}>
                        <button type="button" className="ds-help__result" onClick={() => setSlug(a.slug)}>
                          <span className="ds-help__result-title">{a.title}</span>
                          <span className="ds-help__result-summary">{a.summary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  /* Says what to do next rather than only reporting failure. The assistant can
                     answer things the corpus does not cover, and this is the moment a user
                     most needs to know that. */
                  <p className="ds-help__empty">
                    Nothing in the help centre matches “{query.trim()}”. Try fewer words, or ask
                    the assistant — it can answer questions about your own data.
                  </p>
                )
              ) : (
                <>
                  {onStartTour && (
                    <div className="ds-help__tour-prompt">
                      <div>
                        <strong>New here?</strong>
                        <span>Take the one-minute tour of the product.</span>
                      </div>
                      <Button variant="secondary" size="sm" onClick={onStartTour}>
                        Start tour
                      </Button>
                    </div>
                  )}
                  {HELP_CATEGORIES.map((cat) => (
                    <section className="ds-help__category" key={cat.id}>
                      <h3 className="ds-help__category-title">{cat.title}</h3>
                      <p className="ds-help__category-desc">{cat.description}</p>
                      <ul className="ds-help__results">
                        {HELP_ARTICLES.filter((a) => a.category === cat.id).map((a) => (
                          <li key={a.slug}>
                            <button
                              type="button"
                              className="ds-help__result"
                              onClick={() => setSlug(a.slug)}
                            >
                              <span className="ds-help__result-title">{a.title}</span>
                              <span className="ds-help__result-summary">{a.summary}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
