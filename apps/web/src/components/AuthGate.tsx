'use client';

import { useAuth } from '@/lib/auth';
import { SignIn } from './SignIn';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg)',
          color: 'var(--t2)',
          fontFamily: 'IBM Plex Sans, sans-serif',
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) return <SignIn />;

  return <>{children}</>;
}
