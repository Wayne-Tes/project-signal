'use client';

import { apiFetch } from '@/lib/api';
import { safeExternalHref } from '@/lib/safe-url';
import { Markdown } from '../help/Markdown';
import { helpSlug } from '../help/ArticleView';

/**
 * What the assistant dock and the Assistant page share.
 *
 * They used to hold two copies of the request, the error wording, the tool labels and the whole
 * answer renderer — and the copies had already drifted: the page rendered help links as real
 * anchors (a 404 in this single-route app) while the dock routed them in-app, and the two labelled
 * the same tool differently. One implementation, so a fix lands in both.
 */

export interface Citation {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
}

export interface AssistantResult {
  conversationId: string;
  answer: string;
  citations: Citation[];
  steps: string[];
  truncated: boolean;
}

/** Offered when a conversation is empty. Concrete, because vague prompts get vague answers. */
export const SUGGESTIONS = [
  'What is my Brand Perception Index and what is it built on?',
  'Which dimension has moved most recently, and why?',
  'What is hurting my brand most right now?',
  'How is the index actually calculated?',
];

export const TOOL_LABELS: Record<string, string> = {
  search_help: 'Read the help centre',
  list_brands: 'Listed your brands',
  get_brand_score: 'Read the index',
  get_dimension_scores: 'Read dimension history',
  get_brand_impact: 'Read Brand impact',
  get_strengths: 'Read strengths',
  get_sentiment_summary: 'Read sentiment mix',
  get_brand_stats: 'Checked signal volume',
  get_signals: 'Read individual signals',
};

/**
 * Asks one question.
 *
 * ONLY the new question is sent, plus the id of the conversation it belongs to. Prior turns come
 * from the server's own record; the client's copy is neither sent nor trusted, so a forged
 * assistant turn cannot be replayed to the model as established fact.
 */
export function askAssistant(params: {
  question: string;
  conversationId?: string | null;
  view?: string;
  brandId?: string;
}): Promise<AssistantResult> {
  return apiFetch<AssistantResult>('/assistant/messages', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: params.question }],
      conversationId: params.conversationId ?? undefined,
      view: params.view,
      brandId: params.brandId,
    }),
  });
}

/** The sentence shown when a question fails. A 503 is a configuration fact, not a retryable blip. */
export function assistantErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('503')) {
    return 'The assistant is unavailable — this environment does not currently have access to the configured model.';
  }
  if (message.startsWith('429')) {
    return 'Too many questions in a short time. Wait a moment and ask again.';
  }
  return 'Something went wrong answering that. Try again, or rephrase the question.';
}

/**
 * One answer: the prose, what the assistant looked at, and the sources it cites.
 *
 * The citation list is the point. Answers are model-generated, so the value is not the prose but
 * whether the user can check it: every citation is built server-side from a record that was
 * actually fetched. Hrefs still go through `safe-url` — a citation can carry a signal's scraped
 * URL, and the server is not the place to trust that from.
 */
export function AssistantAnswer({
  answer,
  steps,
  citations,
  truncated,
  onOpenArticle,
}: {
  answer: string;
  steps?: string[] | null;
  citations?: Citation[] | null;
  truncated?: boolean;
  onOpenArticle?: (slug: string) => void;
}) {
  return (
    <>
      <Markdown
        onNavigate={
          onOpenArticle
            ? (href) => {
                const slug = helpSlug(href);
                if (slug) onOpenArticle(slug);
              }
            : undefined
        }
      >
        {answer}
      </Markdown>

      {truncated && (
        /* Stated plainly rather than hidden. A partial answer presented as complete is the
           failure mode that makes an assistant untrustworthy. */
        <p className="ds-assistant__note">
          This answer is partial — the assistant ran out of research steps.
        </p>
      )}

      {steps && steps.length > 0 && (
        <details className="ds-assistant__steps">
          <summary>What it looked at</summary>
          <ul>
            {[...new Set(steps)].map((s) => (
              <li key={s}>{TOOL_LABELS[s] ?? s}</li>
            ))}
          </ul>
        </details>
      )}

      {citations && citations.length > 0 && (
        <div className="ds-assistant__citations">
          <span className="ds-eyebrow">Sources</span>
          <ul>
            {citations.map((c) => (
              <li key={c.id}>
                <CitationLink citation={c} onOpenArticle={onOpenArticle} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function CitationLink({
  citation: c,
  onOpenArticle,
}: {
  citation: Citation;
  onOpenArticle?: (slug: string) => void;
}) {
  const label = (
    <>
      <span className="ds-assistant__citation-title">{c.title}</span>
      {c.detail && <span className="ds-assistant__citation-detail">{c.detail}</span>}
    </>
  );
  const slug = helpSlug(c.href);
  if (slug && onOpenArticle) {
    return (
      <button type="button" className="ds-assistant__citation" onClick={() => onOpenArticle(slug)}>
        {label}
      </button>
    );
  }
  const external = safeExternalHref(c.href);
  if (external) {
    return (
      <a
        className="ds-assistant__citation"
        href={external}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    );
  }
  return <span className="ds-assistant__citation">{label}</span>;
}
