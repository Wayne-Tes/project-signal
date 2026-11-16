'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * The sign-in screen, for whichever provider this build uses.
 *
 * Cognito (deployed): email + password, plus the first-sign-in password change the
 * admin-create-only pool forces on every new user.
 *
 * Local (`NEXT_PUBLIC_AUTH_MODE=local`): a username + password checked by the API's local
 * sign-in. It is labelled as such, prominently, so a local build can never be mistaken for the
 * real product — and so a screenshot of it is never mistaken for one either.
 */
export function SignIn() {
  const { mode, expired, signIn, completeNewPassword } = useAuth();
  const local = mode === 'local';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Cognito demands a password change before issuing tokens to an admin-created user. The pool
  // is admin-create-only, so EVERY user meets this on first sign-in — it is the normal path,
  // not an error state, and without this branch no new account could ever get in.
  const [mustSetPassword, setMustSetPassword] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mustSetPassword) {
        await completeNewPassword(identifier, newPassword);
      } else {
        const { newPasswordRequired } = await signIn(identifier, password);
        if (newPasswordRequired) setMustSetPassword(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (mustSetPassword) {
        // Surface Cognito's own message for a password-policy rejection — "Sign-in failed" would
        // be actively misleading when the real problem is that the new password is too short.
        setError(message || 'Could not set the new password.');
      } else if (local) {
        // The local client's messages are written for this screen: wrong credentials, API not
        // running, API not in local mode, rate limited. Each needs a different action.
        setError(message || 'Sign-in failed — check your username and password.');
      } else {
        setError('Sign-in failed — check your email and password.');
      }
    } finally {
      setBusy(false);
    }
  }

  const idLabel = local ? 'Username' : 'Email';

  return (
    <div style={wrap}>
      <form onSubmit={(e) => void submit(e)} style={card} aria-labelledby="signin-title">
        {local && (
          <p style={localBadge} data-testid="local-auth-badge">
            Local development sign-in
          </p>
        )}
        <h1
          id="signin-title"
          style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}
        >
          Project Signal
        </h1>
        <p style={{ color: 'var(--t2)', margin: '0 0 20px', fontSize: 13 }}>
          {mustSetPassword
            ? 'Choose a new password to finish setting up your account'
            : local
              ? 'Sign in with a local test account. This build is not connected to Cognito.'
              : 'Sign in to your brand intelligence dashboard'}
        </p>
        {expired && !error && (
          <p role="status" style={notice}>
            Your session has ended. Sign in again to continue.
          </p>
        )}
        <label style={lbl} htmlFor="identifier">
          {idLabel}
        </label>
        <input
          id="identifier"
          name={local ? 'username' : 'email'}
          style={inp}
          type={local ? 'text' : 'email'}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          autoComplete={local ? 'username' : 'email'}
          readOnly={mustSetPassword}
        />
        {!mustSetPassword && (
          <>
            <label style={lbl} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              style={inp}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </>
        )}
        {mustSetPassword && (
          <>
            <label style={lbl} htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              style={inp}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <p style={{ color: 'var(--t3)', fontSize: 11, margin: '6px 0 0' }}>
              At least 12 characters, with upper and lower case, a number and a symbol.
            </p>
          </>
        )}
        {error && (
          /* role=alert: the error appears after an async submit, away from focus, and a screen
             reader user would otherwise never learn the sign-in failed. */
          <p role="alert" style={{ color: 'var(--coral)', fontSize: 13, margin: '12px 0 0' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} style={btn}>
          {busy
            ? mustSetPassword
              ? 'Saving…'
              : 'Signing in…'
            : mustSetPassword
              ? 'Set password and sign in'
              : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const wrap: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--bg)',
  color: 'var(--t1)',
  fontFamily: 'var(--font-body)',
};
const card: CSSProperties = {
  width: 340,
  padding: 32,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 14,
};
const localBadge: CSSProperties = {
  display: 'inline-block',
  margin: '0 0 14px',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--gold)',
  border: '1px solid var(--gold)',
};
const notice: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 13,
  color: 'var(--t2)',
};
const lbl: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--t2)',
  margin: '12px 0 4px',
};
const inp: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--t1)',
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  width: '100%',
  marginTop: 20,
  padding: '11px',
  /* The user's chosen highlight, not the status ramp. `--mint` is the legacy "positive"
     colour and painted these actions olive regardless of the accent selected. */
  background: 'var(--accent)',
  color: 'var(--accent-on)',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
