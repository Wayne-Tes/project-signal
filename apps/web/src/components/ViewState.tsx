'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Renders the loading / error / empty states around live data.
 *
 * Every analytical view now reads from the API, and the three states are genuinely different:
 * still-loading is not empty, and empty is not failed. Collapsing them — the usual shortcut of
 * rendering a zero — is how a brand that has never been scored ends up looking like a brand
 * scoring zero.
 */
export function ViewState({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  /** Message to show when the request succeeded but returned nothing. Null means "not empty". */
  empty: string | null;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="card" style={pane}>
        <span className="kicker">Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ ...pane, color: 'var(--coral)' }} role="alert">
        <div style={{ fontSize: 14, marginBottom: 4 }}>Could not load this view</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--t3)' }}>
          {error}
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="card" style={pane}>
        <div style={{ fontSize: 14, color: 'var(--t2)' }}>{empty}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t3)', marginTop: 6 }}>
          Scores appear once the pipeline has ingested and scored signals for this brand.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const pane: CSSProperties = {
  padding: '32px 26px',
  textAlign: 'center',
};
