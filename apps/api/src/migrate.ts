import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createSql } from '@project-signal/db';

// Migrations are owned by the API (the single schema owner) and live alongside it.
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

// Arbitrary but stable key so every instance contends for the same advisory lock.
const MIGRATION_LOCK_KEY = 4815162342;

/**
 * How long a booting instance waits for another instance's migration before giving up.
 *
 * `pg_advisory_lock` has no timeout of its own, so a holder that hung — a stuck migration, a
 * connection left open by a crashed task — blocked every subsequent boot INDEFINITELY, and the
 * task never became healthy, never failed, and never told anyone. Five minutes is far longer than
 * any migration in this repository takes; past it, failing the boot loudly is the useful outcome,
 * because the deployment circuit breaker then rolls back and the error names the cause.
 */
export const LOCK_TIMEOUT = '5min';

/**
 * Apply pending Drizzle migrations. Run once on API startup (see PLAN.md
 * "Data-layer ownership"). A Postgres advisory lock serialises concurrent boots so
 * multiple instances never migrate at the same time.
 *
 * @param dir Overridable for tests only.
 */
export async function runMigrations(dir: string = MIGRATIONS_DIR): Promise<void> {
  /* A missing folder is a broken image, not "nothing to do". This used to return silently, so an
     image built without `apps/api/migrations` booted against an unmigrated database and failed
     later, on the first query, with a "relation does not exist" far from the cause. */
  if (!existsSync(dir)) {
    throw new Error(
      `Migrations folder not found at ${dir}. The image is missing apps/api/migrations; refusing ` +
        'to start against a database whose schema cannot be brought up to date.',
    );
  }

  // A dedicated single connection, as recommended for migrations.
  const migrationClient = createSql(1);
  let locked = false;
  try {
    await migrationClient.unsafe(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await migrationClient`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;
    await migrate(drizzle(migrationClient), { migrationsFolder: dir });
  } finally {
    /* Unlock only if we hold the lock, and never let a cleanup failure REPLACE the error that
       got us here: previously a failed lock acquisition was followed by an unlock that threw too,
       and the second error was the one reported. */
    if (locked) {
      try {
        await migrationClient`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      } catch {
        /* The session ends below, which releases a session-level advisory lock regardless. */
      }
    }
    try {
      await migrationClient.end();
    } catch {
      /* Ending a broken connection can fail; the original error, if any, is what matters. */
    }
  }
}
