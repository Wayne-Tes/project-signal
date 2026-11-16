'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '@/design-system';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';
import {
  AssistantAnswer,
  SUGGESTIONS,
  askAssistant,
  assistantErrorMessage,
  type Citation,
} from '@/features/assistant/shared';

/**
 * The assistant workspace — a full page with persistent, revisitable history.
 *
 * The dock is still there and still right for a question raised by what you are looking at. This
 * is the other mode: conversations you come back to. History lives on the server, so it survives
 * a reload, a different browser and a different machine, and it is scoped to the individual user
 * rather than to the tenant — a conversation quotes that person's own questions.
 *
 * The dock and this page share the API and the renderer but not their state. Coupling them would
 * mean the dock either resurrecting a page conversation on every view, or silently writing into
 * one — both surprising. The dock asks one-off questions; this is where they are kept.
 */

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  steps?: string[] | null;
  truncated?: boolean;
  /** Set locally while an answer is in flight. */
  pending?: boolean;
  error?: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Relative day label for the history list — precision nobody needs, omitted. */
function whenLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function AssistantView({ onOpenArticle }: { onOpenArticle?: (slug: string) => void } = {}) {
  const { selected: brand } = useBrand();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * Which conversation is on screen, as a counter bumped whenever the user switches. A response
   * that arrives for an earlier generation is discarded.
   *
   * Without it, opening conversation A and then B quickly could paint A's messages under B's
   * highlight if A's request finished last — and an answer still in flight when the user moved on
   * was written into whichever conversation they had moved to.
   */
  const generation = useRef(0);

  const loadList = useCallback(async () => {
    try {
      setList(await apiFetch<ConversationSummary[]>('/assistant/conversations'));
      setListError(null);
    } catch {
      /* The list failing must not take the composer with it — a user who cannot see history can
         still ask a question, and that is the more important half. It is still SAID, so an empty
         list is never mistaken for "you have no conversations". */
      setListError('Saved conversations could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function openConversation(id: string): Promise<void> {
    const mine = ++generation.current;
    setActiveId(id);
    setMessages([]);
    try {
      const data = await apiFetch<{ messages: Message[] }>(`/assistant/conversations/${id}`);
      if (generation.current === mine) setMessages(data.messages);
    } catch {
      if (generation.current === mine) {
        setMessages([
          { role: 'assistant', content: '', error: 'That conversation could not be loaded.' },
        ]);
      }
    }
  }

  async function remove(id: string): Promise<void> {
    /* No confirmation dialogue, deliberately: this is the user's own chat history, the action is
       small, and a modal on every delete is friction people learn to click through anyway. */
    try {
      await apiFetch(`/assistant/conversations/${id}`, { method: 'DELETE' });
    } catch {
      setListError('That conversation could not be deleted. Try again.');
      return;
    }
    setList((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      generation.current += 1;
      setActiveId(null);
      setMessages([]);
    }
  }

  function startNew(): void {
    generation.current += 1;
    setActiveId(null);
    setMessages([]);
    setInput('');
  }

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const mine = generation.current;
    setInput('');
    setBusy(true);
    /* Both turns are rendered immediately — the question so it is visibly received, and a
       placeholder so the wait has somewhere to live. A slow answer must not look like a lost
       one. */
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '', pending: true },
    ]);

    try {
      const result = await askAssistant({
        question: trimmed,
        conversationId: activeId,
        brandId: brand?.id,
        view: 'assistant',
      });

      /* Refresh the list regardless — the answer was saved server-side even if the user has moved
         on, and a new conversation must appear. */
      void loadList();
      if (generation.current !== mine) return;

      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? {
                role: 'assistant',
                content: result.answer,
                citations: result.citations,
                steps: result.steps,
                truncated: result.truncated,
              }
            : m,
        ),
      );

      if (!activeId) setActiveId(result.conversationId);
    } catch (err) {
      if (generation.current !== mine) return;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? { role: 'assistant', content: '', error: assistantErrorMessage(err) }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Assistant"
        title="Ask about your data"
        subtitle="Answers cite what they were built from. Conversations are saved to your account and are private to you."
      />

      <div className="ds-chat">
        <aside className="ds-chat__history" aria-label="Conversation history">
          <Button
            variant="secondary"
            size="sm"
            onClick={startNew}
            icon={<Plus size={16} strokeWidth={1.8} aria-hidden="true" />}
          >
            New conversation
          </Button>

          {listError && (
            <p className="ds-chat__history-empty" role="alert">
              {listError}
            </p>
          )}
          {list.length === 0 ? (
            !listError && <p className="ds-chat__history-empty">No saved conversations yet.</p>
          ) : (
            <ul className="ds-chat__list">
              {list.map((c) => (
                <li key={c.id}>
                  <div
                    className={`ds-chat__item${c.id === activeId ? 'ds-chat__item--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="ds-chat__item-open"
                      onClick={() => void openConversation(c.id)}
                    >
                      <span className="ds-chat__item-title">{c.title}</span>
                      <span className="ds-chat__item-when">{whenLabel(c.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="ds-chat__item-delete"
                      aria-label={`Delete conversation: ${c.title}`}
                      onClick={() => void remove(c.id)}
                    >
                      <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <Card className="ds-chat__pane">
          <div className="ds-chat__messages" ref={bodyRef}>
            {messages.length === 0 ? (
              <div className="ds-chat__intro">
                <EmptyState
                  icon={<MessagesSquare size={22} strokeWidth={1.8} />}
                  title="Ask anything about your brands"
                  body="The assistant reads your scores, signals and the documentation. It is read-only — it can look, not change."
                />
                <div className="ds-chat__suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      className="ds-chat__suggestion"
                      onClick={() => void send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === 'user' ? (
                  <p className="ds-chat__question" key={m.id ?? i}>
                    {m.content}
                  </p>
                ) : (
                  <div className="ds-chat__answer" key={m.id ?? i}>
                    {m.error ? (
                      <p className="ds-assistant__error" role="alert">
                        {m.error}
                      </p>
                    ) : m.pending ? (
                      <p className="ds-assistant__thinking" aria-live="polite">
                        Looking at your data…
                      </p>
                    ) : (
                      /* Help links route into the help centre. They were rendered as real anchors
                         here, which navigated this single-route app to a 404. */
                      <AssistantAnswer
                        answer={m.content}
                        steps={m.steps}
                        citations={m.citations}
                        truncated={m.truncated}
                        onOpenArticle={onOpenArticle}
                      />
                    )}
                  </div>
                ),
              )
            )}
          </div>

          <form
            className="ds-chat__composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              className="ds-assistant__input"
              rows={2}
              placeholder="Ask about your data…"
              aria-label="Ask the assistant"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                /* Enter sends, Shift+Enter breaks the line — the convention everywhere else. */
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={busy || input.trim().length === 0}
              icon={<CornerDownLeft size={15} strokeWidth={1.8} aria-hidden="true" />}
            >
              {busy ? 'Thinking…' : 'Ask'}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
