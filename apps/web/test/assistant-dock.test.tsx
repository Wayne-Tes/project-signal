import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { AssistantDock } = await import('../src/features/assistant/AssistantDock');

/**
 * The assistant dock, and the conversation it is supposed to be having.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. This component never sent `conversationId`. The API loads
 * prior turns from its OWN record and deliberately ignores whatever history a client sends — so
 * every question opened a fresh conversation and reached the model with no context at all. Asking
 * a follow-up, or replying "that is not what I meant", produced the same answer again, because as
 * far as the model was concerned the question had never been asked.
 *
 * Two symptoms, one cause. The Assistant list filling with one-message conversations is how it was
 * noticed; the repeated answers were the same bug wearing a different hat. The assertions below
 * are about the SECOND request in a conversation, because the first one is identical either way —
 * which is exactly why no existing test caught it.
 */

function reply(id: string, answer: string) {
  return {
    conversationId: id,
    answer,
    citations: [],
    steps: [],
    truncated: false,
  };
}

/** The body of the nth POST to /assistant/messages. */
function sent(n: number): Record<string, unknown> {
  const call = apiFetch.mock.calls.filter((c) => c[0] === '/assistant/messages')[n];
  if (!call) throw new Error(`no request ${n}`);
  return JSON.parse(call[1].body);
}

async function ask(text: string) {
  const box = screen.getByPlaceholderText(/ask/i);
  await userEvent.type(box, text);
  await userEvent.keyboard('{Enter}');
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('threading a conversation', () => {
  it('opens a new conversation on the first question', async () => {
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'first answer'));
    render(<AssistantDock open onClose={() => {}} />);
    await ask('what sources should I add?');

    await waitFor(() => expect(sent(0)['conversationId']).toBeUndefined());
  });

  it('sends the SAME conversation id on the second question', async () => {
    /* The whole bug. Without this the API starts conversation #2, loads no history, and the model
       answers the follow-up as though it were the first thing ever asked. */
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'first answer'));
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'second answer'));

    render(<AssistantDock open onClose={() => {}} />);
    await ask('what sources should I add?');
    await screen.findByText('first answer');
    await ask('I dont think you understand what I am asking');

    await waitFor(() => expect(sent(1)['conversationId']).toBe('conv-1'));
  });

  it('keeps threading across a third turn', async () => {
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'a1'));
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'a2'));
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'a3'));

    render(<AssistantDock open onClose={() => {}} />);
    await ask('one');
    await screen.findByText('a1');
    await ask('two');
    await screen.findByText('a2');
    await ask('three');

    await waitFor(() => expect(sent(2)['conversationId']).toBe('conv-1'));
  });

  it('sends only the new question, never a client-side history', async () => {
    /* The API discards client history by design — a caller could otherwise post a fabricated
       assistant turn and have the model treat its own supposed words as established fact. This
       component used to send that history INSTEAD of the id, which is why the model got nothing. */
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'first answer'));
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'second answer'));

    render(<AssistantDock open onClose={() => {}} />);
    await ask('one');
    await screen.findByText('first answer');
    await ask('two');

    await waitFor(() => {
      const messages = sent(1)['messages'] as { role: string; content: string }[];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: 'user', content: 'two' });
    });
  });

  it('renders both turns, so the dock reads as one conversation', async () => {
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'first answer'));
    apiFetch.mockResolvedValueOnce(reply('conv-1', 'second answer'));

    render(<AssistantDock open onClose={() => {}} />);
    await ask('one');
    await screen.findByText('first answer');
    await ask('two');

    expect(await screen.findByText('second answer')).toBeTruthy();
    expect(screen.getByText('first answer')).toBeTruthy();
  });

  it('does not thread onto a conversation that failed to start', async () => {
    /* The first request errored, so there is no server-side conversation to continue. Sending a
       stale or invented id would 404 the next question. */
    apiFetch.mockRejectedValueOnce(new Error('503: unavailable'));
    apiFetch.mockResolvedValueOnce(reply('conv-9', 'recovered'));

    render(<AssistantDock open onClose={() => {}} />);
    await ask('one');
    await screen.findByText(/unavailable/i);
    await ask('two');

    await waitFor(() => expect(sent(1)['conversationId']).toBeUndefined());
  });
});
