import { defineConfig } from 'vitest/config';

// No vite-tsconfig-paths plugin here: apps/web is not `"type": "module"` (it is a Next app,
// unlike the ESM libs), so an ESM-only plugin cannot be required by the CJS config loader.
// The tests import the data layer by relative path instead, which needs no alias resolution.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only the pure data layer is covered. The views behind AuthGate need a real Identity
      // Platform project to exercise (KNOWN-GAPS #16), and component tests would need jsdom
      // and React Testing Library, which are not dependencies here.
      include: ['src/lib/brand-data.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
