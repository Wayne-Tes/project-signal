import { z } from 'zod';

const envSchema = z
  .object({
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
    // Both default to 2.5 Flash: it is the only Gemini model available in europe-west2, which
    // is where VERTEX_AI_LOCATION is pinned. The 2.0 defaults these replace were retired on
    // 2026-06-01. 2.5 Flash is itself scheduled for shutdown on 2026-10-16 — moving past it
    // means moving inference to europe-west1/west4 or the EU multi-region. See docs/SETUP.md §8.
    SCORER_MODEL: z.string().default('gemini-2.5-flash'),
    REPORTER_MODEL: z.string().default('gemini-2.5-flash'),
    // System-level credentials for ingestion adapters — one key shared across all tenants.
    APIFY_API_KEY: z.string().optional(),
    YOUTUBE_API_KEY: z.string().optional(),
  })
  .refine((e) => Boolean(e.DATABASE_URL) || Boolean(e.DB_SOCKET_PATH), {
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
