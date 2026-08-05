import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Connect either via a DATABASE_URL (local TCP) or discrete socket parts (Cloud Run +
  // Cloud SQL Auth Proxy, whose /cloudsql/PROJECT:REGION:INSTANCE path is not URL-parseable
  // and whose colons break postgres-js host parsing — so it must go through `path`).
  DATABASE_URL: z.string().optional(),
  DB_SOCKET_PATH: z.string().optional(),
  DB_NAME: z.string().default('project_signal'),
  DB_USER: z.string().default('project_signal_app'),
  DB_PASSWORD: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string(),
  // Comma-separated list of allowed browser origins for the API. Unset = reflect any origin
  // (safe here because auth is Bearer-token only, with no cookies/ambient credentials).
  CORS_ORIGINS: z.string().optional(),
  PUBSUB_EMULATOR_HOST: z.string().optional(),
  VERTEX_AI_LOCATION: z.string().default('europe-west2'),
  SCORER_MODEL: z.string().default('gemini-2.0-flash-001'),
  REPORTER_MODEL: z.string().default('gemini-2.0-pro-001'),
  // System-level credentials for ingestion adapters — one key shared across all tenants.
  APIFY_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
}).refine((e) => Boolean(e.DATABASE_URL) || Boolean(e.DB_SOCKET_PATH), {
  message: 'Either DATABASE_URL or DB_SOCKET_PATH must be set',
});

export type Env = z.infer<typeof envSchema>;

let _env: Env;

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${parsed.error.message}`);
    }
    _env = parsed.data;
  }
  return _env;
}
