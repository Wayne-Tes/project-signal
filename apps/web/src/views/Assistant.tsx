'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '@/design-system';
import { apiFetch } from '@/lib/api';
import { useBrand } from '@/lib/brand-context';
import { Markdown } from '@/features/help/Markdown';

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

interface Citation {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  steps?: string[] | null;
  /** Set locally while an answer is in flight. */
  pending?: boolean;
  error?: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const TOOL_LABELS: Record<string, string> = {
  search_help: 'Read the documentation',
  list_brands: 'Listed your brands',
  get_brand_score: 'Read the index',
  get_dimension_scores: 'Read dimension history',
  get_brand_impact: 'Read Brand impact',
  get_strengths: 'Read strengths',
  get_sentiment_summary: 'Read sentiment mix',
  get_brand_stats: 'Checked signal volume',
  get_signals: 'Read individual signals',
};

const SUGGESTIONS = [
  'What is my Brand Perception Index and what is it built on?',
  'Which dimension has moved most recently, and why?',
  'What is hurting my brand most right now?',
  'How is the index actually calculated?',
];

/** Relative day label for the history list — precision nobody needs, omitted. */
function whenLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function AssistantView() {
  const { selected: brand } = useBrand();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await apiFetch<ConversationSummary[]>('/assistant/conversations'));
    } catch {
      /* The list failing must not take the composer with it — a user who cannot see history can
         still ask a question, and that is the more important half. */
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function openConversation(id: string): Promise<void> {
    setActiveId(id);
    setMessages([]);
    try {
      const data = await apiFetch<{ messages: Message[] }>(`/assistant/conversations/${id}`);
      setMessages(data.messages);
    } catch {
      setMessages([{ role: 'assistant', content: '', error: 'That conversation could not be loaded.' }]);
    }
  }

  async function remove(id: string): Promise<void> {
    /* No confirmation dialogue, deliberately: this is the user's own chat history, the action is
       small, and a modal on every delete is friction people learn to click through anyway. */
    try {
      await apiFetch(`/assistant/conversations/${id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    setList((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  function startNew(): void {
    setActiveId(null);
    setMessages([]);
    setInput('');
  }

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

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
      const result = await apiFetch<{
        conversationId: string;
        answer: string;
        citations: Citation[];
        steps: string[];
        truncated: boolean;
      }>('/assistant/messages', {
        method: 'POST',
        body: JSON.stringify({
          /* Only the new question. Prior turns come from the server's own record — the client's
             copy is neither sent nor trusted, so a forged assistant turn cannot be replayed to
             the model as established fact. */
          messages: [{ role: 'user', content: trimmed }],
          conversationId: activeId ?? undefined,
          brandId: brand?.id,
          view: 'assistant',
        }),
      });

      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? {
                role: 'assistant',
                content: result.answer,
                citations: result.citations,
                steps: result.steps,
              }
            : m,
        ),
      );

      if (!activeId) setActiveId(result.conversationId);
      /* Refresh the list so a new conversation appears, and an existing one moves to the top. */
      void loadList();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? {
                role: 'assistant',
                content: '',
                error: message.includes('503')
                  ? 'The assistant is unavailable — this environment does not currently have access to the configured model.'
                  : 'Something went wrong answering that. Try again, or rephrase the question.',
              }
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

          {list.length === 0 ? (
            <p className="ds-chat__history-empty">No saved conversations yet.</p>
          ) : (
            <ul className="ds-chat__list">
              {list.map((c) => (
                <li key={c.id}>
                  <div
                    className={`ds-chat__item${c.id === activeId ? ' ds-chat__item--active' : ''}`}
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
                      <>
                        <Markdown>{m.content}</Markdown>

                        {m.steps && m.steps.length > 0 && (
                          <details className="ds-assistant__steps">
                            <summary>What it looked at</summary>
                            <ul>
                              {[...new Set(m.steps)].map((s) => (
                                <li key={s}>{TOOL_LABELS[s] ?? s}</li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {m.citations && m.citations.length > 0 && (
                          <div className="ds-assistant__citations">
                            <span className="ds-eyebrow">Sources</span>
                            <ul>
                              {m.citations.map((c) => (
                                <li key={c.id}>
                                  {c.href?.startsWith('http') ? (
                                    <a
                                      className="ds-assistant__citation"
                                      href={c.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <span className="ds-assistant__citation-title">{c.title}</span>
                                      {c.detail && (
                                        <span className="ds-assistant__citation-detail">{c.detail}</span>
                                      )}
                                    </a>
                                  ) : (
                                    <span className="ds-assistant__citation">
                                      <span className="ds-assistant__citation-title">{c.title}</span>
                                      {c.detail && (
                                        <span className="ds-assistant__citation-detail">{c.detail}</span>
                                      )}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
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
