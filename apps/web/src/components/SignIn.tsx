'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';

export function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
    } catch {
      setError('Sign-in failed — check your email and password.');
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
        <p style={{ color: '#8a8f99', margin: '0 0 20px', fontSize: 13 }}>
          Sign in to your brand intelligence dashboard
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
        />
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
        {error && <p style={{ color: '#e2725b', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
        <button type="submit" disabled={busy} style={btn}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const wrap: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: '#0b0c0f',
  color: '#e8e8ea',
  fontFamily: 'IBM Plex Sans, sans-serif',
};
const card: CSSProperties = {
  width: 340,
  padding: 32,
  background: '#101217',
  border: '1px solid #1e2128',
  borderRadius: 14,
};
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: '#8a8f99', margin: '12px 0 4px' };
const inp: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#0b0c0f',
  border: '1px solid #1e2128',
  borderRadius: 8,
  color: '#e8e8ea',
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  width: '100%',
  marginTop: 20,
  padding: '11px',
  background: '#5dcaa5',
  color: '#06241b',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
