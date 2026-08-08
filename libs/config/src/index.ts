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
    // Cognito, which replaced Firebase as the identity provider. Neither value is a secret: the
    // pool id is an identifier, and the client id is deliberately shipped in the browser bundle.
    //
    // Optional in the schema rather than required, because ingestion, the workers and every test
    // boot without them — only apps/api verifies tokens. apps/api fails loudly at plugin
    // registration when NODE_ENV is production and they are absent, which is the right place
    // for that check: a missing identity provider there means no request could ever be
    // authorised, and a boot failure beats 401-ing everything in a way that looks like a client
    // bug.
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    // Comma-separated list of allowed browser origins for the API. Unset = reflect any origin
    // (safe here because auth is Bearer-token only, with no cookies/ambient credentials).
    CORS_ORIGINS: z.string().optional(),
    // Concrete SQS queue URLs, injected per environment by Terraform. There is deliberately no
    // default: an SQS URL embeds the account id and region, so no local constant could stand in
    // for it, and a wrong guess would publish into nowhere. queueUrl() throws when unset.
    ITEM_QUEUE_URL: z.string().optional(),
    REPORT_QUEUE_URL: z.string().optional(),
    // Bedrock model ids. Both default to the Claude Haiku 4.5 EU inference profile, which was
    // verified live in account 290304998906 on 2026-08-07: `converse` returned in 752ms.
    //
    // Three things about this value are load-bearing:
    //   - The `eu.` prefix is an INFERENCE PROFILE, not a model. Bedrock rejects the bare
    //     `anthropic.claude-haiku-4-5-…` id with "on-demand throughput isn't supported".
    //   - `eu.` routes within the EU (verified: eu-west-2, -west-1, -west-3, -central-1,
    //     -north-1, -south-1, -south-2). `global.` profiles also exist and do not. Storage and
    //     the database stay in eu-west-2 regardless; this governs where inference runs.
    //   - REPORTER_MODEL should eventually be a stronger model — it is the low-volume,
    //     higher-quality slot. It is left on Haiku because nothing reads it until Epic 12 and
    //     shipping an UNVERIFIED default is precisely how this project came to ship
    //     `gemini-2.0-pro-001`, a model that never existed. Verify before changing it.
    SCORER_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
    REPORTER_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
    // Cloud Storage buckets, injected per environment by Terraform. RAW_BUCKET holds the
    // verbatim ingested payloads that sentiment scoring reads back.
    RAW_BUCKET: z.string().optional(),
    REPORTS_BUCKET: z.string().optional(),
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
