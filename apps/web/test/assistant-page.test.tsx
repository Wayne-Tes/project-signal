import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The Assistant page.
 *
 * Three regressions are pinned here: help links that navigated the single-route app to a 404,
 * citations whose hrefs were trusted, and a slow answer or conversation load landing in whichever
 * conversation the user had moved on to.
 */

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({ selected: { id: 'brand-1', name: 'Tes' } }),
}));

const { AssistantView } = await import('../src/views/Assistant');

const LIST = [
  { id: 'c1', title: 'Why did trust fall?', updatedAt: new Date().toISOString() },
  { id: 'c2', title: 'Older one', updatedAt: '2026-01-01T00:00:00Z' },
];

function answer(over: Record<string, unknown> = {}) {
  return {
    conversationId: 'c-new',
    answer: 'Trust fell. See [how recency works](/help/how-recency-works).',
    citations: [
      { id: 'h1', kind: 'help', title: 'How recency works', href: '/help/how-recency-works' },
      { id: 's1', kind: 'signal', title: 'A review', href: 'https://example.com/r/1' },
      { id: 's2', kind: 'signal', title: 'Hostile', href: 'javascript:alert(1)' },
    ],
    steps: ['get_brand_score', 'search_help', 'get_brand_score'],
    truncated: true,
    ...over,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('asking', () => {
  it('answers, routes help links in-app, and refuses unsafe citation hrefs', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return LIST;
      if (url === '/assistant/messages') return answer();
      throw new Error(`404: ${url}`);
    });
    const onOpenArticle = vi.fn();
    render(<AssistantView onOpenArticle={onOpenArticle} />);
    await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Why did trust fall?{Enter}');

    /* The inline help link is an in-app button, not an <a href="/help/..."> to a 404. */
    await userEvent.click(await screen.findByRole('button', { name: 'how recency works' }));
    expect(onOpenArticle).toHaveBeenCalledWith('how-recency-works');

    const sources = screen.getByText('Sources').closest('div')!;
    await userEvent.click(within(sources).getByRole('button', { name: /how recency works/i }));
    expect(onOpenArticle).toHaveBeenLastCalledWith('how-recency-works');
    expect(within(sources).getByRole('link', { name: /a review/i })).toHaveAttribute(
      'href',
      'https://example.com/r/1',
    );
    expect(within(sources).queryByRole('link', { name: /hostile/i })).not.toBeInTheDocument();

    expect(screen.getByText(/this answer is partial/i)).toBeInTheDocument();
    /* Steps are de-duplicated and labelled. */
    expect(screen.getAllByText('Read the index')).toHaveLength(1);
  });

  it('sends only the new question, with the conversation it belongs to', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return LIST;
      if (url === '/assistant/conversations/c1')
        return { messages: [{ role: 'user', content: 'Earlier' }] };
      if (url === '/assistant/messages') return answer({ conversationId: 'c1' });
      throw new Error(`404: ${url}`);
    });
    render(<AssistantView />);
    await userEvent.click(await screen.findByRole('button', { name: /^why did trust fall/i }));
    await screen.findByText('Earlier');
    await userEvent.type(screen.getByLabelText('Ask the assistant'), 'And now?{Enter}');
    await waitFor(() => {
      const post = apiFetch.mock.calls.find((c) => c[0] === '/assistant/messages');
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        messages: [{ role: 'user', content: 'And now?' }],
        conversationId: 'c1',
        brandId: 'brand-1',
        view: 'assistant',
      });
    });
  });

  it.each([
    ['503: no model access', /unavailable/i],
    ['429: slow down', /too many questions/i],
    ['500: boom', /something went wrong/i],
  ])('explains a %s', async (error, message) => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return [];
      throw new Error(error);
    });
    render(<AssistantView />);
    await userEvent.click(screen.getByRole('button', { name: /what is hurting my brand/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('switching conversations', () => {
  it('discards a conversation load that finishes after the user moved on', async () => {
    const slow = deferred<{ messages: { role: string; content: string }[] }>();
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return LIST;
      if (url === '/assistant/conversations/c1') return slow.promise;
      if (url === '/assistant/conversations/c2')
        return { messages: [{ role: 'user', content: 'Second' }] };
      throw new Error(`404: ${url}`);
    });
    render(<AssistantView />);
    await userEvent.click(await screen.findByRole('button', { name: /^why did trust fall/i }));
    await userEvent.click(screen.getByRole('button', { name: /^older one/i }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    await act(async () => {
      slow.resolve({ messages: [{ role: 'user', content: 'First (stale)' }] });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText('First (stale)')).not.toBeInTheDocument();
  });

  it('does not write a late answer into a NEW conversation the user started meanwhile', async () => {
    const slow = deferred<ReturnType<typeof answer>>();
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return [];
      if (url === '/assistant/messages') return slow.promise;
      throw new Error(`404: ${url}`);
    });
    render(<AssistantView />);
    await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Slow one{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    await act(async () => {
      slow.resolve(answer({ answer: 'LATE ANSWER' }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(/late answer/i)).not.toBeInTheDocument();
  });

  it('deletes a conversation, and says so when it cannot', async () => {
    let fail = false;
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/assistant/conversations') return LIST;
      if (init?.method === 'DELETE') {
        if (fail) throw new Error('500: nope');
        return undefined;
      }
      throw new Error(`404: ${url}`);
    });
    render(<AssistantView />);
    await userEvent.click(
      await screen.findByRole('button', { name: /delete conversation: older one/i }),
    );
    await waitFor(() => expect(screen.queryByText('Older one')).not.toBeInTheDocument());
    fail = true;
    await userEvent.click(
      screen.getByRole('button', { name: /delete conversation: why did trust fall/i }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be deleted/i);
  });

  it('says when saved conversations cannot be loaded, rather than claiming there are none', async () => {
    apiFetch.mockRejectedValue(new Error('500: x'));
    render(<AssistantView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText(/no saved conversations yet/i)).not.toBeInTheDocument();
  });

  it('reports a conversation that cannot be opened', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/assistant/conversations') return LIST;
      throw new Error('500: gone');
    });
    render(<AssistantView />);
    await userEvent.click(await screen.findByRole('button', { name: /^why did trust fall/i }));
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
