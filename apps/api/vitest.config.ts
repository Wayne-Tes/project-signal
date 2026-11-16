import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    /**
     * Run once and exit. **Not a preference — the gate does not terminate without it.**
     *
     * Vitest watches by default whenever `CI` is unset and stdin looks like a TTY, which is
     * exactly the shape of an Nx task on a developer machine. So `yarn test` — the command
     * DEVRULES.md names as the gate that must pass before anything is called done — ran every
     * suite, printed PASS, then sat on "Waiting for file changes..." forever, holding a dozen
     * worker pools open. CI never saw it because GitHub Actions sets `CI=true`.
     *
     * An explicit `--watch` on the command line still overrides this, so the watch workflow is
     * unaffected.
     */
    watch: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    /* The real-Postgres suite has its own config and target (`test:integration`): it needs a
       database, and the unit gate must stay runnable without one. */
    exclude: ['test/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      /* main.ts is process entry (listen, exit). app.ts is the production wiring, exercised end to
         end — every plugin, against real Postgres — by test/integration, not by unit tests. */
      exclude: [...coverageConfigDefaults.exclude, '**/main.ts', '**/app.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
