import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Deferred skeleton (reporting = Epic 12): only main.ts, nothing to gate yet.
      include: ['src/**'],
      exclude: [...coverageConfigDefaults.exclude, '**/main.ts'],
    },
  },
});
