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
    // registration when AUTH_MODE is cognito (the default) and they are absent, which is the
    // right place for that check: a missing identity provider there means no request could ever
    // be authorised, and a boot failure beats 401-ing everything in a way that looks like a
    // client bug.
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    // How apps/api authenticates a request.
    //
    //   cognito (default) — every request carries a Cognito ID token, verified against the pool.
    //   local            — for a developer machine with no identity provider. Unsigned
    //                      `dev:<role>:<tenantId>[:<brandEntityId>]` tokens are accepted, and
    //                      POST /auth/local/sign-in issues one for a `users` row whose
    //                      firebase_uid matches the username, given LOCAL_AUTH_PASSWORD.
    //
    // Local mode is an explicit opt-in. It used to be implied by NODE_ENV=development, which is
    // also the schema's DEFAULT — so any process started without NODE_ENV accepted unsigned
    // tokens naming any tenant and any role. Tying it to a variable nobody sets by accident, and
    // refusing it outright in production (below), closes that.
    AUTH_MODE: z.enum(['cognito', 'local']).default('cognito'),
    // The one password every local user signs in with. Required, and at least 12 characters,
    // when AUTH_MODE=local; ignored otherwise. A developer-machine credential, never a deployed
    // one — the production refusal below is what keeps it that way.
    LOCAL_AUTH_PASSWORD: z.string().optional(),
    // Tags applied to AWS resources the API creates at runtime (today: one Secrets Manager secret
    // per CRM connection). JSON object of string values, injected by Terraform from the same
    // values as the stack's default_tags, so a runtime-created resource is attributable and is
    // found by infra-aws/scripts/99-teardown.sh, which inventories by the Project tag.
    RESOURCE_TAGS: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (v === undefined || v === '') return true;
          try {
            const parsed: unknown = JSON.parse(v);
            return (
              typeof parsed === 'object' &&
              parsed !== null &&
              !Array.isArray(parsed) &&
              Object.values(parsed).every((x) => typeof x === 'string')
            );
          } catch {
            return false;
          }
        },
        { message: 'RESOURCE_TAGS must be a JSON object whose values are strings' },
      ),
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
    // The interactive assistant. Separate from the two above so a latency-sensitive surface can
    // be tuned without touching the queue-driven pipeline — and on Haiku deliberately: the
    // assistant is the surface a person judges, so it is where right-sizing has to be proven
    // rather than assumed. Raise it to Sonnet 5 if answer quality does not hold.
    ASSISTANT_MODEL: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),
    // LOCAL DEVELOPMENT ONLY — how a developer's machine reaches the real Bedrock.
    //
    // Locally, AWS_ENDPOINT_URL points every AWS client at LocalStack, and AWS_ACCESS_KEY_ID /
    // AWS_SECRET_ACCESS_KEY hold LocalStack's dummy `test` pair. LocalStack has no Bedrock, so the
    // LLM client ignores AWS_ENDPOINT_URL; and because environment credentials outrank a profile
    // in the SDK's default chain, it would still sign with the dummy pair. Naming a profile here
    // makes the Bedrock client — and ONLY it — use that profile's credentials (an SSO profile on
    // the sandbox account), so S3 and SQS stay on LocalStack while scoring calls the real model.
    //
    // Leave both UNSET in a deployed environment: the ECS task role is then used, unchanged.
    BEDROCK_AWS_PROFILE: z.string().min(1).optional(),
    // Region for Bedrock calls. Defaults to the SDK's own resolution (AWS_REGION).
    BEDROCK_REGION: z.string().min(1).optional(),
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
  })
  .refine((e) => !(e.AUTH_MODE === 'local' && e.NODE_ENV === 'production'), {
    message:
      'AUTH_MODE=local is refused when NODE_ENV=production: it accepts unsigned tokens and must ' +
      'never run in a deployed environment',
    path: ['AUTH_MODE'],
  })
  .refine((e) => e.AUTH_MODE !== 'local' || (e.LOCAL_AUTH_PASSWORD?.length ?? 0) >= 12, {
    message: 'LOCAL_AUTH_PASSWORD (at least 12 characters) is required when AUTH_MODE=local',
    path: ['LOCAL_AUTH_PASSWORD'],
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
