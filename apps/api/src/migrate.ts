import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createSql } from '@project-signal/db';

// Migrations are owned by the API (the single schema owner) and live alongside it.
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

// Arbitrary but stable key so every instance contends for the same advisory lock.
const MIGRATION_LOCK_KEY = 4815162342;

/**
 * Apply pending Drizzle migrations. Run once on API startup (see PLAN.md
 * "Data-layer ownership"). A Postgres advisory lock serialises concurrent boots so
 * multiple instances never migrate at the same time. No-ops when no migrations exist.
 */
export async function runMigrations(): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) return;

  // A dedicated single connection, as recommended for migrations.
  const migrationClient = createSql(1);
  try {
    await migrationClient`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    await migrate(drizzle(migrationClient), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await migrationClient`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    await migrationClient.end();
  }
}
