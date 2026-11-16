import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NavLevel } from '@/lib/types';
import { SCORE, nav } from './fixtures';

/**
 * The drill-down as a security boundary and as a dialog.
 *
 * `sourceUrl` is scraped — a review platform or an actor wrote it — and was placed in an href
 * unchecked. The drawer was also a modal with none of a modal's behaviour: no dialog role, no
 * Escape, no focus handling, and breadcrumbs a keyboard could not reach.
 */

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const brand = vi.hoisted(() => ({ territory: 'all' }));
vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({
    brandId: 'brand-1',
    selected: { id: 'brand-1', name: 'Tes' },
    territory: brand.territory,
  }),
}));

const { DrillDown } = await import('../src/components/DrillDown');

const signal = (over: Record<string, unknown>) => ({
  id: 's1',
  source: 'google_reviews',
  sourceUrl: 'https://example.com/review/1',
  publishedAt: '2026-11-10T00:00:00Z',
  content: 'Billing took weeks.',
  title: null,
  author: 'Sam',
  rating: 2,
  territory: 'GB',
  sentiment: {
    label: 'negative',
    score: -0.7,
    confidence: 0.9,
    dimensions: ['service'],
    topics: ['billing'],
  },
  ...over,
});

const DIM: NavLevel[] = [{ kind: 'overview' }, { kind: 'dimension', dimKey: 'service' }];

beforeEach(() => {
  apiFetch.mockReset();
  brand.territory = 'all';
});

describe('source links', () => {
  it('links a well-formed original, and withholds a javascript: one', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/topics')) return [];
      return {
        items: [
          signal({ id: 'ok' }),
          signal({
            id: 'bad',
            sourceUrl: 'javascript:alert(document.cookie)',
            content: 'Hostile.',
          }),
          signal({ id: 'none', sourceUrl: null, content: 'No link.' }),
        ],
      };
    });
    render(<DrillDown path={DIM} nav={nav()} />);
    const links = await screen.findAllByRole('link', { name: /read the original/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com/review/1');
    expect(screen.getByText(/source link withheld/i)).toBeInTheDocument();
    expect(screen.getByText(/no source url recorded/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('javascript:');
  });
});

describe('the territory lens', () => {
  it('filters the dimension-level signals like the topics above them', async () => {
    /* REGRESSION. The topics were territory-filtered and the signals beneath them were not. */
    brand.territory = 'GB';
    apiFetch.mockImplementation(async (url: string) =>
      url.includes('/topics') ? [] : { items: [] },
    );
    render(<DrillDown path={DIM} nav={nav()} />);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/brands/brand-1/signals?limit=20&dimension=service&territory=GB',
      ),
    );
  });
});

describe('as a dialog', () => {
  it('is a labelled modal that takes focus, closes on Escape, and returns focus', async () => {
    apiFetch.mockResolvedValue(SCORE);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const n = nav();
    const { unmount } = render(<DrillDown path={[{ kind: 'overview' }]} nav={n} />);
    const dialog = screen.getByRole('dialog', { name: 'Score drill-down' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(n.close).toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('makes earlier breadcrumb steps buttons, and marks the current step', async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url.includes('/topics') ? [] : { items: [] },
    );
    const n = nav();
    render(<DrillDown path={DIM} nav={n} />);
    const crumbs = document.querySelector('.crumbs')!;
    const back = crumbs.querySelector('button.c')!;
    expect(back).toHaveTextContent('Index');
    await userEvent.click(back as HTMLElement);
    expect(n.to).toHaveBeenCalledWith(0);
    expect(crumbs.querySelector('[aria-current="step"]')).toHaveTextContent('Service');
  });
});

describe('failures', () => {
  it('says the overview failed rather than "not scored"', async () => {
    apiFetch.mockRejectedValue(new Error('500: score down'));
    render(<DrillDown path={[{ kind: 'overview' }]} nav={nav()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('500: score down');
  });

  it('says a dimension level failed', async () => {
    apiFetch.mockRejectedValue(new Error('500: topics down'));
    render(<DrillDown path={DIM} nav={nav()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('500: topics down');
  });

  it('says a cluster level failed', async () => {
    apiFetch.mockRejectedValue(new Error('500: signals down'));
    render(<DrillDown path={[...DIM, { kind: 'cluster', clusterId: 'billing' }]} nav={nav()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('500: signals down');
  });
});
