'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';

export function SignIn() {
  const { signIn, completeNewPassword } = useAuth();
  const [email, setEmail] = useState('');
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
        await completeNewPassword(email, newPassword);
      } else {
        const { newPasswordRequired } = await signIn(email, password);
        if (newPasswordRequired) setMustSetPassword(true);
      }
    } catch (err) {
      // Surface Cognito's own message for a password-policy rejection — "Sign-in failed" would
      // be actively misleading when the real problem is that the new password is too short.
      const message = err instanceof Error ? err.message : '';
      setError(
        mustSetPassword
          ? message || 'Could not set the new password.'
          : 'Sign-in failed — check your email and password.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 22, margin: '0 0 4px' }}>
          Project Signal
        </h1>
        <p style={{ color: 'var(--t2)', margin: '0 0 20px', fontSize: 13 }}>
          {mustSetPassword
            ? 'Choose a new password to finish setting up your account'
            : 'Sign in to your brand intelligence dashboard'}
        </p>
        <label style={lbl} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          style={inp}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          readOnly={mustSetPassword}
        />
        {!mustSetPassword && (
          <>
            <label style={lbl} htmlFor="password">
              Password
            </label>
            <input
              id="password"
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
        {error && <p style={{ color: 'var(--coral)', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
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
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: 'var(--t2)', margin: '12px 0 4px' };
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
  background: 'var(--mint)',
  color: 'var(--ink-accent)',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
