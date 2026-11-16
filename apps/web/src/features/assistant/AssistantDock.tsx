'use client';

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Sparkles, X } from 'lucide-react';
import { Button } from '@/design-system';
import {
  AssistantAnswer,
  SUGGESTIONS,
  askAssistant,
  assistantErrorMessage,
  type Citation,
} from './shared';

/**
 * The assistant dock.
 *
 * Reachable from every view, because the questions it answers arrive while looking at something.
 *
 * IT THREADS A CONVERSATION. It did not, and the consequence was worse than untidy history. This
 * component never sent `conversationId`, so the API — which loads prior turns from its OWN record
 * and deliberately ignores whatever the client sends — started a fresh conversation on every
 * question and handed the model no context at all. Asking a follow-up, or saying "that is not
 * what I meant", produced the same answer again, because as far as the model was concerned the
 * question had never been asked. The Assistant list filled with one-message conversations, which
 * is how it was noticed; the repeated answers were the same bug.
 *
 * The header used to say "the API stores nothing". That stopped being true when conversations
 * were persisted, and this comment was left behind — which is precisely why the missing id was
 * not obvious to anyone reading the file.
 *
 * The citation list is the point of the component. Answers are model-generated, so the value is
 * not the prose but whether the user can check it: every citation is built server-side from a
 * record that was actually fetched, and each one opens.
 */

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

export function AssistantDock({ open, onClose, view, brandId, onOpenArticle }: AssistantDockProps) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The server-side conversation this dock is continuing.
   *
   * Held in a ref, not state. `send` reads it immediately after an await, and a state variable
   * captured by that closure would still be the value from the render that started the request —
   * so two quick questions would both post with `undefined` and open two conversations, which is
   * the bug in miniature.
   */
  const conversationId = useRef<string | null>(null);
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

    try {
      /* This component used to send its own history INSTEAD of the conversation id. The API
         discards client history by design, so the model received no context whatsoever — which is
         why a follow-up, or "that is not what I meant", got the same answer again. */
      const result = await askAssistant({
        question: trimmed,
        conversationId: conversationId.current,
        view,
        brandId,
      });

      /* Recorded before the next question can be asked, so the second turn lands in the same
         conversation as the first. */
      conversationId.current ??= result.conversationId;

      setExchanges((prev) => prev.map((e, i) => (i === prev.length - 1 ? { ...e, ...result } : e)));
    } catch (err) {
      setExchanges((prev) =>
        prev.map((e, i) =>
          i === prev.length - 1 ? { ...e, error: assistantErrorMessage(err) } : e,
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
                  <button
                    type="button"
                    key={s}
                    className="ds-assistant__suggestion"
                    onClick={() => void send(s)}
                  >
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
                  <AssistantAnswer
                    answer={e.answer}
                    steps={e.steps}
                    citations={e.citations}
                    truncated={e.truncated}
                    onOpenArticle={onOpenArticle}
                  />
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
