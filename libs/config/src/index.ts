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
    // Bedrock model ids. All three default to the Claude Sonnet 5 EU inference profile.
    //
    // VERIFIED 2026-08-08T23:39Z in account 290304998906, eu-west-2, by invoking each profile:
    //   aws bedrock-runtime invoke-model --region eu-west-2 --model-id <id> --body …
    // Sonnet 5 and Opus 5 returned completions. SEVEN other EU Anthropic profiles — including
    // Haiku 4.5, Sonnet 4.5, Opus 4.5, Sonnet 4.6 and Opus 4.6 — returned
    // ResourceNotFoundException: "Model use case details have not been submitted for this
    // account."
    //
    // The previous default was Haiku 4.5, recorded here as verified on 2026-08-07. It no longer
    // works. The reason is one unsubmitted form, not instability: get-foundation-model-availability
    // reports every blocked model AUTHORIZED with entitlement and region AVAILABLE, differing only
    // in agreementAvailability.status — the Anthropic use case form. Sonnet 5 and Opus 5 do not
    // require it; the older models do. Two consequences worth stating rather than discovering later:
    //   - This is a SHARED sandbox. The gate is account-level, so it is not ours to hold open
    //     and a co-tenant project may see the same failure at the same moment.
    //   - A model id in this file is a claim with a timestamp, not a constant. Re-verify before
    //     relying on it. `docs/OWNER-ACTIONS.md` #1 (the Anthropic use case form) is what
    //     re-opens the rest.
    //
    // Three things about the VALUE are load-bearing:
    //   - The `eu.` prefix is an INFERENCE PROFILE, not a model. Bedrock rejects the bare
    //     `anthropic.claude-sonnet-5` id with "on-demand throughput isn't supported".
    //   - `eu.` routes within the EU (verified: eu-west-2, -west-1, -west-3, -central-1,
    //     -north-1, -south-1, -south-2). `global.` profiles also exist and do not. Storage and
    //     the database stay in eu-west-2 regardless; this governs where inference runs.
    //   - REPORTER_MODEL is the low-volume, higher-quality slot and could justify Opus 5. It
    //     stays on Sonnet 5 because nothing reads it until Epic 12 and no output has been
    //     measured; shipping an UNMEASURED default is a smaller version of how this project
    //     came to ship `gemini-2.0-pro-001`, a model that never existed.
    SCORER_MODEL: z.string().default('eu.anthropic.claude-sonnet-5'),
    REPORTER_MODEL: z.string().default('eu.anthropic.claude-sonnet-5'),
    // The interactive assistant. Separate from the two above so an interactive, latency-
    // sensitive surface can be tuned without touching the queue-driven scoring pipeline.
    ASSISTANT_MODEL: z.string().default('eu.anthropic.claude-sonnet-5'),
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
