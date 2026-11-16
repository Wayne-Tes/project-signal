import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The user and scan panels on the Admin page.
 *
 * The user panel's job, above all, is to never present privilege escalation as an ordinary option:
 * `owner` is not assignable from here by anyone, and an existing owner's role is shown, not offered.
 */

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const actor = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'admin' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ role: actor.role }) }));
vi.mock('@/lib/brand-context', () => ({
  useBrand: () => ({
    brandId: 'brand-1',
    selected: { id: 'brand-1', name: 'Tes' },
    brands: [
      { id: 'brand-1', name: 'Tes', slug: 'tes', isOwned: true },
      { id: 'brand-2', name: 'Rival', slug: 'rival', isOwned: false },
    ],
  }),
}));

const { UserManager } = await import('../src/components/UserManager');
const { ScanPanel } = await import('../src/components/ScanPanel');

const USERS = [
  { id: 'u1', firebaseUid: 'sub-owner', tenantId: 't1', role: 'owner', brandEntityId: null },
  { id: 'u2', firebaseUid: 'sub-admin', tenantId: 't1', role: 'admin', brandEntityId: null },
  { id: 'u3', firebaseUid: 'sub-user', tenantId: 't1', role: 'user', brandEntityId: 'brand-2' },
];

beforeEach(() => {
  apiFetch.mockReset();
  actor.role = 'owner';
});

describe('UserManager', () => {
  beforeEach(() => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/admin/users') return USERS;
      return {};
    });
  });

  it.each(['owner', 'admin'] as const)(
    'never offers owner as an assignable role — not even to an %s',
    async (role) => {
      actor.role = role;
      render(<UserManager />);
      await screen.findByText('sub-admin');
      const create = screen.getByLabelText('Role', { selector: 'select' });
      expect(within(create).queryByRole('option', { name: 'owner' })).not.toBeInTheDocument();
      for (const select of screen.getAllByLabelText(/^role for/i)) {
        expect(within(select).queryByRole('option', { name: 'owner' })).not.toBeInTheDocument();
      }
    },
  );

  it('shows an existing owner’s role as text, not as a control', async () => {
    render(<UserManager />);
    await screen.findByText('sub-owner');
    expect(screen.queryByLabelText('Role for sub-owner')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role for sub-admin')).toBeInTheDocument();
  });

  it('names the pinned brand from the shared brand list', async () => {
    render(<UserManager />);
    const row = (await screen.findByText('sub-user')).closest('tr')!;
    expect(within(row).getByText('Rival')).toBeInTheDocument();
  });

  it('changes a role through the claim-setting endpoint', async () => {
    render(<UserManager />);
    await userEvent.selectOptions(await screen.findByLabelText('Role for sub-admin'), 'user');
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/admin/users/u2', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'user' }),
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/role updated/i);
  });

  it('provisions a user with no pin by default', async () => {
    render(<UserManager />);
    await screen.findByText('sub-admin');
    expect(screen.getByLabelText(/pinned brand/i)).toHaveValue('');
    await userEvent.type(screen.getByLabelText(/cognito user id/i), 'sub-new');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: /provision user/i }));
    await waitFor(() => {
      const post = apiFetch.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        firebaseUid: 'sub-new',
        email: 'new@example.com',
        role: 'user',
        tenantId: 't1',
      });
    });
  });

  it('shows API refusals', async () => {
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/admin/users' && !init) return USERS;
      throw new Error('409: That user already exists');
    });
    render(<UserManager />);
    await screen.findByText('sub-admin');
    await userEvent.type(screen.getByLabelText(/cognito user id/i), 'sub-admin');
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: /provision user/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('409: That user already exists');
    await userEvent.selectOptions(screen.getByLabelText('Role for sub-admin'), 'user');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('409'));
  });

  it('reports a failure to list users', async () => {
    apiFetch.mockRejectedValue(new Error('403: Forbidden'));
    render(<UserManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('403: Forbidden');
    expect(screen.getByText('No users yet.')).toBeInTheDocument();
  });
});

describe('ScanPanel', () => {
  const RUNS = [
    {
      id: 'r1',
      status: 'completed',
      trigger: 'scheduled',
      sourcesAttempted: 3,
      sourcesSucceeded: 2,
      signalsCollected: 14,
      error: 'reddit: actor refused the free plan and returned nothing at all for this run, again',
      startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      finishedAt: null,
    },
    {
      id: 'r2',
      status: 'failed',
      trigger: 'manual',
      sourcesAttempted: 1,
      sourcesSucceeded: 0,
      signalsCollected: 0,
      error: null,
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: null,
    },
  ];

  it('lists recent runs with their outcome in words', async () => {
    apiFetch.mockResolvedValue(RUNS);
    render(<ScanPanel />);
    expect(await screen.findByText('14 signals from 2/3 sources')).toBeInTheDocument();
    expect(screen.getByText('did not run')).toBeInTheDocument();
    expect(screen.getByText(/actor refused the free plan/)).toHaveTextContent('…');
    expect(screen.getByText('scheduled')).toBeInTheDocument();
  });

  it('starts a scan, then shows it running and disables a second start', async () => {
    let started = false;
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        started = true;
        return {};
      }
      return started
        ? [
            {
              ...RUNS[0],
              id: 'r3',
              status: 'running',
              error: null,
              startedAt: new Date().toISOString(),
            },
          ]
        : [];
    });
    render(<ScanPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Scan now' }));
    expect(await screen.findByRole('button', { name: /scan in progress/i })).toBeDisabled();
    expect(screen.getByText('collecting…')).toBeInTheDocument();
  });

  it.each([
    ['409: running', /already running/i],
    ['500: boom', /could not start the scan/i],
  ])('explains a %s', async (error, message) => {
    apiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error(error);
      return [];
    });
    render(<ScanPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Scan now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('keeps the button usable when the run list cannot be read', async () => {
    apiFetch.mockRejectedValue(new Error('500: x'));
    render(<ScanPanel />);
    expect(await screen.findByRole('button', { name: 'Scan now' })).toBeEnabled();
  });
});
