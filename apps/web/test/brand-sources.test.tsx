import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { BrandManager } = await import('../src/components/BrandManager');

/**
 * The feeds panel.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. A brand could hold one feed of each source type, and the
 * failure was silent: adding a second RSS feed did not error, it OVERWROTE the first. The panel
 * then showed a single row as though that had always been the whole configuration. Tracking both
 * "Tes Global" and "Tes MyConcern" on Google News was impossible, and nothing on screen said so.
 *
 * So the assertions here are about a brand holding SEVERAL feeds of one type at once, each
 * separately named, editable and removable — the state the old panel could never reach.
 */

const BRANDS = [{ id: 'brand-1', name: 'Tes', slug: 'tes', isOwned: true }];

interface Feed {
  id: string;
  source: string;
  label: string | null;
  isEnabled: boolean;
  config: Record<string, string>;
  lastFetchedAt: string | null;
}

const FEEDS: Feed[] = [
  {
    id: 'cfg-1',
    source: 'rss',
    label: 'Google News — Tes Global',
    isEnabled: true,
    config: { feedUrl: 'https://news.google.com/rss/search?q=%22Tes+Global%22' },
    lastFetchedAt: '2026-08-09T10:00:00.000Z',
  },
  {
    id: 'cfg-2',
    source: 'rss',
    label: 'Google News — Tes MyConcern',
    isEnabled: true,
    config: { feedUrl: 'https://news.google.com/rss/search?q=%22Tes+MyConcern%22' },
    lastFetchedAt: null,
  },
  {
    id: 'cfg-3',
    source: 'reddit',
    label: null,
    isEnabled: false,
    config: { query: '"Tes MyConcern"', subreddit: 'TeachingUK' },
    lastFetchedAt: null,
  },
];

/** Routes each call by URL, so order of requests does not matter. */
function route(feeds: Feed[] = FEEDS) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/brands') return BRANDS;
    if (url.endsWith('/integrations') && (!init || init.method === undefined))
      return { status: 'ok', data: feeds };
    if (url.endsWith('/aliases')) return { status: 'ok', data: [] };
    return { status: 'ok', data: {} };
  });
}

function feedRow(text: string): HTMLElement {
  const el = screen.getByText(text).closest('li');
  if (!el) throw new Error(`no feed row for ${text}`);
  return el as HTMLElement;
}

function calls(method: string) {
  return apiFetch.mock.calls.filter((c) => c[1]?.method === method);
}

beforeEach(() => {
  apiFetch.mockReset();
  route();
});

describe('several feeds of the same type', () => {
  it('lists every RSS feed, not just one', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());
    expect(screen.getByText('Google News — Tes MyConcern')).toBeTruthy();
  });

  it('groups them under the source type and counts them', async () => {
    render(<BrandManager />);
    /* Waits on a feed LABEL, not on 'News / RSS' — that string is also an <option> in the add
       form, so it is present before the feeds have loaded and would pass instantly against an
       empty list. */
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());
    expect(screen.getByText('2 feeds')).toBeTruthy();
    expect(screen.getByText('1 feed')).toBeTruthy();
  });

  it('falls back to summarising the config when a feed has no name', async () => {
    /* An unnamed Reddit feed still has to be identifiable — "reddit" identifies nothing. */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText(/"Tes MyConcern" · TeachingUK/)).toBeTruthy());
  });

  it('shows whether a feed has ever run', async () => {
    /* A feed that has never run and a market where nobody is talking look identical otherwise. */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getAllByText(/never run/).length).toBeGreaterThan(0));
  });
});

describe('adding a feed', () => {
  it('offers Reddit as a type', async () => {
    /* Reddit was never in this codebase — not in the type union, not in COLLECTING_SOURCES, no
       adapter. It is where an education brand is discussed unprompted. */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed type')).toBeTruthy());
    const options = within(screen.getByLabelText('Feed type')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toContain('Reddit');
  });

  it('asks for a search term and an optional subreddit', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed type')).toBeTruthy());
    await userEvent.selectOptions(screen.getByLabelText('Feed type'), 'reddit');

    expect(screen.getByLabelText('Search term')).toBeTruthy();
    expect(screen.getByLabelText('Subreddit (optional)')).toBeTruthy();
  });

  it('sends the label alongside the config', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed URL')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Name (optional)'), 'Third feed');
    await userEvent.type(screen.getByLabelText('Feed URL'), 'https://c.example/feed.xml');
    await userEvent.click(screen.getByRole('button', { name: 'Add feed' }));

    await waitFor(() => {
      const post = calls('POST')[0];
      expect(JSON.parse(post![1].body)).toEqual({
        source: 'rss',
        label: 'Third feed',
        config: { feedUrl: 'https://c.example/feed.xml' },
        /* Defaults to 'unknown', never to a guessed country. A feed filed under the wrong
           territory produces reporting that is confidently wrong and that nobody ever finds. */
        territory: 'unknown',
        isEnabled: true,
      });
    });
  });

  it('sends the territory chosen on the form', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed URL')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Feed URL'), 'https://d.example/feed.xml');
    await userEvent.selectOptions(screen.getByLabelText('Territory'), 'AU');
    await userEvent.click(screen.getByRole('button', { name: 'Add feed' }));

    await waitFor(() => {
      const post = calls('POST')[0];
      expect(JSON.parse(post![1].body).territory).toBe('AU');
    });
  });

  it('offers the territory by name, not by raw code', async () => {
    /* The stored value is the ISO code; the label is presentation. Showing "AU" in a dropdown
       makes the operator guess, and guessing is how "UK" ends up somewhere ISO calls "GB". */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Territory')).toBeTruthy());

    const select = screen.getByLabelText('Territory') as HTMLSelectElement;
    const names = [...select.options].map((o) => o.textContent);
    expect(names).toContain('Australia');
    expect(names).toContain('United Kingdom');
    expect(names).toContain('Not set');
    expect(names).not.toContain('AU');
  });

  it('will not submit until every required field is filled', async () => {
    /* A feed missing a required field is stored happily and then throws inside a collection run,
       where the dispatcher records "source failed" and tells nobody why. */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed URL')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Add feed' })).toHaveProperty('disabled', true);

    await userEvent.type(screen.getByLabelText('Feed URL'), 'https://c.example/feed.xml');
    expect(screen.getByRole('button', { name: 'Add feed' })).toHaveProperty('disabled', false);
  });

  it('shows the API refusal of an exact duplicate verbatim', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByLabelText('Feed URL')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('Feed URL'), 'https://a.example/feed.xml');
    apiFetch.mockRejectedValueOnce(
      new Error('409: This exact feed is already configured for this brand.'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add feed' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already configured/);
  });
});

describe('editing one feed', () => {
  it('addresses it by its own id, not by the source type', async () => {
    /* The type used to be the key — /integrations/rss — which is precisely why only one could
       exist. */
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes MyConcern')).toBeTruthy());

    await userEvent.click(
      within(feedRow('Google News — Tes MyConcern')).getByRole('button', { name: /^Edit/ }),
    );
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = calls('PATCH')[0];
      expect(patch![0]).toBe('/brands/brand-1/integrations/cfg-2');
      expect(JSON.parse(patch![1].body).label).toBe('Renamed');
    });
  });

  it('toggles just that feed', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());

    await userEvent.click(
      within(feedRow('Google News — Tes Global')).getByRole('button', { name: /^Disable/ }),
    );

    await waitFor(() => {
      const patch = calls('PATCH')[0];
      expect(patch![0]).toBe('/brands/brand-1/integrations/cfg-1');
      expect(JSON.parse(patch![1].body)).toEqual({ isEnabled: false });
    });
  });

  it('edits one row at a time', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());

    await userEvent.click(within(feedRow('Google News — Tes Global')).getByRole('button', { name: /^Edit/ }));
    await userEvent.click(
      within(feedRow('Google News — Tes MyConcern')).getByRole('button', { name: /^Edit/ }),
    );

    expect(screen.getAllByLabelText('Name')).toHaveLength(1);
  });
});

describe('removing a feed', () => {
  it('does not delete on the first click', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());

    await userEvent.click(
      within(feedRow('Google News — Tes Global')).getByRole('button', { name: /^Remove/ }),
    );

    expect(calls('DELETE')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Confirm remove' })).toBeTruthy();
  });

  it('deletes on the confirming click, by id', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());

    await userEvent.click(
      within(feedRow('Google News — Tes Global')).getByRole('button', { name: /^Remove/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await waitFor(() => {
      expect(calls('DELETE')[0]![0]).toBe('/brands/brand-1/integrations/cfg-1');
    });
  });

  it('backs out on Keep', async () => {
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('Google News — Tes Global')).toBeTruthy());

    await userEvent.click(
      within(feedRow('Google News — Tes Global')).getByRole('button', { name: /^Remove/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(calls('DELETE')).toHaveLength(0);
  });
});

describe('a source type this build does not know', () => {
  it('is still listed, so it can be seen and removed', async () => {
    /* The API can return a source added to the backend before the front end is redeployed.
       Dropping it silently means a feed that is running, costing money and invisible. */
    route([
      { id: 'cfg-9', source: 'tiktok', label: 'New thing', isEnabled: true, config: {}, lastFetchedAt: null },
    ]);
    render(<BrandManager />);
    await waitFor(() => expect(screen.getByText('New thing')).toBeTruthy());
    expect(within(feedRow('New thing')).getByRole('button', { name: /^Remove/ })).toBeTruthy();
  });
});
