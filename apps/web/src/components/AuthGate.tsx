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
          background: '#0b0c0f',
          color: '#8a8f99',
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
