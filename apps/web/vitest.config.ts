import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// No vite-tsconfig-paths plugin here: apps/web is not `"type": "module"` (it is a Next app,
// unlike the ESM libs), so an ESM-only plugin cannot be required by the CJS config loader. The
// `@/` alias is therefore declared explicitly below rather than read from tsconfig.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      /* Resolved to SOURCE, not to the built dist/. apps/web cannot use vite-tsconfig-paths
         (ESM-only, see above), so workspace packages are aliased by hand. Without this the
         tests resolve via node_modules -> "main" -> dist/, which does not exist until the libs
         are built — green locally after a build, red in CI, which is exactly what happened. */
      '@project-signal/help-content': resolve(__dirname, '../../libs/help-content/src/index.ts'),
      '@project-signal/shared-types': resolve(__dirname, '../../libs/shared-types/src/index.ts'),
    },
  },
  test: {
    // jsdom, not node: the design system and the help/assistant surfaces are components, and a
    // component that is only unit-tested through its pure helpers is not tested. DEVRULES.md
    // recorded the absence of a component-test setup as a standing gap; this closes it.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // Widened from `src/lib/brand-data.ts` as component tests arrive. Listed file by file
      // rather than as `src/**` on purpose: an unqualified glob would drop overall coverage
      // below the gate because of views that still need a running API to exercise, and the
      // honest fix is to add files here as they gain real tests rather than to lower the bar.
      include: [
        'src/lib/brand-data.ts',
        'src/design-system/cx.ts',
        'src/design-system/personalisation.ts',
        'src/features/help/Markdown.tsx',
        'src/features/tour/Tour.tsx',
        'src/lib/export-csv.ts',
        'src/config/sources.ts',
        'src/config/navigation.tsx',
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
