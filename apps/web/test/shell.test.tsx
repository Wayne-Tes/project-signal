import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SCORE, brandRoutes, routeApi } from './fixtures';

/**
 * The whole client app — ClientApp → AppearanceProvider → AuthProvider → AuthGate → BrandProvider
 * → App — driven as a user would, with the network seam and the identity provider replaced.
 *
 * This is where the shell-level defects live: the brand that could not be changed, the territory
 * lens that skipped some views, the export that failed in silence, the help links on the Assistant
 * page that navigated to a 404.
 */

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const auth = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'admin' | 'user', signOut: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    mode: 'local',
    user: { email: 'local-owner', sub: 'local-owner' },
    role: auth.role,
    loading: false,
    expired: false,
    signIn: vi.fn(),
    completeNewPassword: vi.fn(),
    signOut: auth.signOut,
  }),
}));

const { ClientApp } = await import('../src/components/ClientApp');

const FEED = {
  source: 'rss',
  label: null,
  isEnabled: true,
  config: { feedUrl: 'https://example.com/feed' },
  lastFetchedAt: null,
};
const FEEDS = [
  { ...FEED, id: 'f1', territory: 'GB' },
  { ...FEED, id: 'f2', territory: 'AU' },
];

function routes(overrides: Record<string, unknown> = {}) {
  return brandRoutes({
    '/brands/brand-1/integrations': FEEDS,
    '/brands/brand-1/territories': { territories: ['AU', 'GB'] },
    '/brands/brand-2/integrations': [],
    '/brands/brand-2/territories': { territories: [] },
    '/brands/brand-2/score-history': [],
    '/brands/brand-2/dimension-scores': [],
    '/brands/brand-2/stats': {
      signalsThisWeek: 0,
      signalsPreviousWeek: 0,
      totalSignals: 0,
      scoredSignals: 0,
      classifiedSignals: 0,
      lastRollupDate: null,
      activeSources: 0,
      configuredSources: 0,
    },
    '/brands/brand-2/brand-impact': [],
    '/brands/brand-2/strengths': [],
    '/brands/brand-1/signals': { items: [], nextCursor: null },
    '/assistant/conversations': [],
    ...overrides,
  });
}

function paths(): string[] {
  return apiFetch.mock.calls.map((c) => String(c[0]));
}

async function go(name: RegExp) {
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name }),
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  localStorage.clear();
  /* The first-run tour opens itself for a new browser; these tests are about the shell. */
  localStorage.setItem('ps_tour_completed', '1');
  auth.role = 'owner';
  routeApi(apiFetch, routes());
});

describe('the brand switcher', () => {
  it('changes the brand every view reads, and remembers it', async () => {
    /* REGRESSION. BrandProvider exposed setBrandId and nothing called it — the app always showed
       the first owned brand. */
    render(<ClientApp />);
    const select = await screen.findByLabelText('Brand');
    expect(select).toHaveValue('brand-1');
    expect(within(select).getByRole('option', { name: 'Rival (competitor)' })).toBeInTheDocument();

    await userEvent.selectOptions(select, 'brand-2');
    await waitFor(() => expect(paths()).toContain('/brands/brand-2/score'));
    expect(localStorage.getItem('ps_brand')).toBe('brand-2');
  });

  it('restores the remembered brand on the next visit', async () => {
    localStorage.setItem('ps_brand', 'brand-2');
    render(<ClientApp />);
    expect(await screen.findByLabelText('Brand')).toHaveValue('brand-2');
  });

  it('ignores a remembered brand that no longer exists', async () => {
    localStorage.setItem('ps_brand', 'deleted-brand');
    render(<ClientApp />);
    expect(await screen.findByLabelText('Brand')).toHaveValue('brand-1');
  });
});

describe('the territory lens', () => {
  it('re-reads the views under the chosen territory', async () => {
    render(<ClientApp />);
    const territory = await screen.findByLabelText('Territory');
    await userEvent.selectOptions(territory, 'AU');
    await waitFor(() => expect(paths()).toContain('/brands/brand-1/score?territory=AU'));
    /* The top-bar period follows the lens too. */
    expect(paths()).toContain('/brands/brand-1/dimension-scores?territory=AU');
  });
});

describe('export', () => {
  it('says when an export fails, instead of doing nothing', async () => {
    routeApi(apiFetch, routes({ '/brands/brand-1/signals': new Error('500: export broke') }));
    render(<ClientApp />);
    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    expect(await screen.findByText(/export failed: 500: export broke/i)).toBeInTheDocument();
  });

  it('downloads the signals as CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    /* jsdom cannot navigate, and the download is an anchor click — capture it instead. */
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<ClientApp />);
    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('navigation', () => {
  it('reaches every view in the sidebar', async () => {
    render(<ClientApp />);
    await screen.findByLabelText('Brand');
    for (const name of [
      /trends/i,
      /brand impact/i,
      /what's changed/i,
      /voice of the customer/i,
      /action roadmap/i,
      /competitors/i,
      /weekly report/i,
      /documentation/i,
      /^admin$/i,
      /^dashboard$/i,
    ]) {
      await go(name);
    }
    expect(await screen.findByText('Brand Perception Index')).toBeInTheDocument();
  });

  it('opens the drill-down from the top bar and closes it with Escape', async () => {
    render(<ClientApp />);
    await userEvent.click(await screen.findByRole('button', { name: /dig into score/i }));
    expect(await screen.findByRole('dialog', { name: 'Score drill-down' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Score drill-down' })).not.toBeInTheDocument(),
    );
  });

  it('opens the help centre and the assistant dock', async () => {
    render(<ClientApp />);
    await userEvent.click(await screen.findByRole('button', { name: /^help$/i }));
    expect(await screen.findByTestId('help-centre')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close help/i }));
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByTestId('assistant-dock')).toBeInTheDocument();
  });

  it('hides Admin from a plain user and signs out from the footer', async () => {
    auth.role = 'user';
    render(<ClientApp />);
    await screen.findByLabelText('Brand');
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('button', {
        name: /^admin$/i,
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('switches the report view to a print action', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<ClientApp />);
    await screen.findByLabelText('Brand');
    await go(/weekly report/i);
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('the appearance popover', () => {
  it('applies a theme, accent, hero, font pair and motion choice', async () => {
    render(<ClientApp />);
    await screen.findByLabelText('Brand');
    await userEvent.click(screen.getByRole('button', { name: /appearance/i }));
    for (const [group, option] of [
      ['Theme', 'Dark'],
      ['Sidebar', 'Navy'],
      ['Highlight colour', 'Teal'],
      ['Dashboard hero', 'Bars'],
      ['Font pair', 'Sora + Plex'],
      ['Animation', 'Off'],
    ] as const) {
      const radios = screen.queryByRole('radiogroup', { name: group });
      if (!radios) continue;
      await userEvent.click(within(radios).getByRole('radio', { name: option }));
      expect(within(radios).getByRole('radio', { name: option })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

void SCORE;

describe('the territory lens for a plain user', () => {
  it('is offered from the brand-scoped endpoint, not the admin-only feed list', async () => {
    /* REGRESSION. The picker read /integrations, which is admin-only, so a `user` never saw the
       lens. It now reads /territories, which requireBrandAccess opens to every role. */
    auth.role = 'user';
    render(<ClientApp />);
    expect(await screen.findByLabelText('Territory')).toBeInTheDocument();
    expect(paths()).toContain('/brands/brand-1/territories');
    expect(paths()).not.toContain('/brands/brand-1/integrations');
  });
});
