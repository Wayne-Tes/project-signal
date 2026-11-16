import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { BRANDS, CLUSTERS, ROADMAP, SCORE, UNSCORED, brandRoutes, nav, routeApi } from './fixtures';

/**
 * The analytical views, rendered against the real BrandProvider and useApi with only the network
 * seam (`apiFetch`) mocked.
 *
 * Each view was previously untested — the coverage gate measured a nine-file allowlist — so these
 * pin what each view must SAY in its three states (data, empty, failed), plus every defect the
 * assessment found in them.
 */

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const auth = { role: 'owner' as 'owner' | 'admin' | 'user' | null };
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    mode: 'cognito',
    user: { email: 'owner@example.com', sub: 'sub-1' },
    role: auth.role,
    loading: false,
    expired: false,
    signIn: vi.fn(),
    completeNewPassword: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const { BrandProvider } = await import('../src/lib/brand-context');
const { Dashboard } = await import('../src/views/Dashboard');
const { TrendsView } = await import('../src/views/Trends');
const { BrandImpactView } = await import('../src/views/BrandImpact');
const { RoadmapView } = await import('../src/views/Roadmap');
const { CompetitorsView } = await import('../src/views/Competitors');
const { ReportView } = await import('../src/views/Report');
const { VoiceOfCustomerView } = await import('../src/views/VoiceOfCustomer');
const { DocumentationView } = await import('../src/views/Documentation');
const { AdminView } = await import('../src/views/Admin');

function withBrand(ui: ReactNode) {
  return render(<BrandProvider>{ui}</BrandProvider>);
}

function calledPaths(): string[] {
  return apiFetch.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  apiFetch.mockReset();
  auth.role = 'owner';
  localStorage.clear();
  routeApi(apiFetch, brandRoutes());
});

describe('Dashboard', () => {
  it('renders the index card, the dimensions and the clusters', async () => {
    const n = nav();
    withBrand(<Dashboard nav={n} />);
    expect(await screen.findByText('Brand Perception Index')).toBeInTheDocument();
    /* The line under the index is the index: the per-day weighted composite from the API, not a
       first-dimension or unweighted-mean stand-in. */
    expect(screen.getByText(/trend · index/i)).toBeInTheDocument();
    expect(calledPaths()).toContain('/brands/brand-1/score-history');
    expect((await screen.findAllByText(/billing delays/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/helpful staff/i)).length).toBeGreaterThan(0);
  });

  it('opens the drill-down from the index card by keyboard, not only by mouse', async () => {
    const n = nav();
    withBrand(<Dashboard nav={n} />);
    const hero = await screen.findByRole('button', { name: /brand perception index/i });
    hero.focus();
    await userEvent.keyboard('{Enter}');
    expect(n.openOverview).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    expect(n.openOverview).toHaveBeenCalledTimes(2);
  });

  it('reports a failed panel request as a failure, not as "nothing scored negatively"', async () => {
    /* REGRESSION. Only /score and /stats fed the error state, so a failed /brand-impact rendered a
       confident empty panel about the brand. */
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/brand-impact': new Error('500: boom') }));
    withBrand(<Dashboard nav={nav()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('500: boom');
  });

  it('says the brand is unscored rather than drawing a zero', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/score': UNSCORED }));
    withBrand(<Dashboard nav={nav()} />);
    expect(await screen.findByText(/no Brand Perception Index yet/i)).toBeInTheDocument();
  });
});

describe('Trends', () => {
  it('renders the dimension history', async () => {
    withBrand(<TrendsView nav={nav()} />);
    expect((await screen.findAllByText(/trust/i)).length).toBeGreaterThan(0);
  });

  it('shows a failure', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/score': new Error('503: down') }));
    withBrand(<TrendsView nav={nav()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('503: down');
  });
});

describe('Brand impact', () => {
  it('lists the damaging clusters, each with its own control to the evidence', async () => {
    const n = nav();
    withBrand(<BrandImpactView nav={n} />);
    await userEvent.click(await screen.findByRole('button', { name: /read the signals/i }));
    expect(n.openCluster).toHaveBeenCalledWith('billing delays', 'service');
  });

  it('is not one big button wrapping a heading (invalid HTML)', async () => {
    withBrand(<BrandImpactView nav={nav()} />);
    const heading = await screen.findByRole('heading', { name: /billing delays/i });
    expect(heading.closest('button')).toBeNull();
  });

  it('draws no trend arrow, because no trend is measured for a cluster', async () => {
    /* REGRESSION. Every cluster carried a hard-coded "up" arrow. */
    const { container } = withBrand(<BrandImpactView nav={nav()} />);
    await screen.findByText(/billing delays/i);
    expect(container.querySelector('.ds-trend')).toBeNull();
  });

  it('opens a cluster with no known dimension as a bare topic', async () => {
    routeApi(
      apiFetch,
      brandRoutes({ '/brands/brand-1/brand-impact': [{ ...CLUSTERS[0], dimensions: [] }] }),
    );
    const n = nav();
    withBrand(<BrandImpactView nav={n} />);
    await userEvent.click(await screen.findByRole('button', { name: /read the signals/i }));
    expect(n.openTopic).toHaveBeenCalledWith('billing delays');
  });

  it('says plainly when nothing has scored negatively', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/brand-impact': [] }));
    withBrand(<BrandImpactView nav={nav()} />);
    expect(await screen.findByText(/nothing has scored negatively yet/i)).toBeInTheDocument();
  });
});

describe('Action roadmap', () => {
  it('renders the headline, the target and the ranked actions', async () => {
    withBrand(<RoadmapView nav={nav()} />);
    expect(await screen.findByText('Fix the billing loop')).toBeInTheDocument();
    expect(screen.getByText(/declines without action/i)).toBeInTheDocument();
  });

  it('opens the evidence from an explicit control — the card itself is not a button', async () => {
    const n = nav();
    withBrand(<RoadmapView nav={n} />);
    await screen.findByText('Fix the billing loop');
    expect(document.querySelector('.ds-card--interactive')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /read the signals/i })[0]!);
    expect(n.openTopic).toHaveBeenCalledWith('billing delays');
  });

  it('never makes a javascript: citation clickable', async () => {
    withBrand(<RoadmapView nav={nav()} />);
    await screen.findByText('Fix the billing loop');
    const safe = screen.getByRole('link', { name: /a study/i });
    expect(safe).toHaveAttribute('href', 'https://example.com/study');
    expect(screen.queryByRole('link', { name: /hostile/i })).not.toBeInTheDocument();
    expect(screen.getByText(/hostile/i)).toBeInTheDocument();
  });

  it('says when rewording fails, instead of a button that silently does nothing', async () => {
    routeApi(
      apiFetch,
      brandRoutes({ 'POST /brands/brand-1/roadmap/adapt': new Error('503: model unavailable') }),
    );
    withBrand(<RoadmapView nav={nav()} />);
    await userEvent.click(await screen.findByRole('button', { name: /reword for my signals/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/standard steps above still apply/i);
  });

  it('shows the reworded steps when rewording succeeds', async () => {
    routeApi(
      apiFetch,
      brandRoutes({
        'POST /brands/brand-1/roadmap/adapt': {
          adaptedSteps: ['Call the top ten accounts'],
          whatPeopleAreSaying: 'Invoices arrive late',
          adapted: true,
        },
      }),
    );
    withBrand(<RoadmapView nav={nav()} />);
    await userEvent.click(await screen.findByRole('button', { name: /reword for my signals/i }));
    expect(await screen.findByText('Call the top ten accounts')).toBeInTheDocument();
    expect(screen.getByText(/reworded for your signals/i)).toBeInTheDocument();
  });

  it('commits to an action and re-reads the committed list', async () => {
    let committed = false;
    routeApi(
      apiFetch,
      brandRoutes({
        'POST /brands/brand-1/roadmap/actions': () => {
          committed = true;
          return {};
        },
        '/brands/brand-1/roadmap/actions': () =>
          committed
            ? [
                {
                  id: 't1',
                  topic: 'billing delays',
                  territory: 'all',
                  status: 'active',
                  note: null,
                  baselineAt: '2026-11-15T00:00:00Z',
                  baselineIndex: 62.4,
                  ceilingDelta: 3.7,
                  outcome: {
                    verdict: 'unmeasurable',
                    indexDelta: null,
                    damageDelta: null,
                    capturedPercent: null,
                    elapsedDays: 0,
                  },
                },
              ]
            : [],
      }),
    );
    withBrand(<RoadmapView nav={nav()} />);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /we are doing this/i }))[0]!,
    );
    expect(await screen.findByText(/baseline 62\.4/i)).toBeInTheDocument();
  });

  it('does not treat an action committed in ANOTHER territory as committed here', async () => {
    /* REGRESSION. Commitments were matched on topic alone, so a UK commitment showed as
       "already doing this" under every lens, with the UK baseline beneath it. */
    routeApi(
      apiFetch,
      brandRoutes({
        '/brands/brand-1/roadmap/actions': [
          {
            id: 't1',
            topic: 'billing delays',
            territory: 'GB',
            status: 'active',
            note: null,
            baselineAt: '2026-11-15T00:00:00Z',
            baselineIndex: 50,
            ceilingDelta: 1,
            outcome: {
              verdict: 'unmeasurable',
              indexDelta: null,
              damageDelta: null,
              capturedPercent: null,
              elapsedDays: 0,
            },
          },
        ],
      }),
    );
    withBrand(<RoadmapView nav={nav()} />);
    await screen.findByText('Fix the billing loop');
    expect(screen.getAllByRole('button', { name: /we are doing this/i })).toHaveLength(2);
    expect(screen.queryByText(/baseline 50/i)).not.toBeInTheDocument();
  });

  it('lets an owner set, save and clear a target', async () => {
    const patches: unknown[] = [];
    routeApi(
      apiFetch,
      brandRoutes({
        'PATCH /brands/brand-1/target': (_u: string, init?: RequestInit) => {
          patches.push(JSON.parse(String(init?.body)));
          return {};
        },
      }),
    );
    withBrand(<RoadmapView nav={nav()} />);
    await userEvent.click(await screen.findByRole('button', { name: /set a target/i }));
    const input = screen.getByLabelText('Target index');
    await userEvent.clear(input);
    await userEvent.type(input, '72');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /set a target/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(patches).toEqual([{ targetScore: 72 }, { targetScore: null }]));
  });

  it('shows a target save failure', async () => {
    routeApi(apiFetch, brandRoutes({ 'PATCH /brands/brand-1/target': new Error('400: bad') }));
    withBrand(<RoadmapView nav={nav()} />);
    await userEvent.click(await screen.findByRole('button', { name: /set a target/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('400: bad')).toBeInTheDocument();
  });

  it('hides target editing from a plain user', async () => {
    auth.role = 'user';
    withBrand(<RoadmapView nav={nav()} />);
    await screen.findByText('Fix the billing loop');
    expect(screen.queryByRole('button', { name: /set a target/i })).not.toBeInTheDocument();
  });

  it('says when committed actions could not be loaded', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/roadmap/actions': new Error('500: x') }));
    withBrand(<RoadmapView nav={nav()} />);
    expect(await screen.findByText(/committed actions could not be loaded/i)).toBeInTheDocument();
  });

  it('says plainly when nothing is damaging the score', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/roadmap': { ...ROADMAP, actions: [] } }));
    withBrand(<RoadmapView nav={nav()} />);
    expect(await screen.findByText(/nothing is damaging your score/i)).toBeInTheDocument();
  });
});

describe('Competitors', () => {
  it('lists every brand, marks the owned one, and says which are unscored', async () => {
    withBrand(<CompetitorsView />);
    expect(await screen.findByText('Yours')).toBeInTheDocument();
    expect(screen.getByText('Rival')).toBeInTheDocument();
    expect(screen.getByText('not yet scored')).toBeInTheDocument();
  });

  it('distinguishes a failed score request from an unscored brand', async () => {
    /* REGRESSION. A failed request was caught and rendered as "not yet scored". */
    routeApi(apiFetch, brandRoutes({ '/brands/brand-2/score': new Error('500: x') }));
    withBrand(<CompetitorsView />);
    expect(await screen.findByText('could not load')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Rival/);
  });
});

describe('Weekly report', () => {
  it('renders the index and the clusters', async () => {
    withBrand(<ReportView />);
    expect((await screen.findAllByText(/billing delays/i)).length).toBeGreaterThan(0);
  });

  it('says "not scored yet" instead of printing a number', async () => {
    routeApi(apiFetch, brandRoutes({ '/brands/brand-1/score': UNSCORED }));
    withBrand(<ReportView />);
    expect(await screen.findByText('This brand has not been scored yet.')).toBeInTheDocument();
    expect(screen.getByText(/no brand perception index has been calculated/i)).toBeInTheDocument();
  });
});

describe('Voice of the customer', () => {
  it('renders the themes and switches window', async () => {
    withBrand(<VoiceOfCustomerView nav={nav()} />);
    expect((await screen.findAllByText(/renewal pricing/i)).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(calledPaths().some((p) => p.includes('voice-of-customer?days=30'))).toBe(true),
    );
  });
});

describe('Documentation', () => {
  it('opens an article from the contents and searches', async () => {
    render(<DocumentationView />);
    const nav = screen.getByRole('navigation', { name: /documentation contents/i });
    const first = within(nav).getAllByRole('button')[1]!;
    await userEvent.click(first);
    expect(first.className).toContain('ds-docs__link--active');
    await userEvent.type(screen.getByLabelText('Search the documentation'), 'zzzzqqqq');
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search the documentation'));
    await userEvent.type(screen.getByLabelText('Search the documentation'), 'score');
    expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);
  });
});

describe('Admin', () => {
  beforeEach(() => {
    routeApi(
      apiFetch,
      brandRoutes({
        '/admin/users': [],
        '/brands/tree': [],
        '/crm/connections': [],
        '/brands/brand-1/scans': [],
        '/brands/brand-1/aliases': [],
      }),
    );
  });

  it('offers Create tenant to an owner and provisions one', async () => {
    routeApi(
      apiFetch,
      brandRoutes({
        '/admin/users': [],
        '/brands/tree': [],
        '/crm/connections': [],
        '/brands/brand-1/scans': [],
        '/brands/brand-1/aliases': [],
        'POST /admin/tenants': {
          tenant: { id: 't-9', name: 'Acme', slug: 'acme' },
          brand: { id: 'b-9', name: 'Acme' },
          user: { id: 'u-9', role: 'admin' },
        },
      }),
    );
    withBrand(<AdminView />);
    const form = await screen.findByTestId('create-tenant');
    /* Empty, never pre-filled with the operator's own sub — that demoted the owner. */
    expect(within(form).getByLabelText(/admin cognito user id/i)).toHaveValue('');
    await userEvent.type(within(form).getByLabelText('Tenant name'), 'Acme');
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Acme');
    await userEvent.type(within(form).getByLabelText(/admin cognito user id/i), 'sub-new');
    await userEvent.click(within(form).getByRole('button', { name: 'Create tenant' }));
    expect(await screen.findByText('Tenant created')).toBeInTheDocument();
  });

  it('shows a Create tenant failure', async () => {
    routeApi(
      apiFetch,
      brandRoutes({
        '/admin/users': [],
        '/brands/tree': [],
        '/crm/connections': [],
        '/brands/brand-1/scans': [],
        '/brands/brand-1/aliases': [],
        'POST /admin/tenants': new Error('409: slug taken'),
      }),
    );
    withBrand(<AdminView />);
    const form = await screen.findByTestId('create-tenant');
    await userEvent.type(within(form).getByLabelText('Tenant name'), 'Acme');
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Acme');
    await userEvent.type(within(form).getByLabelText(/admin cognito user id/i), 'x');
    await userEvent.click(within(form).getByRole('button', { name: 'Create tenant' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('409: slug taken');
  });

  it('hides Create tenant from an admin, who would only receive a 403', async () => {
    auth.role = 'admin';
    withBrand(<AdminView />);
    await screen.findByTestId('user-manager');
    expect(screen.queryByTestId('create-tenant')).not.toBeInTheDocument();
  });
});

/* Unused-import guard for fixtures referenced only in some branches. */
void BRANDS;
void SCORE;
