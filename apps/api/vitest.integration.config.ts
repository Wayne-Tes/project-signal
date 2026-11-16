import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Real-Postgres integration suite: `yarn nx run api:test:integration`.
 *
 * Exists because a mocked database never renders SQL. Every route test elsewhere stubs drizzle,
 * so none of them can prove a WHERE clause actually filters by tenant, that a uuid column rejects
 * a malformed id, or that a foreign key fires — the classes of defect this API has shipped.
 *
 * DATABASE. A dedicated `project_signal_test` database on the local docker Postgres, dropped and
 * re-created and migrated on every run by `test/integration/global-setup.ts`. The setup REFUSES
 * any database whose name does not end in `_test`, so it cannot be pointed at the dev database
 * (`project_signal`) or anything deployed. Override with INTEGRATION_DATABASE_URL (CI does).
 */
const DATABASE_URL =
  process.env['INTEGRATION_DATABASE_URL'] ??
  'postgresql://project_signal_app:password@localhost:5432/project_signal_test';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    watch: false,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // One database, shared state: files run one at a time so no test sees another's rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL,
      NODE_ENV: 'test',
      // Local mode: dev tokens authenticate requests without an identity provider, and the local
      // sign-in route is registered. Cognito-mode behaviour is covered by the unit suite.
      AUTH_MODE: 'local',
      LOCAL_AUTH_PASSWORD: 'integration-test-password',
      LOG_LEVEL: 'error',
      // Present so the CRM/scan code paths can be constructed; nothing here reaches AWS.
      SCAN_QUEUE_URL: 'http://localhost:4566/000000000000/psignal-local-scan',
    },
  },
});
