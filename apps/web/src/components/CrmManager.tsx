'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { CRM_PROVIDERS, CRM_PROVIDER_LABELS, type CrmProvider } from '@project-signal/shared-types';

/**
 * CRM connections, in Admin.
 *
 * ## Why this asks for tokens rather than running an OAuth dance
 *
 * A full authorisation-code flow needs a registered app and a client secret PER PROVIDER — a
 * deployment credential, not a tenant one — and the redirect handling differs between HubSpot and
 * Salesforce. Building both before either is chosen would mean guessing at two flows and getting
 * at least one wrong.
 *
 * What is identical between them is the end state: an access token, a refresh token, an expiry and
 * a set of scopes. This stores that, so the moment a sandbox exists the connection can be made
 * while the OAuth convenience is added afterwards. The alternative — no path at all until the flow
 * is built — would leave credentials sitting in an inbox with nowhere to go.
 *
 * ## The warning is not decoration
 *
 * A CRM link grants standing access to a customer's commercial records and, once syncing, brings
 * personal data about named individuals into a system whose data-residency position was written
 * for public review text. The panel says so before anything is entered, because the person pasting
 * a token is usually not the person who read the plan.
 */

interface Connection {
  id: string;
  provider: string;
  instanceUrl: string | null;
  scopes: string[];
  status: string;
  connectedBy: string;
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const card: CSSProperties = {
  padding: 24,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  marginTop: 16,
};
const lbl: CSSProperties = { display: 'block', color: 'var(--t3)', fontSize: 11, marginBottom: 4 };
const inp: CSSProperties = {
  padding: '7px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--t1)',
  font: 'inherit',
  fontSize: 13,
};

export function CrmManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [provider, setProvider] = useState<CrmProvider>(CRM_PROVIDERS[0]);
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [expiresIn, setExpiresIn] = useState('3600');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Connection[]>('/crm/connections')
      .then(setConnections)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load CRM connections'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch('/crm/connections', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          instanceUrl: instanceUrl.trim() || undefined,
          accessToken: accessToken.trim(),
          refreshToken: refreshToken.trim(),
          /* Providers return a lifetime in seconds; the API stores an absolute instant, because
             "expired" should be arithmetic rather than a relative value nobody re-bases. */
          expiresAt: Date.now() + Number(expiresIn || 3600) * 1000,
        }),
      });
      /* Cleared immediately on success. A token left in a form field survives in the DOM, in
         browser autofill and in any screenshot taken of this page. */
      setAccessToken('');
      setRefreshToken('');
      setInstanceUrl('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    setError('');
    try {
      await apiFetch(`/crm/connections/${id}`, { method: 'DELETE' });
      setConfirmingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect');
    }
  }

  return (
    <div style={card}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, margin: '0 0 4px' }}>
        CRM connections
      </h2>
      <p style={{ color: 'var(--t2)', fontSize: 13, margin: '0 0 12px' }}>
        Brings what the Sales and Customer Success teams hear directly from clients into Signal,
        alongside the public sources.
      </p>

      {/* Said before anything is entered, because whoever pastes a token is usually not whoever
          read the plan. */}
      <p className="crm-warn">
        A CRM link grants standing access to your customers’ commercial records, and syncing brings
        personal data about named individuals into a system whose data-residency position was
        written for public review text. Connect only once your data protection officer has signed
        that off.
      </p>

      <p style={{ color: 'var(--t3)', fontSize: 12, margin: '0 0 14px' }}>
        Connecting stores the link only. <strong>No data is collected yet</strong> — the connector
        that reads interactions is written against a real sandbox, so nothing is guessed.
      </p>

      {connections.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {connections.map((c) => (
            <div key={c.id} className="crm-row">
              <span className="crm-provider">
                {CRM_PROVIDER_LABELS[c.provider as CrmProvider] ?? c.provider}
              </span>
              <span className="crm-meta">
                {c.status}
                {c.instanceUrl ? ` · ${c.instanceUrl}` : ''}
                {c.lastSyncedAt ? ` · synced ${c.lastSyncedAt.slice(0, 10)}` : ' · never synced'}
              </span>
              {/* The failure goes on the row someone has to fix, not into an aggregate error
                  string — the same lesson as `source_configs.last_error`. */}
              {c.lastError && <span className="crm-error">{c.lastError}</span>}
              {confirmingId === c.id ? (
                <>
                  <button type="button" className="ds-chip" onClick={() => void disconnect(c.id)}>
                    Confirm disconnect
                  </button>
                  <button type="button" className="ds-chip" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="ds-chip" onClick={() => setConfirmingId(c.id)}>
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={connect} className="crm-form">
        <div>
          <label style={lbl} htmlFor="crmProvider">
            CRM
          </label>
          <select
            id="crmProvider"
            style={inp}
            value={provider}
            onChange={(e) => setProvider(e.target.value as CrmProvider)}
          >
            {CRM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {CRM_PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        {/* Salesforce is per-org; HubSpot is not. Asking for it unconditionally would invite a
            value that means nothing for HubSpot, and the API refuses a Salesforce link without
            one because a wrong host returns another company's records. */}
        {provider === 'salesforce' && (
          <div>
            <label style={lbl} htmlFor="crmInstance">
              Instance URL
            </label>
            <input
              id="crmInstance"
              style={{ ...inp, width: 260 }}
              value={instanceUrl}
              placeholder="https://acme.my.salesforce.com"
              onChange={(e) => setInstanceUrl(e.target.value)}
            />
          </div>
        )}

        <div>
          <label style={lbl} htmlFor="crmAccess">
            Access token
          </label>
          {/* type="password" so it is not shoulder-read or captured in a screen share. It is
              cleared on success either way. */}
          <input
            id="crmAccess"
            type="password"
            autoComplete="off"
            style={{ ...inp, width: 220 }}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>

        <div>
          <label style={lbl} htmlFor="crmRefresh">
            Refresh token
          </label>
          <input
            id="crmRefresh"
            type="password"
            autoComplete="off"
            style={{ ...inp, width: 220 }}
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
          />
        </div>

        <div>
          <label style={lbl} htmlFor="crmExpires">
            Expires in (seconds)
          </label>
          <input
            id="crmExpires"
            style={{ ...inp, width: 110 }}
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="ds-chip"
          disabled={busy || !accessToken.trim() || !refreshToken.trim()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>

      {error && <p className="crm-error">{error}</p>}
    </div>
  );
}
