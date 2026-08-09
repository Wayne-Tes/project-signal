'use client';

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Sparkles, X } from 'lucide-react';
import { Button } from '@/design-system';
import { apiFetch } from '@/lib/api';
import { Markdown } from '../help/Markdown';

/**
 * The assistant dock.
 *
 * Reachable from every view, because the questions it answers arrive while looking at
 * something. Conversation state lives here and is sent with each request — the API stores
 * nothing, which is the cheapest way to not leak a conversation store across tenants.
 *
 * The citation list is the point of the component. Answers are model-generated, so the value is
 * not the prose but whether the user can check it: every citation is built server-side from a
 * record that was actually fetched, and each one opens.
 */

interface Citation {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
}

interface Exchange {
  question: string;
  answer?: string;
  citations?: Citation[];
  steps?: string[];
  truncated?: boolean;
  error?: string;
}

export interface AssistantDockProps {
  open: boolean;
  onClose: () => void;
  /** The current view, so "explain this" has a referent. */
  view?: string;
  /** The selected brand. A hint only — the API authorises from the token regardless. */
  brandId?: string;
  /** Opens a help article from a citation. */
  onOpenArticle?: (slug: string) => void;
}

/** Offered when the conversation is empty. Concrete, because vague prompts get vague answers. */
const SUGGESTIONS = [
  'What is my Brand Perception Index and what is it built on?',
  'Which dimension has moved most recently, and why?',
  'What is hurting my brand most right now?',
  'How is the index actually calculated?',
];

const TOOL_LABELS: Record<string, string> = {
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

export function AssistantDock({ open, onClose, view, brandId, onOpenArticle }: AssistantDockProps) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    /* Keep the newest exchange in view as the answer arrives. */
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [exchanges]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setInput('');
    setBusy(true);
    /* The question is rendered immediately, before the request resolves. Waiting for the
       response to show what was asked makes a slow answer look like a dropped one. */
    const pending: Exchange = { question: trimmed };
    setExchanges((prev) => [...prev, pending]);

    /* Prior turns are replayed so the model has context. Built from the state BEFORE this
       question, then the question itself — reading it from the updated state would race. */
    const history = exchanges.flatMap((e) =>
      e.answer
        ? [
            { role: 'user' as const, content: e.question },
            { role: 'assistant' as const, content: e.answer },
          ]
        : [],
    );

    try {
      const result = await apiFetch<{
        answer: string;
        citations: Citation[];
        steps: string[];
        truncated: boolean;
      }>('/assistant/messages', {
        method: 'POST',
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: trimmed }],
          view,
          brandId,
        }),
      });

      setExchanges((prev) =>
        prev.map((e, i) => (i === prev.length - 1 ? { ...e, ...result } : e)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExchanges((prev) =>
        prev.map((e, i) =>
          i === prev.length - 1
            ? {
                ...e,
                error: message.includes('503')
                  ? 'The assistant is unavailable — this environment does not currently have access to the configured model.'
                  : 'Something went wrong answering that. Try again, or rephrase the question.',
              }
            : e,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="ds-drawer ds-drawer--assistant"
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
        data-testid="assistant-dock"
      >
        <header className="ds-drawer__head">
          <span className="ds-drawer__title">
            <Sparkles size={17} strokeWidth={1.8} aria-hidden="true" /> Assistant
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<X size={17} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onClose}
          >
            Close assistant
          </Button>
        </header>

        <div className="ds-drawer__body" ref={bodyRef}>
          {exchanges.length === 0 && (
            <div className="ds-assistant__intro">
              <p>
                Ask about your brands, scores or signals. Answers cite what they were built from,
                and the assistant is <strong>read-only</strong> — it can look, not change.
              </p>
              <div className="ds-assistant__suggestions">
                {SUGGESTIONS.map((s) => (
                  <button type="button" key={s} className="ds-assistant__suggestion" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {exchanges.map((e, i) => (
            <div className="ds-assistant__exchange" key={i}>
              <p className="ds-assistant__question">{e.question}</p>

              {e.error ? (
                <p className="ds-assistant__error" role="alert">
                  {e.error}
                </p>
              ) : e.answer === undefined ? (
                <p className="ds-assistant__thinking" aria-live="polite">
                  Looking at your data…
                </p>
              ) : (
                <div className="ds-assistant__answer">
                  <Markdown onNavigate={(href) => onOpenArticle?.(href.replace('/help/', ''))}>
                    {e.answer}
                  </Markdown>

                  {e.truncated && (
                    /* Stated plainly rather than hidden. A partial answer presented as complete
                       is the failure mode that makes an assistant untrustworthy. */
                    <p className="ds-assistant__note">
                      This answer is partial — the assistant ran out of research steps.
                    </p>
                  )}

                  {e.steps && e.steps.length > 0 && (
                    <details className="ds-assistant__steps">
                      <summary>What it looked at</summary>
                      <ul>
                        {[...new Set(e.steps)].map((s) => (
                          <li key={s}>{TOOL_LABELS[s] ?? s}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {e.citations && e.citations.length > 0 && (
                    <div className="ds-assistant__citations">
                      <span className="ds-eyebrow">Sources</span>
                      <ul>
                        {e.citations.map((c) => {
                          const isHelp = c.href?.startsWith('/help/');
                          const label = (
                            <>
                              <span className="ds-assistant__citation-title">{c.title}</span>
                              {c.detail && <span className="ds-assistant__citation-detail">{c.detail}</span>}
                            </>
                          );
                          return (
                            <li key={c.id}>
                              {isHelp && onOpenArticle ? (
                                <button
                                  type="button"
                                  className="ds-assistant__citation"
                                  onClick={() => onOpenArticle(c.href!.replace('/help/', ''))}
                                >
                                  {label}
                                </button>
                              ) : c.href?.startsWith('http') ? (
                                <a
                                  className="ds-assistant__citation"
                                  href={c.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {label}
                                </a>
                              ) : (
                                <span className="ds-assistant__citation">{label}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          className="ds-assistant__composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            className="ds-assistant__input"
            rows={2}
            placeholder="Ask about your data…"
            aria-label="Ask the assistant"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              /* Enter sends, Shift+Enter breaks the line — the convention everywhere else, and
                 getting it backwards is immediately infuriating. */
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={busy || input.trim().length === 0}
            icon={<CornerDownLeft size={15} strokeWidth={1.8} aria-hidden="true" />}
          >
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </form>
      </aside>
    </>
  );
}
