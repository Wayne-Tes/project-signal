'use client';

import { AuthProvider } from '@/lib/auth';
import { AuthGate } from './AuthGate';
import { App } from './App';

export function ClientApp() {
  return (
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  );
}
