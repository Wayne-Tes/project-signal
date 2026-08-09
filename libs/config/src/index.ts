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
    // On-demand and scheduled scan requests. The API publishes; ingestion consumes.
    SCAN_QUEUE_URL: z.string().optional(),
    // Bedrock model ids. All three default to the Claude Haiku 4.5 EU inference profile.
    //
    // VERIFIED 2026-08-09T10:20Z in account 290304998906, eu-west-2, by INVOKING it. That is the
    // only check worth anything here, and this entry has now been wrong twice for believing a
    // weaker one:
    //
    //   - `list-inference-profiles` lists profiles this account cannot invoke.
    //   - `get-foundation-model-availability` reports this exact model
    //     `agreementAvailability.status: NOT_AVAILABLE` WHILE IT ANSWERS. The field lags, or
    //     means something other than what its name suggests. Either way it is not evidence.
    //
    // Haiku was blocked until the Anthropic use case form was submitted for the account
    // (docs/OWNER-ACTIONS.md #1, submitted 2026-08-09). Sonnet 5 and Opus 5 never needed it and
    // remain available as a fallback if Haiku proves insufficient for a given slot.
    //
    // WHY HAIKU FOR THE SCORER. It runs once per signal — the highest-volume, most cost-sensitive
    // call in the system — and the task is classification against a fixed schema, with forced
    // tool use doing the structuring rather than the model's reasoning. Paying Sonnet rates for
    // that is paying for capability the job does not use.
    //
    // Three things about the VALUE are load-bearing:
    //   - The `eu.` prefix is an INFERENCE PROFILE, not a model. Bedrock rejects the bare
    //     `anthropic.claude-haiku-4-5-…` id with "on-demand throughput isn't supported".
    //   - `eu.` routes within the EU (verified: eu-west-2, -west-1, -west-3, -central-1,
    //     -north-1, -south-1, -south-2). `global.` profiles also exist and do not. Storage and
    //     the database stay in eu-west-2 regardless; this governs where inference runs.
    //   - `temperature` must NOT be sent to Sonnet 5 — it rejects the request outright. See
    //     libs/llm/src/bedrock.ts.
    SCORER_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
    REPORTER_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
    // The interactive assistant. Separate from the two above so an interactive, latency-
    // sensitive surface can be tuned without touching the queue-driven scoring pipeline.
    // The interactive assistant. Separate from the two above so a latency-sensitive surface can
    // be tuned without touching the queue-driven pipeline — and on Haiku deliberately: the
    // assistant is the surface a person judges, so it is where right-sizing has to be proven
    // rather than assumed. Raise it to Sonnet 5 if answer quality does not hold.
    ASSISTANT_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
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
