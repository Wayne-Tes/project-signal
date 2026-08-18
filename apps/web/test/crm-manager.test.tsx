import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => mockFetch(...a) }));

import { CrmManager } from '@/components/CrmManager';

const calls = (method: string) =>
  mockFetch.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === method);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue([]);
});

describe('CrmManager', () => {
  /**
   * Said before anything is entered, because whoever pastes a token is usually not whoever read
   * the plan. A CRM link brings personal data into a system whose residency position was written
   * for public review text.
   */
  it('warns about personal data and the DPO before any field is offered', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('CRM')).toBeTruthy());

    expect(screen.getByText(/data protection officer/i)).toBeInTheDocument();
    expect(screen.getByText(/personal data about named individuals/i)).toBeInTheDocument();
  });

  /* Connecting stores the link only. Implying collection has begun would be a false claim about
     what the system is doing with customer data. */
  it('says plainly that nothing is collected yet', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('CRM')).toBeTruthy());
    expect(screen.getByText(/No data is collected yet/i)).toBeInTheDocument();
  });

  it('asks for an instance URL only for Salesforce', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('CRM')).toBeTruthy());

    /* HubSpot has no per-org host — asking would invite a value that means nothing. */
    expect(screen.queryByLabelText('Instance URL')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('CRM'), 'salesforce');
    expect(screen.getByLabelText('Instance URL')).toBeInTheDocument();
  });

  /* Not shoulder-read, not captured in a screen share, and not offered to browser autofill. */
  it('masks both tokens', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('Access token')).toBeTruthy());

    expect(screen.getByLabelText('Access token')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Refresh token')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Access token')).toHaveAttribute('autocomplete', 'off');
  });

  it('will not submit without both tokens', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('Access token')).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Access token'), 'at');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Refresh token'), 'rt');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('sends an absolute expiry, not the lifetime the provider returned', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('Access token')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Access token'), 'at');
    await userEvent.type(screen.getByLabelText('Refresh token'), 'rt');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      const body = JSON.parse(calls('POST')[0]![1].body as string);
      /* "Expired" should be arithmetic, not a relative value nobody re-bases. */
      expect(body.expiresAt).toBeGreaterThan(Date.now());
      expect(body.provider).toBe('hubspot');
    });
  });

  /* A token left in a form field survives in the DOM, in autofill, and in any screenshot of this
     page. */
  it('clears the tokens from the form once stored', async () => {
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByLabelText('Access token')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Access token'), 'at-secret');
    await userEvent.type(screen.getByLabelText('Refresh token'), 'rt-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Access token')).toHaveValue('');
      expect(screen.getByLabelText('Refresh token')).toHaveValue('');
    });
  });

  /* Disconnecting stops collection of a customer's commercial data — not a one-click action. */
  it('requires confirmation before disconnecting', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 'c1',
        provider: 'hubspot',
        instanceUrl: null,
        scopes: [],
        status: 'active',
        connectedBy: 'u',
        lastSyncedAt: null,
        lastAttemptedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    render(<CrmManager />);
    await waitFor(() => expect(screen.getByText('HubSpot')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(calls('DELETE')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
  });
});
