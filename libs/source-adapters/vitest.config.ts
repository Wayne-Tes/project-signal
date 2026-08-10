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
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [...coverageConfigDefaults.exclude, '**/main.ts', 'src/index.ts'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
