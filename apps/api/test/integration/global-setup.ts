import postgres from 'postgres';

/**
 * Creates a fresh, fully migrated test database before the integration suite runs.
 *
 * SAFETY: the target database name MUST end in `_test`. This drops it, so it refuses anything
 * else — the dev database is `project_signal`, and a deployed one would never be named `_test`.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env['INTEGRATION_DATABASE_URL'] ??
    'postgresql://project_signal_app:password@localhost:5432/project_signal_test';
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, '');

  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(
      `Refusing to run the integration suite against database '${dbName}': the name must end in ` +
        '_test, because this setup DROPS it. Set INTEGRATION_DATABASE_URL to a dedicated test database.',
    );
  }

  // Administrative connection to the server's maintenance database, never to the target itself.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // Migrate it with the API's own migrator — the same code path production boots through.
  process.env['DATABASE_URL'] = url;
  const { runMigrations } = await import('../../src/migrate.js');
  await runMigrations();

  return async () => {
    /* Left in place after the run, deliberately: a failing test's rows are what you inspect.
       The next run drops and re-creates it. */
  };
}
