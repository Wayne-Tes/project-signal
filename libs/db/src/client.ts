import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@project-signal/config';
import * as schema from './schema/index.js';

let _client: ReturnType<typeof postgres>;
let _db: ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a postgres-js client. Uses a unix socket (`path`) when DB_SOCKET_PATH is set
 * (Cloud Run + Cloud SQL Auth Proxy) — the Cloud SQL socket path contains colons that
 * break host parsing, so it must go through `path`. Otherwise uses DATABASE_URL (local TCP).
 */
export function createSql(max = 10): ReturnType<typeof postgres> {
  const env = getEnv();
  if (env.DB_SOCKET_PATH) {
    return postgres({
      path: env.DB_SOCKET_PATH,
      database: env.DB_NAME,
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      max,
    });
  }
  return postgres(env.DATABASE_URL as string, { max });
}

export function getClient() {
  if (!_client) {
    _client = createSql(10);
  }
  return _client;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

export const client = { get: getClient };
export const db = { get: getDb };
