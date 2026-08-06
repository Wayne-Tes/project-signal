'use client';

import { AuthProvider } from '@/lib/auth';
import { BrandProvider } from '@/lib/brand-context';
import { AuthGate } from './AuthGate';
import { App } from './App';

export function ClientApp() {
  return (
    <AuthProvider>
      <AuthGate>
        {/* Inside AuthGate: /brands needs a signed-in token, so the provider must not fetch
            until there is one. */}
        <BrandProvider>
          <App />
        </BrandProvider>
      </AuthGate>
    </AuthProvider>
  );
}
