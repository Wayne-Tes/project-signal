'use client';

import { AppearanceProvider } from '@/design-system';
import { AuthProvider } from '@/lib/auth';
import { BrandProvider } from '@/lib/brand-context';
import { AuthGate } from './AuthGate';
import { App } from './App';

export function ClientApp() {
  return (
    // AppearanceProvider sits OUTSIDE AuthGate so the sign-in screen is themed
    // too. Appearance is a device preference, not an account one — a user who
    // chose dark should not be shown a white login page before being let in.
    <AppearanceProvider>
      <AuthProvider>
        <AuthGate>
          {/* Inside AuthGate: /brands needs a signed-in token, so the provider must not fetch
              until there is one. */}
          <BrandProvider>
            <App />
          </BrandProvider>
        </AuthGate>
      </AuthProvider>
    </AppearanceProvider>
  );
}
