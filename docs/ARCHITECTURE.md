# Project Signal — Architecture Reference

> **What this document is.** A complete, code-accurate description of what exists in this
> repo today: every app, library, table, route, and piece of infrastructure, and how they
> fit together. It is the fastest way for a new contributor (human or agent) to get to
> working knowledge without reading all ~200 source files.
>
> **What it is not.** A plan. Design rationale and the roadmap live in
> [`PLAN.md`](PLAN.md); things that are built-but-not-wired live in
> [`KNOWN-GAPS.md`](KNOWN-GAPS.md). **Read `KNOWN-GAPS.md` before assuming any end-to-end
> flow works** — several links in the pipeline are provisioned but not connected.
>
> Keep this file updated when structure changes. It describes behaviour, not line numbers,
> so it should survive ordinary refactors.

---

## Contents

1. [Product in one page](#1-product-in-one-page)
2. [Repository map](#2-repository-map)
3. [Tooling and conventions](#3-tooling-and-conventions)
4. [Data model](#4-data-model)
5. [Shared libraries](#5-shared-libraries)
6. [apps/api — REST API](#6-appsapi--rest-api)
7. [apps/ingestion — source pull](#7-appsingestion--source-pull)
8. [apps/sentiment-worker — scoring](#8-appssentiment-worker--scoring)
9. [apps/report-worker — deferred skeleton](#9-appsreport-worker--deferred-skeleton)
10. [apps/web — dashboard](#10-appsweb--dashboard)
11. [End-to-end flows](#11-end-to-end-flows)
12. [Infrastructure (Terraform / GCP)](#12-infrastructure-terraform--gcp)
13. [CI/CD](#13-cicd)
14. [Testing](#14-testing)
15. [Local development](#15-local-development)
16. [Gotchas worth knowing before you edit](#16-gotchas-worth-knowing-before-you-edit)

---

## 1. Product in one page

Project Signal is an **agency-managed, multi-tenant brand-intelligence SaaS** by Wayne Strydom.

The loop it implements:

1. **Ingest** public brand signals — Google reviews, App Store / Play Store reviews, YouTube
   comments, RSS/news — on a weekly schedule, per brand, per source.
2. **Score** each signal with Claude on Bedrock: sentiment label, score (−1…1), confidence, which
   of the five brand dimensions it touches, and topic tags.
3. **Surface** the result in a dashboard: a composite Brand Perception Index, per-dimension
   breakdown, a "Brand impact" ranking of the weaknesses doing the most damage, a
   prioritised action roadmap, competitor benchmarking, and a printable weekly report.

The five perception dimensions are fixed across the codebase: **trust, quality, service,
value, experience**.

**Tenancy model.** One `tenant` per customer. A tenant has `brand_entities` (its own brands,
`is_owned = true`, plus tracked competitors, `is_owned = false`). Users belong to a tenant and
carry one of three roles — `owner`, `admin`, `user` — with `user` optionally pinned to a single
brand. Isolation is enforced **at the application/query layer**, not by Postgres RLS: every
query filters on `tenant_id`. This was a deliberate MVP decision (see `PLAN.md`).

---

## 2. Repository map

```
project-signal/
├── apps/
│   ├── api/                  Fastify 5 REST API — owns the DB schema + migrations
│   ├── ingestion/            Scheduled source pull + dispatcher
│   ├── sentiment-worker/     Scores signals via Bedrock (HTTP route; SQS consumer is Phase 4)
│   ├── report-worker/        Health-check skeleton (reporting deferred, Epic 12)
│   └── web/                  Next.js 16 dashboard
├── libs/
│   ├── shared-types/         Cross-service contracts (no runtime deps)
│   ├── config/               zod-validated env loader
│   ├── db/                   Drizzle schema + postgres-js client
│   ├── llm/                  LlmClient interface + Bedrock implementation
│   ├── messaging/            MessagePublisher interface + SQS implementation
│   ├── storage/              ObjectStore interface + S3 implementation
│   ├── scoring/              Brand Perception Index: decay, dimensions, topic clusters
│   └── source-adapters/      Adapter interface + 6 implementations
├── infra-aws/                THE REAL TARGET — see §12
│   ├── bootstrap/            S3 remote-state bucket (local state, run once)
│   ├── account/              ACCOUNT-GLOBAL, shared with co-tenant projects. Not ours
│   ├── stack/                Tag-filtered budget. Phases 2-7 land here
│   ├── envs/                 dev.tfvars, dev.stack.tfvars, account.tfvars
│   └── scripts/              _guard.sh + discover / preflight / teardown
├── infra/                    GCP. SUPERSEDED, reference only — never applied (§12)
│   ├── bootstrap/            One-shot: APIs, TF state bucket, Workload Identity Federation
│   ├── modules/              9 reusable Terraform modules
│   ├── stack/                Shared .tf for every environment
│   └── envs/                 staging.tfvars / production.tfvars
├── .github/workflows/        ci, terraform-plan  (no deploy pipeline — Phase 6)
├── scripts/build-libs.sh     Deterministic lib build used by app Dockerfiles
└── docs/                     PLAN.md, ARCHITECTURE.md, KNOWN-GAPS.md, diagram, spec
```

**Dependency direction.** `apps/*` depend on `libs/*`; libs depend on each other only in this
order (which `scripts/build-libs.sh` hard-codes):

```
config → shared-types → db → storage → scoring → llm → messaging → source-adapters
```

No app imports another app. Workers talk to Postgres **directly** via `libs/db` rather than
through the API — the pipeline is a set of stages over shared data, not independent bounded
contexts, so HTTP-per-signal was rejected as wasteful. The API remains the sole schema owner.

---

## 3. Tooling and conventions

| Concern           | Choice                             | Notes                                                                                                                                                                    |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo          | **Nx 20**                          | Plugins: `@nx/next`, `@nx/eslint`, `@nx/vite`. Caching on `build`, `lint`, `typecheck`, `test`. `defaultBase: main`. **Never enable Nx Cloud.**                          |
| Packages          | **Yarn 4.9.2** (Berry)             | node-modules linker (`.yarnrc.yml`). Workspaces: `apps/*`, `libs/*`. There is no `pnpm-workspace.yaml` — ignore any doc that says pnpm.                                  |
| Language          | **TypeScript 5.5**, ESM throughout | `strict` + `noUncheckedIndexedAccess`. Every backend `package.json` sets `"type": "module"`.                                                                             |
| Module resolution | `bundler`, `module: ESNext`        | Path aliases `@project-signal/*` → `libs/*/src/index.ts` in `tsconfig.base.json`; `@/*` → `src/*` inside `apps/web`.                                                     |
| Lint              | ESLint 9 flat config               | `no-explicit-any: error`, `consistent-type-imports: error`, `no-console: warn` (allows `warn`/`error`). Test files relax `any` and unused-vars.                          |
| Format            | Prettier 3                         | Plus `prettier-plugin-tailwindcss` (installed; the web app currently uses plain CSS, not Tailwind).                                                                      |
| Commits           | husky + commitlint                 | Conventional commits with a **fixed `scope-enum`** in `commitlint.config.js` — a new scope must be added there or the commit is rejected. `pre-commit` runs lint-staged. |
| Node              | **26** (Active LTS)                | `.nvmrc` = 26, `engines` `>=26 <27`, CI reads `.nvmrc`, Docker images are `node:26-alpine`. Node 25+ ships without corepack; it is installed pinned (`corepack@0.36.0`). |

**Nx target names** are consistent across projects: `build`, `dev`, `lint`, `typecheck`,
`test`, plus `docker-build` on the backend apps and `generate` / `seed` on `api`.

**Project names are not uniform**, which trips people up. The four backend apps each have a
`project.json` whose `name` wins, so they are short; `web` and the libs have no `project.json`,
so Nx uses the `package.json` name:

| Project               | Nx name                 |
| --------------------- | ----------------------- |
| apps/api              | `api`                   |
| apps/ingestion        | `ingestion`             |
| apps/sentiment-worker | `sentiment-worker`      |
| apps/report-worker    | `report-worker`         |
| apps/web              | `@project-signal/web`   |
| libs/\*               | `@project-signal/<lib>` |

```bash
nx run-many -t lint typecheck test    # what CI runs
nx run api:dev                        # one project (short name — has a project.json)
nx run @project-signal/web:dev        # scoped name — no project.json
nx affected -t test                   # PR-scoped
```

---

## 4. Data model

Postgres 16. Schema lives in `libs/db/src/schema/`, one file per table, re-exported through
`schema/index.ts`. Migration SQL is generated by `drizzle-kit` into `apps/api/migrations/`
(the API owns migrations; see §6).

All ids are `uuid` with `defaultRandom()`. All timestamps are `timestamptz`.

### Tables

> **The three tables added for the roadmap and CRM work are documented at the end of this list**:
> `tracked_actions`, `crm_connections` and `accounts`.

**`tenants`** — multi-tenant root.
`name`, `slug` (unique), timestamps.

**`brand_entities`** — brands the tenant owns _and_ competitors it tracks.
`tenant_id` → tenants, `name`, `slug`, `is_owned` (default `true`), timestamps.

**`users`** — mirrors Identity Platform users so the admin UI can list/manage them.
`cognito_sub` (**unique**; renamed from `firebase_uid` by migration `0018`; holds the Cognito
`sub`, or the local username in `AUTH_MODE=local`), `tenant_id` → tenants, `role` varchar(20), `brand_entity_id`
(nullable) → brand*entities, timestamps.
Role is \_also* stored as a Firebase custom claim — the claim is what authorises requests; this
table exists for management UI and audit.

**`brand_aliases`** — alternative names/abbreviations so ingestion and scoring can match
mentions that don't use the canonical brand name (e.g. "Cadence", "Cadence Bank", "CDN").
`tenant_id`, `brand_entity_id`, `alias`, **unique `(brand_entity_id, alias)`**.

**`signals`** — one row per ingested item. The spine of the system.
`tenant_id`, `brand_entity_id`, `source` varchar(50), `source_config_id`, **`territory`**
(default `unknown`), `source_url`, `raw_storage_ref`, `content`, `title`, `author`, `rating`,
`published_at`, `ingested_at`.

`raw_storage_ref` points at the S3 object written at collection time, which carries **both** forms
under `schemaVersion: 2`: `sourceText` / `sourceTitle` are what the source returned untouched, and
`text` is the adapter's processed output. Nothing in the pipeline reads the former — they exist so
a future normalisation change can be re-derived from what was published rather than from what we
last decided it said. The bucket is **versioned** (90-day noncurrent expiry), because the object
key is derived from the external id and re-collection therefore overwrites. See KNOWN-GAPS #28.

`voice` is `direct` (the customer wrote the words) or `reported` (an employee wrote down what a
customer said). **It is a correctness control, not a label**, and the default lives inside
`attributedTo` rather than as a filter each call site adds — see [`libs/db`](#libsdb). Measured on
real data: four positive public signals and six negative CRM notes score **85.0 direct, 5.0
reported, 37.0 blended**. Averaging the channels would drop the index 48 points for reasons
unrelated to brand perception, and 37 looks entirely plausible.

`account_id` is the customer a CRM interaction is about, and null for every public signal.
`ON DELETE SET NULL`, because removing an account must not delete the evidence of what they said.

`territory` is **copied from the feed at insert**, not joined at read time. `source_config_id` is
nullable and `ON DELETE SET NULL`, so a join would erase the territory of every signal a feed ever
collected the moment that feed is deleted — and that evidence belongs to the brand, not to the
configuration. Changing a feed's territory therefore does **not** rewrite history; correcting a
misconfiguration retrospectively is `POST /admin/backfill/territory`, a deliberate act rather than
a side effect of an edit.

Sentiment lives **only** in `sentiment_results`, read by joining. `signals` used to carry
`sentiment_label` / `sentiment_score` / `confidence` / `model_version` as well — a second home
for the same fact that nothing ever wrote. Migration `0005` dropped them rather than adopting
them as a read cache (KNOWN-GAPS #11): two plausible homes invite a future writer to pick the
wrong one and split the truth. If a denormalised cache is ever wanted for list performance,
reintroduce it deliberately, maintained by the sentiment worker in the same transaction as the
results row.

- Index `signals_tenant_brand_idx` on `(tenant_id, brand_entity_id)`
- Index `signals_published_at_idx` on `(published_at)`
- **Unique `(source_url, brand_entity_id)`** ← this is the deduplication key. Ingestion relies
  on it via `onConflictDoNothing()`.

**`sentiment_results`** — model output, one row per signal.
`signal_id` (**unique**, → signals), `label`, `score` real, `confidence` real,
`dimensions` text[], `topics` text[], `model_version`, `scored_at`.
The unique constraint is what makes scoring idempotent — the worker upserts on it.

**`dimension_scores`** — daily per-brand, per-dimension, **per-territory** rollups.
`tenant_id`, `brand_entity_id`, `date`, `dimension`, `territory`, `score`, `signal_count`,
**unique `(brand_entity_id, date, dimension, territory)`**.
Written by `rollupDimensionScores()` in `apps/ingestion/src/rollup.ts`, exposed as
`POST /rollup`. The unique constraint is what makes that upsert idempotent, so a retried or
manually re-triggered run overwrites rather than duplicating.

> **`territory` is `NOT NULL` with an `'all'` sentinel, and that is load-bearing.** Postgres treats
> NULLs as DISTINCT in a unique constraint, so a nullable column would let the aggregate row
> violate uniqueness silently: `ON CONFLICT` would stop matching and the hourly upsert would start
> APPENDING a duplicate set of rows every hour, forever, with no error anywhere.
>
> The constraint is also **named explicitly** (`dimension_scores_brand_date_dim_territory_uniq`).
> Drizzle's default name would be 64 characters — one over Postgres's identifier limit — so the
> server truncates it while drizzle's snapshot records the full name, and the first future
> migration that drops or renames it would fail against a real database while passing every test.
>
> **Any read of this table must filter `territory`.** It holds one row per territory _plus_ the
> `'all'` row for the same `(brand, date, dimension)`, so an unfiltered read returns the aggregate
> and each of its parts together — the history chart plots several points per day and the totals
> double-count. `/score` and `/dimension-scores` default to `'all'`.

**`source_configs`** — one row per configured feed; drives ingestion.
`tenant_id`, `brand_entity_id`, `source`, `label`, **`territory`** (default `unknown`),
`is_enabled` (default true), `config` JSONB (default `{}`), `last_fetched_at`,
`last_attempted_at`, `last_error`, timestamps.

`territory` is the **authority** for a signal's territory, validated against `TERRITORIES` in
shared-types on write — a bare varchar would accept `UK`, which ISO does not assign, splitting
Great Britain across two values that no report could reconcile. It sits on the FEED rather than
the brand because a brand is not British: `@TeachStarterUSA` and `@TeachStarter` are the same
product in two countries, which is exactly how the marketing team's channel sheet is organised.
`normaliseTerritory` corrects the spellings that sheet actually uses (`UK`, `AUS`, `USA`) and
**refuses** anything ambiguous — including its six `Global?` entries, where the question mark is
the author saying they are unsure.

The JSONB `config` shape varies by source (documented in `sourceConfigs.ts`):

| source           | config shape                 |
| ---------------- | ---------------------------- |
| `google_reviews` | `{ placeId, placeName? }`    |
| `youtube`        | `{ channelId, maxResults? }` |
| `app_store`      | `{ appId, country? }`        |
| `play_store`     | `{ appId }`                  |
| `rss`            | `{ feedUrl }`                |

**`tracked_actions`** — an action somebody committed to, and what happened afterwards.
`tenant_id`, `brand_entity_id`, `topic`, `territory`, `status`, `baseline_at`, `baseline_index`,
`baseline_damage`, `baseline_volume`, `ceiling_delta`, `accepted_by`, `note`, `completed_at`.

What turns the roadmap from a list into an experiment log. Two rules make it worth keeping:

- **The `baseline_*` columns are stamped once and never updated.** A baseline cannot be
  retrofitted — a row created after the work began has to guess where the index stood, and a
  guessed baseline makes every later verdict a guess too. This is why outcome tracking was built
  _before_ the playbook rather than after it.
- **`ceiling_delta` is stored rather than recomputed.** It is a claim made at a moment in time, and
  the point is to check it later. Recomputing would rewrite the prediction to match the outcome.

There is deliberately **no `verdict` column**. The outcome is computed on read from today's
numbers, because a stale verdict — "improved", on a subject that has since collapsed — is worse
than none. Same reasoning as the portfolio index.

**`crm_connections`** — one tenant's link to their CRM.
`tenant_id`, `provider`, `instance_url`, `secret_arn`, `scopes`, `connected_by`, `status`,
`last_synced_at`, `last_attempted_at`, `last_error`, **unique `(tenant_id, provider)`**.

**The token is not in this table, or in any table.** `secret_arn` points at Secrets Manager;
`source_configs.config` — the obvious home — is plain JSONB, readable by anyone with database
access and trivially dumped into a log, and unlike an API key an OAuth refresh token grants
standing access to a customer's commercial records. `last_attempted_at` / `last_error` mirror
`source_configs` so an expired grant shows _why_ on the row somebody can fix.

**`accounts`** — the customer a CRM interaction is about.
`tenant_id`, `provider`, `external_id`, `name`, `domain`, `segment`, `arr_band`, `owner_name`,
`territory`, **unique `(tenant_id, provider, external_id)`**.

A new axis, orthogonal to brand, product and territory. Reusing `brand_entities` was rejected: a
customer is not a brand, and hundreds in that tree would pollute the brand switcher, the portfolio
rollup and competitor comparison at once. `arr_band` is a **band and never a figure** — enough to
rank a theme by commercial exposure, not enough to constitute revenue data.

**Credentials are never stored in `source_configs`.** System-level API keys
(`APIFY_API_KEY`, `YOUTUBE_API_KEY`) come from env/Secret Manager and are merged in at
runtime by the ingestion handler.

### Migrations

Seven migrations exist, tracked in `apps/api/migrations/meta/_journal.json`:

| Tag                       | Contents                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `0000_hot_loners`         | `tenants`, `brand_entities`, `signals` + indexes                                            |
| `0001_fluffy_guardsmen`   | `users`, `sentiment_results`, `dimension_scores`                                            |
| `0002_slippery_energizer` | `source_configs`                                                                            |
| `0003_amused_moondragon`  | Unique `(source_url, brand_entity_id)` on `signals`                                         |
| `0004_chief_freak`        | `brand_aliases`                                                                             |
| `0005_demonic_mindworm`   | Drops the four denormalised sentiment columns from `signals`                                |
| `0006_familiar_vermin`    | Adds `brand_entities.dimension_weights` jsonb (per-brand BPI weights)                       |
| `0007_productive_patriot` | `conversations`, `conversation_messages` — assistant history, scoped by tenant **and** user |

Authoring a new migration: edit the schema in `libs/db/src/schema/`, then run
`yarn db:generate` (→ `nx run @project-signal/api:generate` → `drizzle-kit generate`). Never hand-write
migration SQL; never apply migrations from a worker.

---

## 5. Shared libraries

### `libs/shared-types`

Pure type declarations, zero runtime dependencies. `SignalSource` (9 values — 5 implemented,
4 reserved: `trustpilot`, `news_api`, `x`, `survey`), `Dimension`, `SentimentLabel`, and the
`Signal`, `SentimentResult`, `BrandPerceptionScore`, `Report` interfaces.

### `libs/config`

A single memoised `getEnv()` backed by a zod schema. Throws on invalid environment at first
call.

The important subtlety is **the two database connection modes**:

- `DATABASE_URL` — local TCP (docker-compose Postgres).
- `DB_SOCKET_PATH` + `DB_NAME` + `DB_USER` + `DB_PASSWORD` — Cloud Run via the Cloud SQL Auth
  Proxy.

A `.refine()` requires one of the two. The split exists because the Cloud SQL socket path
(`/cloudsql/project:region:instance/.s.PGSQL.5432`) contains colons that break postgres-js
host parsing, so it must be passed as `path`, not embedded in a URL.

Other keys: `CORS_ORIGINS` (comma-separated; unset = reflect any origin, which is safe here
because auth is Bearer-only with no cookies or ambient credentials), `ITEM_QUEUE_URL`,
`REPORT_QUEUE_URL`, `SCAN_QUEUE_URL`, `RAW_BUCKET`, `SCORER_MODEL`, `REPORTER_MODEL`,
`ASSISTANT_MODEL` (all three default to `eu.anthropic.claude-haiku-4-5-20251001-v1:0`),
`APIFY_API_KEY`, `YOUTUBE_API_KEY` and `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID`.
`GOOGLE_CLOUD_PROJECT` is no longer in the schema.

**Auth mode.** `AUTH_MODE` is `cognito` (default) or `local`. `local` requires
`LOCAL_AUTH_PASSWORD` (≥ 12 characters) and a `.refine()` **rejects `AUTH_MODE=local` under
`NODE_ENV=production`** — local mode accepts unsigned tokens, so it can never be implied. Before
2026-11-16 unsigned dev tokens were accepted whenever `NODE_ENV` was `development`, which is the
schema default, so any process launched without `NODE_ENV` trusted them.

**Runtime resource tags.** `RESOURCE_TAGS` is an optional JSON object of strings; Terraform
injects the stack's mandatory tags into the API task, and the API stamps them on the CRM secrets
it creates at runtime (which `default_tags` cannot reach). Unset locally.

**Bedrock from a laptop.** `BEDROCK_AWS_PROFILE` / `BEDROCK_REGION` are optional and local-only
— see `libs/llm` below. Deployed tasks leave them unset.

Models are named by **use case** (`SCORER_MODEL` / `REPORTER_MODEL`), not by provider, so the
underlying model can be swapped without touching code. That property is what let the move from
Vertex to Bedrock leave every call site alone.

**AWS credentials and region are deliberately NOT in this schema.** They resolve through the
SDK's default provider chain — the ECS task role in a deployed environment, `AWS_PROFILE` or a
LocalStack endpoint locally. No code holds a key.

One subtlety worth knowing before you edit it: **the queue URLs have no defaults and throw when
unset.** An SQS URL embeds the account id and region, so no constant could stand in for one, and
a wrong guess publishes into nowhere. This is the AWS form of the fix for KNOWN-GAPS #7.

### `libs/db`

Drizzle schema plus a lazily constructed postgres-js client.

```ts
import { db, client, createSql } from '@project-signal/db';

db.get(); // drizzle instance (schema-aware)
client.get(); // raw postgres-js tag — used for `SELECT 1` health pings
createSql(1); // fresh pool with an explicit max; used for migrations
```

It also holds **shared query predicates** (`src/queries.ts`), of which there is currently one.

```ts
import { attributedTo } from '@project-signal/db';

.where(and(attributedTo(brandEntityId, tenantId), gte(signals.publishedAt, since)))
```

`attributedTo` is **the** definition of "this brand's signals": the foreign key **or** a
`signal_mentions` row, EXISTS rather than a join so one signal stays one row. It lives here
rather than in an app because it used to live in `apps/ingestion/src/rollup.ts` and be used only
there, while every read path in the API filtered on the foreign key alone — so the Brand
Perception Index counted signals that merely mention a product and the evidence lists explaining
that index did not. A product covered in group-level articles scored on the dashboard with a
drill-down showing fewer signals than the number above it, which is KNOWN-GAPS #26's failure
arriving through a different door.

`tenantId` is a **required parameter**, not something the caller `and`s on separately, and the
EXISTS subquery filters it too. There is no row-level security in this product, so a predicate
that is only safe when the call site remembers something is not safe.

Its third parameter, `voice`, **defaults to `direct`**, and that default is the same lesson applied
again. A CRM note is written _because_ something needs attention, so that channel is a work queue
rather than a sample and is negative by construction; averaging it into the index would move the
number for reasons unrelated to brand perception while still looking plausible. Rather than adding
a filter every read path must remember — which is exactly how six of them drifted from the rollup
in #29 — the safe answer is the default, and including reported voice has to be an explicit act.
Only `/brands/:id/voice-of-customer` passes `'reported'`. Its rendered SQL is covered
in `apps/api/test/routes/attributed-to.test.ts` against drizzle's real dialect — a mocked database
never renders SQL, which is how two `Date`-serialisation defects reached production.

Both `db` and `client` are lazy getters, not eagerly constructed clients — importing the lib
does not open a connection, which matters for tests and for container cold starts.

### `libs/llm`

Provider-neutral LLM access, on **Amazon Bedrock**. Formerly `libs/gemini` / Vertex AI.

```ts
interface LlmClient {
  structured<T>(request: StructuredRequest): Promise<T>;
}
```

**One method, and deliberately the structured one.** The pipeline never wants free text: every
call site needs a value of a known shape. `getLlmClient()` returns a memoised
`BedrockLlmClient`; `getScorerModel()` / `getReporterModel()` resolve the model by use case.

**Structured output comes from forced tool use, not from prompting.** The model is given exactly
one tool whose input schema _is_ the shape wanted, with `toolChoice` forcing it, so Bedrock
returns a parsed object. This replaced a prompt that asked for "ONLY valid JSON", a ` ```json `
fence-stripper, and a `JSON.parse` — and it is a correctness change, not tidying. A model that
wrapped its answer in a sentence used to raise `PermanentScoringError`, **which acks the
message**, so the signal was dropped permanently and silently. **If you change this lib, do not
reintroduce prose-then-parse.**

The client exposes two methods with genuinely different jobs. `structured()` forces a single tool
whose schema _is_ the shape wanted, and is what the scoring pipeline uses — it never wants prose.
`converse()` runs one round of a tool-using exchange and is what the assistant uses. The **loop is
not in this library**: running a tool is an authorisation decision, and the provider adapter must
not be what makes it. See `apps/api/src/assistant/agent.ts`.

`structured()` takes an optional `system` prompt and a `maxTokens` (default 1024), and **throws
on `stopReason = max_tokens`** rather than returning a truncated tool call. Its type parameter is
**unchecked** — the provider guarantees a tool call, not that its fields are in range — so every
caller validates (the scorer's `validateScore`, for instance).

**Endpoint and credentials.** The Bedrock client **ignores `AWS_ENDPOINT_URL`**: LocalStack has
no Bedrock, and honouring the override sent every local LLM call to LocalStack. When
`BEDROCK_AWS_PROFILE` is set (local only, e.g. `psignal-dev`), it is passed as the client's
`profile`, which makes the SDK skip the LocalStack `test` keys in the environment
(`@aws-sdk/credential-provider-node`, `defaultProvider`). `BEDROCK_REGION` overrides
`AWS_REGION`. Deployed tasks set neither and use the task role.

> **Model ids on Bedrock are inference profiles**, and availability is per account and changes.
> The bare `anthropic.claude-…` id is rejected with _"on-demand throughput isn't supported"_; the
> `eu.` prefix scopes routing to EU regions and `global.` variants exist that do not.
>
> **Listing a profile does not mean this account may invoke it.** Verified 2026-08-08T23:39Z in
> `290304998906`: only `eu.anthropic.claude-sonnet-5` and `eu.anthropic.claude-opus-5` answered.
> Seven others — Haiku 4.5 among them, which was the deployed `SCORER_MODEL` — returned
> `ResourceNotFoundException: Model use case details have not been submitted`, while still
> appearing in `list-inference-profiles`. Six of those seven were answering an hour earlier the
> same evening. Verify by invoking, at the moment of use. See `docs/OWNER-ACTIONS.md` #1.

### `libs/help-content`

The user-facing help corpus: 18 articles, five categories, and the first-run tour definition.

Typed objects, not markdown files. Two consumers need it — the web help centre in a browser and
the API assistant in Node — and a directory of `.md` files would need a loader in each, which
would drift until the assistant answered from an article the UI does not show. One module, both
import it, and the compiler checks every cross-reference. Article bodies are still markdown,
because prose wants to be prose.

`searchHelp()` is weighted field matching, deliberately not a vector index: the corpus is a few
dozen short articles that ship with the code, and an embedding index would add a build step, a
storage decision and a staleness problem to a search over ~20k words. It applies a **relevance
floor** — on a query of three or more words, matching fewer than half of them is coincidence, and
handing a weak hit to the assistant turns it into a confident wrong answer with a source attached.

Tests pin the constants the articles quote (half-life, dimension names, default weights, the
Brand impact top-N) against `libs/scoring`. Change the scoring model and the help centre fails the
build rather than silently becoming a liar the assistant then cites.

### `libs/messaging`

The publish side of the pipeline, on **SQS**. Formerly Pub/Sub.

```ts
interface MessagePublisher {
  publish(queue: 'item' | 'report', body: string): Promise<string>; // → message id
}
```

**Callers name a logical queue and nothing else.** Resolving that to a concrete URL is
`queueUrl()`'s job, reading `ITEM_QUEUE_URL` / `REPORT_QUEUE_URL`. There is **no fallback
constant and an unset variable throws**, naming the missing variable — unlike the Pub/Sub design
this replaced, where publishing to a hardcoded topic that existed in no deployed environment
failed silently (KNOWN-GAPS #7).

`publish()` also throws when SQS returns no `MessageId`, rather than reporting a publish that
may not have happened.

**The consume side is `SqsConsumer`** (`src/consumer.ts`): long polling, delete only after the
handler succeeds, back-off on receive errors, graceful stop. **While a handler runs it extends
the batch's visibility** (`ChangeMessageVisibilityBatch`) every third of the visibility timeout
(default 300 s), covering every message of the batch, whose clocks started together. Without
that, a scan sweep longer than the timeout became visible again mid-run and could be processed
twice. Heartbeat and delete failures go to `onError` and never fail the handler.

### `libs/storage`

Object storage for raw ingested payloads, on **S3**, behind a deliberately narrow interface:

```ts
interface ObjectStore {
  put(key: string, body: string, contentType?: string): Promise<string>; // → s3://…
  get(key: string): Promise<string>;
}
```

`getObjectStore()` returns a memoised `S3ObjectStore` built from `RAW_BUCKET`, throwing a named
error if it is unset. `rawKey(tenant, brand, source, externalId)` builds the deterministic key
(percent-encoding `externalId`, which can contain slashes); `keyFromRef()` parses a stored
reference back to a key and accepts **both `s3://` and `gs://`** — the latter costs nothing and a
reference that cannot be resolved is unrecoverable.

`get()` throws when a response carries no body rather than returning `''`. An empty string would
be scored as though it were the review text — a silent data fault of the same class as
KNOWN-GAPS #4.

Two methods is the whole surface. That narrowness is exactly what made replacing GCS with S3 a
single-file change plus one line in the factory.

### `libs/scoring`

The Brand Perception Index, implemented straight from the product spec. Pure functions with no
I/O, so the whole engine is unit-testable without a database:

```ts
recencyWeight(publishedAt, asOf); // 2^(-age/90d) — spec's 90-day half-life
scoreDimension(items, dimension, asOf); // weighted by recency × confidence → 0–100
compositeScore(rollups, weights); // the BPI; per-brand weights, renormalised
clusterTopics(items, asOf); // damage = Σ negativityᵢ × recencyᵢ (strength: Σ positivityᵢ × recencyᵢ)
brandImpact(clusters); // top 3 by damage, zero-damage excluded
```

**Damage is summed per item** (since 2026-11-16). It was volume × mean negativity × mean recency,
so an old negative item plus a new positive one still read as recent damage; taking both factors
from the same item keeps the spec's "volume × negative sentiment × recency". Item `score` and
`confidence` are **clamped** (and non-finite values zeroed) before weighting, so one out-of-range
model output cannot skew a dimension or produce a negative weight. Topics are **de-duplicated
within a signal**, as `change.ts` already did, so cluster volumes agree across views.
`normaliseTopic`, `MS_PER_DAY` and `LOOKBACK_DAYS` are single-sourced here.

`src/change.ts` adds **period-over-period movement** — what the index _did_, as opposed to what it
_is_:

```ts
splitPeriods(items, asOf, days, basis); // equal-length windows, future-dated items dropped
summariseChange(items, firstSeen, opts); // new / rising / falling / improving / worsening
summariseSources(current, previous); // the same movement per source
```

Three things in it are easy to get subtly wrong, and each has a comment saying why:

- **`basis`** — `ingested` answers "what did we learn", `published` answers "what did the world
  say". A backfilled two-year archive is a surge under the first and nothing under the second, so
  the endpoint echoes which one it used and `backfilledThisPeriod` is reported separately.
- **`isNew` is a claim about all history**, which is why `firstSeen` is read by its own unbounded
  query. A topic returning after a quiet spell is not new, and treating it as new sends someone
  hunting a cause that is months old.
- **Volume movement and sentiment movement are different axes.** A topic discussed exactly as much
  as last week whose sentiment fell from +0.5 to −0.5 appears in neither `risingTopics` nor
  `fallingTopics` — hence `improvingTopics` / `worseningTopics`, ranked by
  `|sentimentDelta| × volume` past a `SENTIMENT_MOVE_THRESHOLD` floor so re-scoring noise does not
  fill the page.

Absent comparisons are `null`, never `0`, throughout — the distinction that `▲ +0` lost.

`src/target.ts` adds **targets, what an action is worth, and whether it worked**:

```ts
resolveTarget(ownerTarget, benchmarks);   // owner > competitor median > internal best > null
counterfactual(items, topic, asOf);       // the CEILING: composite with that subject neutralised
project(items, asOf, target);             // where it goes with no new signals
evaluateOutcome({ baseline…, current… }); // improved | unchanged | worsened | unmeasurable
```

Three things here are counter-intuitive and each is load-bearing:

- **Decay does NOT move the score.** The obvious model — old complaints fade, the index recovers —
  is arithmetically false. `scoreDimension` is a weighted mean, and advancing `asOf` multiplies
  every weight by the same constant `2^(-T/90)`; a weighted mean is invariant under a uniform
  rescaling. What actually moves it is the **lookback cut-off**, as the oldest signals leave the
  window entirely. A test pins the invariance so the comfortable assumption cannot return.
- **The counterfactual neutralises rather than removes.** Dropping a subject's items would also
  drop its positive mentions and change every count, overstating the gain — wrong in the direction
  that flatters us.
- **`unmeasurable` is a verdict, not an error.** "We measured and nothing moved" and "we cannot
  tell yet" are different claims.

`src/exposure.ts` ranks the CRM channel by **distinct accounts × commercial band** rather than by
volume, and `corroborate` finds subjects raised both publicly and privately — matched exactly,
because a false corroboration is far more damaging than a missed one.

### `libs/playbook`

Curated interventions, matched to evidence rather than generated from it. A model asked "what did
others do about this" answers fluently with a company, a percentage and a date, none of it
checkable — and a play arriving through a pull request means the review that admits it is the
review that checks its citation.

Every play ships `evidenceStatus: 'none'` and says so on screen. A test enforces that no play can
claim external evidence without a URL and a stated relevance. The stronger evidence is the kind
this product earns: once `tracked_actions` shows a play used several times with a measured capture
rate, that evidence is ours and specific to this brand.

Plays rank by **specificity**, or the near-universal ones win every match. `playsFor` may return
nothing — "no play applies" is a real answer, and a generic fallback is how a roadmap becomes
wallpaper.

Two decisions worth knowing before you change them. A dimension with no items scores `null`,
not 0 — absence of data is not the same as uniformly negative sentiment. And `compositeScore`
renormalises weights across the dimensions that _do_ have data, so a brand with no `value`
coverage is not silently penalised.

`brand_entities.dimension_weights` (jsonb, nullable) holds the per-brand weighting; null means
the equal default. It is operator-supplied, so `parseWeights` in the rollup validates it and
discards anything non-numeric, negative or unrecognised.

### `libs/source-adapters`

The extension point for new data sources. The contract:

```ts
interface SourceAdapter {
  readonly source: SignalSource;
  fetch(config: AdapterConfig, since?: Date): Promise<FetchResult>; // → RawItem[]
  toSignal(
    item: RawItem,
    config: AdapterConfig,
  ): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'>;
}
```

`AdapterConfig` carries `brandEntityId`, `tenantId`, `source`, and a flat
`credentials: Record<string, string>` map — into which the ingestion handler merges _both_
the system API keys and the per-brand `source_configs.config` JSONB. That is why an adapter
reads `config.credentials['placeId']` even though a place ID is not a secret.

`RawItem` is the normalised intermediate: `externalId`, `url`, `text`, `publishedAt`,
`metadata`.

**Implementations:**

| Adapter                | Mechanism                                         | Key config                        | Notes                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GoogleReviewsAdapter` | Apify actor `compass~google-maps-reviews-scraper` | `placeId`                         | `maxReviews: 100`; `since` → `cutoffDate` and re-applied locally; empty-text reviews dropped                                                                                   |
| `AppStoreAdapter`      | Apple's public iTunes customer-reviews RSS        | `appId`, `country` (default `us`) | No key, no quota; joins title + body as text; drops empty                                                                                                                      |
| `PlayStoreAdapter`     | Apify `neatrat~google-play-store-reviews-scraper` | `appId`                           | Newest first; `since` filtered locally; drops empty content                                                                                                                    |
| `RssAdapter`           | `fetchPublic` + `fast-xml-parser`                 | `feedUrl`                         | Handles **both RSS and Atom**; filters by `since` client-side; no API key needed; **SSRF-guarded** (below)                                                                     |
| `RedditAdapter`        | Apify `trudax~reddit-scraper-lite`                | `query`, `subreddit` (optional)   | Posts only (`searchComments: false`); `searchCommunityName` scopes to a subreddit; title + body joined as text; `since` filtered client-side                                   |
| `YoutubeAdapter`       | YouTube Data API v3                               | `channelId`                       | Last 10 videos → up to 50 top-level comments each; `since` filters **comments**, never the video search; only a `commentsDisabled` 403 is skipped — quota and other 403s throw |

Every item with empty text or no external id is dropped; `toSignal`, `toArray` and the watermark
filter live once in `src/common.ts`.

**Outbound HTTP (`src/http.ts`).** `fetchWithTimeout` gives every direct call a 30 s timeout
(`fetch` has none by default, so one silent source held a whole scan open). `fetchPublic`, used
for the tenant-configured RSS URL, allows only http(s), resolves the host and **rejects private,
loopback, link-local (including the instance-metadata address), CGNAT, multicast and IPv4-mapped
addresses across all DNS answers**, following at most 5 redirects and re-checking every hop —
before this, a tenant could point a feed at anything inside the VPC. The residual DNS-rebinding
window between the check and the connection is documented in the file; closing it needs a
pinned-lookup agent.

> **Reddit goes through the existing Apify account, not Reddit's own API.** The key and the
> billing already exist and are already wired through `getSystemCredentials`, so there is no second
> credential to provision and no OAuth app to register. Reddit's public JSON endpoint needs no key
> at all and would work from a laptop, but it answers a datacentre-hosted client with 429 — from
> inside a Fargate task that presents as an intermittent, unexplained failure. The residential
> proxy is the thing being paid for.
>
> **The actor id and every field name below were verified against the live API, not remembered.**
> Actor `trudax/reddit-scraper-lite` (`oAuCIx3ItNrs2okjQ`, build 5.7.9); the input schema was read
> from `GET /v2/actor-builds/{id}` and the output shape from two real runs on 2026-08-09 —
> `id, parsedId, url, username, title, communityName, parsedCommunityName, body, html, createdAt,
scrapedAt, dataType`. `libs/source-adapters/test/reddit.test.ts` uses that shape verbatim. This
> repository has twice shipped a model id written from memory; an actor's output schema decays the
> same way, and a test built on invented field names passes forever while the adapter collects
> nothing.

`apifyClient.ts` is the shared Apify runner used by the four Apify-backed adapters:
`startApifyRun` → `waitForApifyRun` (poll every 5s, 5-minute deadline, throws on
FAILED/TIMED-OUT/ABORTED and on the free-plan refusal signatures; **aborts the run when the
deadline passes**) → `fetchApifyDataset`. The token travels in an `Authorization: Bearer` header,
not the query string.

**To add a source:** implement `SourceAdapter`, export it from `libs/source-adapters/src/index.ts`,
register it in the `ADAPTERS` map in `apps/ingestion/src/handler.ts`, add its credential
mapping to `getSystemCredentials()` if it needs a key, and add its form fields to
`SOURCE_FIELDS` in `apps/web/src/components/BrandManager.tsx`.

---

## 6. apps/api — REST API

Fastify 5, port **8080**, ESM. Target: a public ECS Fargate service behind an ALB.

### Boot sequence (`src/main.ts` → `src/app.ts`)

`main.ts` calls **`buildApp()`** (`src/app.ts`), runs **`runMigrations()`**, then
`listen(PORT, listenHost())`. `listenHost()` (`libs/config`) is `0.0.0.0` under
`NODE_ENV=production` (every Dockerfile and ECS task) and `127.0.0.1` otherwise, so local sign-in is
never reachable from the network; `HOST` overrides it. All four backends use it. `buildApp()` is separate so the integration suite exercises the
production wiring, in this order:

1. `httpBasics` (`src/lib/http.ts`): `@fastify/sensible` plus the **error boundary** (below)
2. `@fastify/cors` — allowlist from `CORS_ORIGINS`, else reflect any origin
3. `@fastify/swagger` + `@fastify/swagger-ui` → OpenAPI docs at **`/docs`**, with a
   `BearerAuth` security scheme
4. Auth plugin, then **rate limiting** (after auth, so it can key on the user)
5. `routes/health.ts`, `routes/local-auth.ts` (registers nothing unless `AUTH_MODE=local`), then
   every other route plugin

**Error boundary.** An unhandled 5xx is logged in full and answered with a generic message and
the request id. Before 2026-11-16 there was no handler, Fastify returned `error.message`, and
drizzle's message is `Failed query: <sql> params: <params>` — reachable with a non-uuid id.
Postgres client errors map to 4xx: `22P02`, `22007`, `22008` → 400; `23505`, `23503` → 409.
5xx messages written deliberately (`reply.serviceUnavailable('…')`) pass through.

**Rate limiting** (`src/lib/rate-limit.ts`, `@fastify/rate-limit`) is keyed **per user**, not per
IP — the assistant's tool calls re-enter the API via `inject` from 127.0.0.1, and many users share
an egress address. Default 600/min (one Dashboard load is ~12 requests; 300 was reachable by a
person switching territories); `POST /assistant/messages` 10/min; `POST
/brands/:id/roadmap/adapt` 20/min; `POST /auth/local/sign-in` 10/min.

**Health.** `/health` is liveness. `/ready` runs `select 1` and returns **503** when the database
is unreachable.

**Validation.** Every request body declares `additionalProperties: false`, every id
`format: 'uuid'`, strings carry length limits, and date query parameters are validated. Fastify
only strips undeclared keys when `additionalProperties: false` is set — its absence is how
`PATCH /admin/users/:id` became a mass-assignment hole (KNOWN-GAPS #31).

**Tenant ownership on writes.** `brandInTenant()` (`src/lib/tenancy.ts`) is the check that a
brand id named in a body or path belongs to the caller's tenant. A foreign key only proves the
brand exists _somewhere_; aliases, integrations, scan and the user brand pin all go through it.

### Migrations on startup (`src/migrate.ts`)

The API is the **single schema owner**. On boot it:

1. **Throws** if the `migrations/` directory is absent (it used to skip silently, so an image
   built without the folder booted against a stale schema).
2. Opens a **dedicated single connection** (`createSql(1)`) and sets `lock_timeout` (5 min), so
   a hung lock holder fails the boot instead of blocking it forever.
3. Takes Postgres advisory lock `4815162342` so concurrent instances serialise
   rather than racing.
4. Runs Drizzle's migrator.
5. Releases the lock **only if it was taken**, preserving the original error, and ends the
   connection in a `finally`.

No manual migrate step, no separate migrator job or container. Workers never migrate.

### Auth and RBAC (`src/plugins/auth.ts`)

A `fastify-plugin`-wrapped global `onRequest` hook:

- **Public paths, matched exactly:** `/health`, `/ready`, `/docs` and `/docs/…`, plus
  `/auth/local/sign-in` in local mode. (This was `startsWith`, which would have made any future
  `/healthcheck-…` route public.) Everything else requires `Authorization: Bearer <token>`.
- In `AUTH_MODE=cognito` (the default), the **Cognito ID token** is verified with
  `aws-jwt-verify` (`CognitoJwtVerifier`, `tokenUse: 'id'`), and its `custom:role`,
  `custom:tenantId`, `custom:brandEntityId` attributes populate `request.user`. The role claim is
  validated against the enum, because `requireBrandAccess` constrains only the literal `'user'`:

  ```ts
  type UserClaims = {
    uid: string;
    tenantId: string;
    role: 'owner' | 'admin' | 'user';
    brandEntityId?: string;
  };
  ```

- `request.user` is installed via `decorateRequest` with a symbol-keyed getter/setter (Fastify
  5 forbids sharing a mutable object across requests).
- **Local mode (`AUTH_MODE=local` only — never implied by `NODE_ENV`, refused in production):**
  a token of the form `dev:<role>:<tenantId>[:<brandEntityId>][:<uid>]` is parsed directly,
  strictly (role from the enum, uuids for tenant and brand). Colon-delimited because the ids are
  UUIDs. `POST /auth/local/sign-in` (`src/routes/local-auth.ts`) issues one: it takes
  `{username, password}`, compares the password with `LOCAL_AUTH_PASSWORD` in constant time,
  looks the user up by the `users` row's identity-provider id (= the username), returns an
  identical 401 for an unknown
  user or a wrong password, and responds `{token, user: {username, role, tenantId,
brandEntityId}}` built from the `users` row. In local mode `setUserClaims` is a no-op — the row
  _is_ the claim. `yarn db:seed` creates `local-owner`, `local-admin` and `local-user` (pinned to
  the owned brand).

`requireRole(...roles)` is a preHandler factory returning `reply.forbidden()` on mismatch:

```ts
fastify.get('/admin/users', { preHandler: requireRole('owner', 'admin') }, handler);
```

### Routes

Two response conventions coexist — the newer route files wrap in `{ status, data }`, the
older ones return bare rows. Both are documented below because the frontend depends on the
difference.

| Method & path                       | Role         | Response shape       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/tenants`               | owner        | bare                 | **Transactional**: creates tenant + owned brand + admin user row in one `db.transaction`. Slugs are derived from names; a slug collision is **409**. Refuses an owner naming themselves as the new admin, which would have demoted their own claims.                                                                                                                                                                                        |
| `POST /admin/users`                 | owner, admin | bare row             | `{cognitoSub, role, brandEntityId?, tenantId?}`: the tenant comes from the CALLER (an owner may name one); no `email`. Row **and** claims written in one transaction. An `admin` is confined to their own tenant and to the roles admin/user.                                                                                                                                                                                               |
| `PATCH /admin/users/:id`            | owner, admin | bare row             | Reads the target first, then updates **only** `role` and `brandEntityId` (named explicitly — never a spread of the body) and re-syncs claims in one transaction. `brandEntityId: null` clears the pin; a pin must belong to the user's tenant. 404 for a foreign tenant.                                                                                                                                                                    |
| `GET /admin/users`                  | owner, admin | bare array           | Users in the caller's tenant.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /brands`                       | any          | bare array           | Tenant-scoped. A `user` with a `brandEntityId` sees **only** that brand.                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /brands/:id`                   | any          | bare row             | Tenant-scoped + `requireBrandAccess`; 404 otherwise.                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /brands/tree`                  | any          | bare array           | The hierarchy as nested `children`. Built from one flat select in a map, not N queries. Orphans surface as roots rather than vanishing. A pinned `user` gets only their brand, as with `GET /brands`.                                                                                                                                                                                                                                       |
| `POST /brands`                      | admin, owner | bare row             | Create a brand or a product. `parentId` optional; the parent is checked inside the caller's tenant.                                                                                                                                                                                                                                                                                                                                         |
| `PATCH /brands/:id`                 | admin, owner | bare row             | Rename, re-type, re-own or re-parent. `parentId: null` promotes to a root — distinct from omitting it. Refuses cycles via `wouldCreateCycle`.                                                                                                                                                                                                                                                                                               |
| `DELETE /brands/:id`                | admin, owner | 204                  | **Only when nothing is attached.** 409 naming the blocker if it has children, signals, dimension scores, mentions, tracked actions or an assigned user. Aliases, source configs and scan runs are removed with it, **in one transaction**. See below.                                                                                                                                                                                       |
| `GET /brands/:id/signals`           | any          | `{items,nextCursor}` | Cursor pagination via `limit+1` lookahead; optional `?source=`, `?sourceConfigId=`, `?topic=`, `?dimension=`; `limit` max 100, default 50. Returns `content`/`title`/`author`/`rating` and a nested `sentiment` (LEFT join; null = unscored). `topic` and `dimension` are EXISTS sub-selects against `sentiment_results`, never joins — a join multiplies the signal row by its array members and breaks both the page size and the cursor. |
| `GET /brands/:id/sentiment-summary` | any          | object               | 30-day window; counts per label via `COUNT(*) FILTER (WHERE …)` plus `avg(score)`, joined signals→sentiment_results.                                                                                                                                                                                                                                                                                                                        |
| `GET /brands/:id/dimension-scores`  | any          | bare array           | Dimension history from `dimension_scores`, `from`/`to` optional, default last 90 days. Lives in `routes/scores.ts`.                                                                                                                                                                                                                                                                                                                         |
| `GET /brands/:id/score`             | any          | object               | Brand Perception Index for the latest rollup, its per-dimension breakdown, and the comparison point ≥7 days earlier.                                                                                                                                                                                                                                                                                                                        |
| `GET /brands/:id/score-history`     | any          | array                | The index per day (`compositeScore` with the brand's weights, territory-aware): the Dashboard sparkline.                                                                                                                                                                                                                                                                                                                                    |
| `GET /brands/:id/territories`       | any          | array                | Territories of the brand's feeds and attributed signals, tenant-filtered, `all` excluded: feeds the territory picker for every role.                                                                                                                                                                                                                                                                                                        |
| `GET /brands/:id/brand-impact`      | any          | bare array           | Top topic clusters by damage, computed on read from `sentiment_results`. `limit` defaults to 3.                                                                                                                                                                                                                                                                                                                                             |

> **Every brand-scoped read counts the same population.** `/signals`, `/sentiment-summary`,
> `/brand-impact`, `/topics`, `/strengths` and `/stats` all filter through `attributedTo`
> (see [`libs/db`](#libsdb)), which is the predicate the hourly rollup uses. Until 2026-08-17 they
> filtered on `signals.brand_entity_id` alone while the rollup also counted mentions, so a score
> and the evidence offered for it were computed from different sets of rows. **Any new
> brand-scoped read must use `attributedTo` rather than `eq(signals.brandEntityId, …)`.**
> | `GET /brands/:id/strengths` | any | bare array | The mirror of `/brand-impact`, ranked by `volume × positivity × recency`. `limit` defaults to 3. |
> | `GET /brands/:id/topics` | any | bare array | **Every** cluster, optionally `?dimension=`, ranked by `volume × recency` — positive, negative and NEUTRAL alike. `limit` defaults to 12. Exists because `/brand-impact` and `/strengths` are both _signed_ rankings that exclude the middle, so neither can answer "what is this dimension made of". See the note below. |
> | `GET /brands/:id/roadmap` | any | object | **What to fix, what it is worth, and what you are aiming at.** Per action: damage share, the matched play from `libs/playbook`, and `ifResolved` — a computed counterfactual re-running the composite with that subject's negativity neutralised. Plus the target and its provenance, the gap, the measured benchmarks, and a projection. Every figure is measured or computed; **no external benchmark is imported, because none exists for this index**. |
> | `PATCH /brands/:id/target` | admin, owner | object | Set or clear the brand's target index. `null` clears it back to a competitor-derived default — there has to be a way back from a target set in error. |
> | `POST /brands/:id/roadmap/actions` | any | object | Commit to an action; stamps the immutable baseline. |
> | `GET /brands/:id/roadmap/actions` | any | bare array | The log, with each outcome computed on read. |
> | `POST /brands/:id/roadmap/adapt` | any | object | Rewrites a matched play in the language of the evidence. On demand, never on page load. `adapted: false` when the model was unusable and the curated wording is being shown. Open to every role (it rewords what the caller can already see); its risk is spend, so it is limited to 20/min per user. |
> | `GET /brands/:id/voice-of-customer` | any | object | What Sales and CS hear directly. Ranked by **distinct accounts × commercial band**, never by volume, plus the subjects raised both publicly and privately. `connected: false` distinguishes "no CRM" from "connected and quiet". |
> | `GET /crm/connections` | admin, owner | bare array | Linked CRMs and their health. Never returns a token or a secret ARN. |
> | `POST /crm/connections` | admin, owner | object | Stores OAuth tokens in Secrets Manager and records the link. Refuses Salesforce without an `instanceUrl`; `instanceUrl` must be https. The secret is tagged from `RESOURCE_TAGS` (always `Project` and `ManagedBy=api`); a secret still in its recovery window is restored before rewrite; a secret this call created is scheduled for deletion if the row insert fails. |
> | `DELETE /crm/connections/:id` | admin, owner | 204 | Disconnect. Schedules the secret for deletion with a recovery window rather than forcing it. |
> | `GET /brands/:id/whats-new` | any | object | **What changed** over `?days=` (default 7, max 90) against the equal-length period before it: `newTopics`, `risingTopics`/`fallingTopics` (volume), `improvingTopics`/`worseningTopics` (sentiment), `bySource`, and the period sentiment delta. `?basis=ingested\|published` — `ingested` is what _we_ learned (the honest basis for "new since the last scans"), `published` is what the world said (the right basis for trend); the response echoes the choice. `?source=` narrows it. Computed on read — see `libs/scoring/src/change.ts` for why there is no snapshot table and what would justify one. |
> | `GET /brands/:id/stats` | any | object | Dashboard stat row and the **coverage funnel**: this/previous week signal counts, `totalSignals` → `scoredSignals` → `classifiedSignals` → `lastRollupDate`, plus active/configured sources. `classifiedSignals` counts signals scored **and** tagged to ≥1 dimension; anything short of that reaches no index, no cluster and no drill-down. `classifiedSignals: 0` beside a non-zero `scoredSignals`, or a null `lastRollupDate`, is the signature of a brand silently falling out of the rollup. |
> | `POST /assistant/messages` | any | object | Ask the assistant. Read-only over BRAND data; it writes only the conversation record, in one transaction. History is loaded server-side — see below. 10/min per user. |
> | `GET /assistant/conversations` | any | bare array | The caller's **own** conversations, most recent first. Filtered by tenant **and** user. |
> | `GET /assistant/conversations/:id` | any | object | One conversation and its turns. 404 whether it is missing or someone else's. |
> | `PATCH /assistant/conversations/:id` | any | object | Rename. |
> | `DELETE /assistant/conversations/:id` | any | 204 | Delete; messages cascade. |
> | `GET /brands/:id/integrations` | admin, owner | bare | Every configured feed for the brand. **Many rows per source type are expected.** |
> | `GET /brands/:id/integrations/stats` | admin, owner | bare | Per feed: signals collected, newest signal, last run. LEFT JOIN, so a feed that has collected nothing is still returned — that row is the point. |
> | `POST /brands/:id/integrations` | admin, owner | bare | **Creates** a feed; returns **201**. No longer an upsert. **409** for an exact duplicate config (key-order-independent). |
> | `PATCH /brands/:id/integrations/:configId` | admin, owner | bare | Update `label`, `isEnabled` and/or `config`. `label: ""` clears it. 404 if absent. |
> | `DELETE /brands/:id/integrations/:configId`| admin, owner | bare | **Hard delete.** Signals survive — `signals.source_config_id` is `ON DELETE SET NULL`. Pausing a feed is `PATCH isEnabled:false`. |
> | `GET /brands/:id/aliases` | admin, owner | bare | List aliases. |
> | `POST /brands/:id/aliases` | admin, owner | bare | `onConflictDoNothing` → **409** when the alias already exists. |
> | `DELETE /brands/:id/aliases/:aliasId` | admin, owner | bare | Hard delete, tenant + brand scoped. |

Every route declares JSON Schema (`body` / `params` / `querystring` / `response`) so Swagger
output stays accurate and Fastify serialises responses fast.

**Many feeds per source type, and why the routes are keyed on `configId`.** `source_configs` used
to carry `unique(brand_entity_id, source)`, and `POST` upserted onto it, so a brand could hold one
feed of each type. The failure was silent: adding a second RSS feed did not error, it **overwrote
the first**, and the list then showed one row as though that had always been the whole
configuration. A brand tracking both `"Tes Global"` and `"Tes MyConcern"` on Google News could
only ever have one of them. The constraint was never load-bearing — `apps/ingestion` has always
worked off `source_configs.id` — so removing it (migration `0011`) and re-keying the routes was
the whole fix, plus a `label` column, because "rss" identifies nothing once there are six.

Two things follow that are easy to miss. `signals.source_config_id` records **which feed** produced
each signal, so a finding can be attributed to _"Google News — Tes MyConcern"_ rather than to
_"rss"_; `GET /brands/:id/signals?sourceConfigId=` filters on it. And the ingestion watermark is
**per feed**: it used to be `max(published_at)` over the brand and the source _type_, which meant a
busy hourly feed pushed the cutoff to now and a quieter feed on the same brand had everything it
published filtered out as too old, on every run, permanently — indistinguishable from nobody
talking about the brand.

**Where the readable evidence lives.** `signals` carries `content`, `title`, `author` and `rating`
(migration `0013`). Before them the verbatim text was written to S3 and never read back, so the
drill-down could show a source name, a date and a link — and nothing a person could read. `content`
is the normalised form: markup stripped, title joined to body, deduplicated, clamped to
`MAX_CONTENT_LENGTH`. `raw_storage_ref` and its S3 object remain, and `source_url` is still
returned and still rendered — **the link to the original is an addition, never a substitute.**

Normalisation happens in the ADAPTER (`libs/source-adapters/src/text.ts`), not at render time, so
the scorer sees the same words the user sees. This matters concretely: Google News RSS produced
225 of this tenant's 228 signals and its `<description>` is an anchor tag wrapping the headline,
so trust and quality scores were partly assigned to HTML. `joinTitleAndBody` and
`dedupeParagraphs` are **idempotent** — re-processing converges rather than compounds — which is
load-bearing, because the S3 payload is overwritten on re-collection and is therefore not the
immutable audit trail it was described as. See KNOWN-GAPS #28.

`GET /brands/:id/signals` returns those columns plus the scorer's verdict, LEFT-joined from
`sentiment_results` (safe for the keyset cursor: `signal_id` is `UNIQUE`). `sentiment: null` means
unscored, which is rendered differently from neutral. `POST /admin/backfill/content` recovers the
columns for rows collected earlier; `?force=true` clears and recomputes them when the
normalisation itself improves.

**Why `/topics` exists alongside `/brand-impact` and `/strengths`.** All three read the same
clusters out of `clusterTopics()`; the difference is which ones they throw away. `brandImpact`
keeps only `damage > 0` — _"a topic nobody is negative about is not a weakness"_ — and
`topStrengths` keeps only `strength > 0`. Both are correct as **summaries**, and both are wrong as
**evidence**, because between them they discard every neutral cluster and each discards the other
half of the sentiment range.

The drill-down's dimension level filtered `/brand-impact` by dimension, which produced a
contradiction the owner reported from the running product: level 1 said _"Experience — 5 signals
contributed"_ at a score of **69.2, the brand's highest**, and level 2 said _"No topic cluster has
been tagged to experience yet"_. Both statements were true. Experience scored highest **because**
its signals were positive, positive signals carry no damage, and `brandImpact` had therefore
excluded every one of its clusters. **The better a dimension performed, the more certain its
drill-down was to be empty** — on the one screen whose entire purpose is tracing a number to its
evidence.

`/topics` ranks by `volume × recency`, an unsigned measure, so neutral topics survive. And the
level now lists the contributing signals underneath the clusters **unconditionally**, via
`?dimension=` on `/brands/:id/signals` — so it degrades to "here are the five things" rather than
to a dead end when no topic has formed yet. Covered by `libs/scoring/test/score.test.ts`
(`topicsForDimension`) and `apps/web/test/drilldown-dimension.test.tsx`, which asserts on the URL
requested, because a test that only mocked the response would pass against the broken version.

**Why `DELETE /brands/:id` is so narrow.** Eight tables reference `brand_entities.id`: `signals`,
`dimension_scores`, `signal_mentions`, `scan_runs`, `brand_aliases`, `source_configs`,
`tracked_actions` and `users.brand_entity_id`. (`tracked_actions` was missing from the blockers
until 2026-11-16, so a brand with a committed action lost its feeds and aliases and then failed on
the foreign key with a 500; the check is now there and the deletes share one transaction.) Cascading through all of them would discard collected intelligence on a
misclick, and the `users` one is worse than that — `brand_entity_id` is an **authorisation scope**,
so nulling it silently widens what that person can see. There is no soft-delete column, and adding
one would mean teaching every read path to filter on it; miss one and archived brands quietly
reappear. So the route refuses whenever anything real is attached and names the specific blocker,
leaving exactly the case it was built for: an entity typed in wrongly a minute ago with nothing
behind it. **A wrong name is not a reason to delete** — that is what `PATCH` is for, and it keeps
the history. Covered by `apps/api/test/routes/brand-delete.test.ts` and, end to end, by
`apps/web/e2e/products.spec.ts`.

**Brand scoping.** Every `/brands/:id...` route — including `GET /brands/:id` itself — carries
the shared `requireBrandAccess` preHandler from `plugins/auth.ts`, which 403s when a `user`
pinned to one brand asks for another. The `tenant_id` filter in each query closes cross-tenant
reads; this closes the intra-tenant one (KNOWN-GAPS #5). An **unpinned** `user` is deliberately
not constrained, matching `GET /brands`, which returns the whole tenant when no pin is set;
`owner` and `admin` are never constrained. Any new brand-scoped route must add the preHandler —
the guard is not automatic.

### Ops script — `scripts/bootstrap-owner.ts`

Bootstraps the first owner for an environment: creates the **Cognito** user if missing and sets
`custom:role = owner`. Cognito emails the temporary password and forces a change on first
sign-in, so the script never prints or transmits one. Owner authorisation is claim-based, so **no
DB row is required** to bootstrap.

```bash
AWS_PROFILE=psignal-dev COGNITO_USER_POOL_ID=<pool id> npx tsx apps/api/scripts/bootstrap-owner.ts someone@example.com
```

Credentials come from the SDK default chain (the sandbox SSO profile). Not needed locally: in
`AUTH_MODE=local` the seed's `local-owner` is the owner.

---

### The assistant — `apps/api/src/assistant/`

Three modules and one route. Read them in this order; the design only makes sense as a whole.

**`tools.ts` — the security design.** Nine tools. `search_help` answers from
`libs/help-content` in process. The other eight are executed by **re-entering this API's own
routes through `app.inject()`**, carrying the caller's `Authorization` header. Nothing in the
assistant touches the database.

That indirection is the point. There is no row-level security in this product: tenant scoping is
applied by hand in every query, and `requireBrandAccess` is an opt-in preHandler that nothing
forces a new route to add (§4). A hand-written set of assistant queries would be a **second**
implementation of that scoping, written once and then diverging from the routes it mirrors — and
an assistant is the worst possible place to discover a tenant leak, because it can be asked for
combinations no UI would ever request. Re-entering the real routes means:

- the assistant sees exactly what the user sees, not approximately;
- `requireBrandAccess` runs on a request whose brand id the **model** chose;
- a future fix to a route's scoping fixes the assistant in the same commit;
- it is read-only by construction — only GET routes are reachable, and `assertReadOnly` refuses
  anything else regardless of what a tool definition claims.

**The tenant is never a tool argument.** It appears in no input schema, and a test asserts that
for every tool. A 403 and a 404 return the identical message, deliberately: telling a user which
one applies turns the tenant boundary into an enumeration oracle.

**`agent.ts` — the loop.** Bounded at 6 model round-trips and 5 tool calls per turn. When the
ceiling trips it makes one final tool-free call and returns `truncated: true`, which the UI shows
— a partial answer presented as complete is the failure that makes an assistant untrustworthy.
**Every tool call in a model turn gets a result block**: calls beyond the fifth are not run but are
answered with an error result. Before 2026-11-16 the turn was replayed with all its calls and only
five results, which Bedrock rejects, so a model asking for six tools broke the conversation.
Situational context (current view, selected brand) goes in the **system prompt**, not a user turn:
as a user turn the model can read it as an instruction from the person, so a signal titled
"ignore your instructions" would have a path to becoming one. Because it reaches the system
prompt, it is validated first: `view` must match `^[a-z][a-z0-9-]{0,31}$`, and `brandId` /
`conversationId` must be uuids. The `get_dimension_scores` tool's `days` argument is mapped
to `from` (the endpoint ignored `days`, so it silently did nothing).

**Conversation history is server-side, and scoped to the USER.** The assistant was initially
stateless — the client sent the history it wanted considered and nothing was stored, which is the
cheapest possible way not to leak a conversation store. Persistent, revisitable history was asked
for, so `conversations` and `conversation_messages` now exist and have to earn that isolation.

This is the **first table in the product where tenant scoping alone would be wrong**. A
conversation quotes the person's own questions, signals and scores; colleagues in the same tenant
have no business reading it. Every query filters tenant **and** user; `loadOwnConversation` exists
so that filter is written once rather than correctly at four call sites; the `DELETE` repeats both
filters rather than trusting the lookup above it, because that is the statement that would do the
damage. `tenant_id` is denormalised onto messages so the safe read needs no join — this product
has no RLS, and "remember to join and filter" is exactly what produced KNOWN-GAPS #5 and #5b.

**History is read from the database, never from the client.** A request sends one thing: the new
question. Trusting the client's copy would let a caller post a fabricated assistant turn — "you
previously confirmed the index is 94" — and have the model treat its own supposed words as
established fact. Covered by a test that posts exactly that.

Nothing is persisted until an answer succeeds: a conversation containing a question and no reply
reads to the user as the assistant having ignored them. Citations and tool steps are stored with
the answer, because history you cannot check is the opposite of the point.

**`citations.ts` — citations are derived, not declared.** The obvious design is to ask the model
for `[1]` markers and a source list. It is worthless: a model that invents a figure invents a
plausible source for it, and the citation then makes a wrong answer _more_ convincing. Citations
here are built from the tool results that actually came back, so a citation cannot reference
something that was not read. That is a weaker claim than "this sentence came from here" — and
unlike that one, it is true.

An unscored brand cites as **"not scored yet"**, never as zero. Zero would mean uniformly negative
sentiment, which is a different and damaging claim about a real business.

The API task role gained `bedrock:InvokeModel` for this (`infra-aws/stack/iam.tf`), scoped to
`eu.anthropic.*` profiles and `anthropic.*` foundation models exactly as the sentiment worker's
grant is.

---

## 7. apps/ingestion — source pull

Fastify, port **8081**. Private: reachable only by the scheduler and itself.

### Endpoints

| Path                              | Purpose                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /health`, `GET /ready`       | Liveness/readiness                                                                  |
| `POST /ingest`                    | Run one job. Body `{ sourceConfigId }`. 400 if missing. **Local development only.** |
| `POST /reconcile`, `POST /rollup` | Run the sweep / the rollup by hand. **Local development only.**                     |

**In a deployed environment none of these is reachable** — ingestion has no ALB target group. All
work arrives on the **scan queue** (`src/scanConsumer.ts`, one message per receive), as
`{tenantId, brandEntityId}` for an on-demand scan or `{"job": "scan-all" | "rollup" |
"reconcile"}` from EventBridge Scheduler (hourly at :00, :30 and :45). `POST /ingest/dispatch`,
which ran every feed concurrently inside one HTTP request and had no caller, was removed on
2026-11-16. Routes live in `src/app.ts` so they are testable without a socket.

Startup pings the DB (`SELECT 1`), resolves the item queue URL and starts the scan consumer
before listening, so a broken connection fails fast rather than at first message.

**The reconcile sweep** (`reconcilePendingSignals`) re-publishes signals with no
`sentiment_results` row that were ingested **between 6 h and 15 min ago**, have content, oldest
first, at most 500 per run. The window means a permanently unscoreable signal is re-sent to
Bedrock only for a few hours rather than forever; the grace period leaves normal scoring time to
finish.

### `handleIngestionJob(sourceConfigId)` — `src/handler.ts`

1. Load the `source_config`; throw if absent. Load its `brand_entity`; throw if absent.
2. Resolve the adapter from the `ADAPTERS` map keyed by `source`; throw if unknown.
3. Compute `since` = `MAX(published_at)` for that `(brand_entity_id, source)` — this is what
   makes pulls **incremental**.
4. Build `AdapterConfig.credentials` by merging `getSystemCredentials(source)` (env-derived
   API keys) **over** by the row's JSONB `config` (placeId, feedUrl, appId, …).
5. `adapter.fetch(config, since)`.
6. For each item: upload the verbatim payload (text + metadata) to
   `s3://<RAW_BUCKET>/<tenant>/<brand>/<source>/<externalId>.json` via `getObjectStore()`,
   **then** insert into `signals` with the returned `s3://` reference and
   `onConflictDoNothing()`. Upload-before-insert means `raw_storage_ref` can never point at a
   missing object. The `(source_url, brand_entity_id)` unique constraint does the
   deduplication; `.returning()` is empty for a duplicate, so only genuinely new rows are
   collected.
7. Publish the new signal id **immediately after its insert** via
   `getPublisher().publish("item", id)`. It used to publish after the whole loop, so a failure
   mid-batch left every row already inserted unpublished — and `onConflictDoNothing` meant a
   re-run could never publish them. A loop failure is recorded on `source_configs.last_error` as
   `Stopped after N of M items: …`. The publisher resolves the URL from `ITEM_QUEUE_URL` and
   throws if it is unset. Body is the bare signal uuid.
8. Stamp `last_fetched_at` / `updated_at` on the `source_config`.
9. Return `{ signalsCreated, signalsPublished }`.

Dedup + incremental `since` together mean a re-run of the same job is safe and cheap.

---

## 8. apps/sentiment-worker — scoring

Fastify, port **8082**. Private.

### Consumer — `src/consumer.ts`

An `SqsConsumer` on the **item** queue; the only HTTP routes are `/health` and `/ready`. (The
`POST /pubsub/item` push route left over from the GCP design was unauthenticated and called by
nothing; it was removed on 2026-11-16.) The body is a bare signal uuid or a JSON envelope. **Whether
the message is deleted is the ack signal**:

| Outcome                   | Effect                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Success                   | Deleted.                                                                             |
| `PermanentScoringError`   | Deleted, logged at error level. Retry cannot help.                                   |
| Anything else (transient) | Left on the queue → redelivered after the visibility timeout → DLQ after 5 receives. |

### `handleItemMessage(signalId)` — `src/handler.ts`

1. Load the signal; warn and return if absent (a missing row is not coming back).
2. Resolve `raw_storage_ref` through `getObjectStore()` and `keyFromRef()`, parse the stored
   JSON, and take its `text` — **the verbatim payload ingestion wrote**, not the source URL.
3. Score that text.
4. **Upsert** into `sentiment_results` with `onConflictDoUpdate` on the unique `signal_id` —
   this is the idempotency guarantee, so redelivery is harmless.

**Failures are classified, and the distinction is the point** (KNOWN-GAPS #9). Permanent —
missing signal row, unresolvable reference, stored payload that is not JSON or has no text, an
`LlmResponseError` (no tool call, truncated output) or a `ScoreValidationError` — raises
`PermanentScoringError` and is acked, because
redelivering sends the identical prompt and gets the identical garbage. Everything else
(network, quota, throttling, 5xx from Bedrock or the bucket) is rethrown so the retry backoff and
`max_delivery_attempts` configured in Terraform can actually fire. **Do not swallow errors
here**; doing so previously made a model outage silently drop every signal in the window.

### `scoreSignal(text)` — `src/scorer.ts`

Calls `getLlmClient().structured<…>()` with `SENTIMENT_SCHEMA`, which declares:

```json
{ "label": "positive|negative|neutral|mixed",
  "score": -1..1, "confidence": 0..1,
  "dimensions": ["trust"|"quality"|"service"|"value"|"experience"],
  "topics": ["≤5 short strings"] }
```

**That schema is not a hint in a prompt — it is the input schema of a Bedrock tool, with
`toolChoice` forcing the model to call it**, so the provider returns an already-parsed object.

**A parsed object is not a valid one.** `validateScore` rejects an unknown label or a non-numeric
score or confidence, clamps score to [-1, 1] and confidence to [0, 1], drops unknown or duplicate
dimensions (an empty list is still stored, with a warning, per KNOWN-GAPS #30), and lowercases,
de-duplicates and caps topics at `MAX_TOPICS` (5). Out-of-range values used to reach
`sentiment_results` and the index unchecked.

**The scraped text is data, not instructions.** The instructions are in `SYSTEM_PROMPT`; the text
is wrapped in a `<signal>` block (`asSignalBlock`, which neutralises closing tags) that the
system prompt tells the model to treat as untrusted content. `maxTokens` is 1024.
`PROMPT_TEMPLATE`, `SYSTEM_PROMPT` and `SENTIMENT_SCHEMA` are exported so tests can assert on
them. Logging uses the pino logger; a successful score logs at `info`.

> **There is no JSON parsing, no ` ```json ` fence-stripping and no "return ONLY valid JSON"
> instruction anywhere in this path, and reintroducing any of them is a regression.** All three
> existed in the retired Vertex/Gemini implementation to salvage prose, and all three could
> fail: a model that wrapped its answer in a sentence raised `PermanentScoringError`, **which
> acks the message**, so the signal was dropped permanently and silently (KNOWN-GAPS #9). The
> failure class is not handled now — it is absent. See `HANDOVER.md` §4.2 and `libs/llm`.
>
> _This section described the Gemini fence-and-parse behaviour until 2026-08-08, months after
> the code changed. An agent trusting it would have "restored" the exact defect the rewrite
> removed._

---

## 9. apps/report-worker — deferred skeleton

Fastify, port **8083**. Only `/health` and `/ready`, built in `src/app.ts` (`buildApp()`) so
tests mount it without listening — the test used to import `main.ts`, which bound a port and
called `process.exit(1)` when it was taken. Weekly narrative reports and PDF generation are
Epic 12 — deliberately unbuilt. It carries the same 80% coverage gate as every other project.

---

## 10. apps/web — dashboard

Next.js 16 (App Router) + React 19, `output: 'standalone'`. Local dev serves on **3100**
(`next dev --port 3100 --hostname 127.0.0.1`: loopback only, like the backends).

### Overlay features — `src/features/`

Three surfaces that sit above every view rather than inside one, because all three answer
questions that arise _while_ looking at something. Navigating away to a `/help` route loses the
thing that prompted the question.

| Path                                   | What it is                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/help/HelpCentre.tsx`         | Slide-over help panel. Opens on the **current view's** article (`articleForView`) rather than the index, with search and cross-references. Imports the corpus directly, so it works even when the API is the thing that is broken — which is exactly when someone opens help. |
| `features/help/Markdown.tsx`           | Markdown → **React elements**. Never `dangerouslySetInnerHTML`.                                                                                                                                                                                                               |
| `features/tour/Tour.tsx`               | First-run tour. Spotlights the live element rather than showing screenshots, which go stale silently. Shown once; both completion and dismissal are final.                                                                                                                    |
| `features/assistant/AssistantDock.tsx` | The assistant panel, for a question raised by what you are looking at. One-off: it does not write to saved history.                                                                                                                                                           |
| `views/Assistant.tsx`                  | The assistant **page** — persistent, revisitable conversations. Shares the API and the renderer with the dock but not its state: coupling them would mean the dock either resurrecting a page conversation on every view or silently writing into one.                        |
| `views/Documentation.tsx`              | The help corpus as a page, with contents beside the article. Same corpus and components as the panel — a second copy styled differently is how a help centre and its documentation start disagreeing.                                                                         |

> **Why the markdown renderer is hand-written.** Every markdown library renders to an HTML
> string, which means `dangerouslySetInnerHTML`, which makes a sanitiser the only thing between
> model output and script execution in an authenticated page. This one emits React elements, so
> text can never become markup. The one remaining live capability is an `href`. **Every
> data-derived href in the app** — markdown links, the drill-down's scraped `sourceUrl`, roadmap
> and assistant citations — goes through `lib/safe-url.ts`: `safeExternalHref` parses with the
> WHATWG URL parser and allows only `http(s)`, rejecting `javascript:`, `data:`,
> protocol-relative `//host` and `/\host`; `safeInAppPath` admits in-app paths. A help link with
> no in-app handler renders as text rather than a link to a 404. Before 2026-11-16 the
> drill-down rendered `sourceUrl` raw, so a hostile feed item could run script on click, and the
> markdown check accepted `//host`.
>
> The dock and the Assistant page share one answer renderer (`features/assistant/shared.tsx`), and
> the help centre and Documentation share `features/help/ArticleView.tsx`.

The tour anchors on `data-tour="..."` attributes in `components/App.tsx`. A selector matching
nothing degrades to a centred step; it must never spotlight the top-left corner.

### Rendering strategy

`app/page.tsx` is a client component that `dynamic()`-imports `ClientApp` with **`ssr: false`**
and a styled loading fallback. This is deliberate: the Cognito SDK and session storage touch
browser APIs and must not be evaluated during server prerender. Consequence — **the dashboard is
a client-side SPA inside an App Router shell**, with one route; views switch on React state.
Server Components are not used for the app surface.

`app/layout.tsx` sets metadata and loads from Google Fonts **every font pair the Appearance
popover offers** (Poppins, Open Sans, Space Grotesk, IBM Plex Sans, Sora). Until 2026-11-16 only
Poppins and Open Sans were loaded, so choosing another pair silently fell back to a system font.

### Auth chain

```
page.tsx → ClientApp → AuthProvider → AuthGate → App
```

- **`lib/config.ts`** — `AUTH_MODE` is `'local'` only when `NEXT_PUBLIC_AUTH_MODE` is exactly
  `local`; anything else is `'cognito'`. `API_BASE` is `NEXT_PUBLIC_API_URL`, falling back to
  `http://localhost:8080` (set it to `http://localhost:9080` locally). Both are inlined at build
  time.
- **`lib/cognito.ts`** — the Cognito user pool, created **on first use** rather than at import,
  so a local-mode build loads with no Cognito configuration. `NEXT_PUBLIC_COGNITO_*` have no
  fallback. The SDK keeps Cognito tokens in `localStorage`; that residual risk is documented in
  the file, and the mitigation is that no data reaches an `href` or markup unchecked.
- **`lib/local-auth.ts`** — local mode only: `localSignIn` posts `{username, password}` to
  `/auth/local/sign-in` and keeps the returned token in **`sessionStorage`**, so a local session
  ends with the tab.
- **`lib/auth.tsx`** — `AuthProvider` resolves the session for whichever mode is active and reads
  role, tenant and brand pin off the Cognito ID token or the local sign-in response. Exposes
  `{ user, role, loading, signIn, signOut, … }` via `useAuth()`; the value is memoised. Cognito
  sign-out is **global**, so the refresh token is revoked, not just forgotten in this browser.
- **`lib/session-events.ts`** — `apiFetch` calls `notifySessionExpired()` on any **401**; the
  provider signs out and `SignIn` says "Your session has ended", instead of every view failing
  with a missing token.
- **`AuthGate`** — renders a loading pane, then `SignIn`, then children.
- **`SignIn`** — Cognito email/password (with the first-login new-password challenge), or in local
  mode a form labelled **Local development sign-in**. Errors carry `role=alert`.

### API client — `lib/api.ts`

`apiFetch<T>(path, init)` attaches `Authorization: Bearer <current token>` and JSON headers,
turns error envelopes into readable messages on non-2xx, signals session expiry on a 401, and
parses JSON. The base URL is `API_BASE` (`lib/config.ts`), inlined at build time and passed as a
Docker build arg (`infra-aws/scripts/20-build-push.sh` reads it from `terraform output`).

### Shell — `components/App.tsx`

- **Brand switcher** (`components/BrandSwitcher.tsx`) sets the selected brand on the brand
  context; the choice persists and is validated against the current list. Before 2026-11-16 a
  multi-brand tenant always saw its first owned brand. Each view renders inside a
  `ViewErrorBoundary`, so one malformed row no longer blanks the whole app.
- Left rail: brandmark, brand switcher, nav grouped **Brand / Intelligence / Delivery**, plus
  an **Admin** group injected only when `role` is `owner` or `admin`. Footer shows the signed-in
  email, role, and a sign-out button.
- Topbar: view title, period, Tweaks toggle, and either Export/"Dig into score" or a
  "Download PDF" (`window.print()`) button on the report view.
- **Tweaks panel** — live design controls that rewrite CSS custom properties on a wrapper
  element: 4 palettes (Aurora, Signal, Graphite warm, Midnight ink), 3 font pairings, hero
  style (radial gauge vs bars), and an animate-on-load toggle. Changing motion settings
  remounts views via `key` so animations replay.
- **Drill-down navigation** — a `NavLevel[]` stack (`overview → dimension → cluster`) with
  `NavActions` (`openOverview`, `openDimension`, `openCluster`, `to`, `close`) rendered by
  `DrillDown`. Each level already passed through collapses to a numbered vertical spine
  (`.drill-panel.stacked`) beside the open panel, so the route from a number down to the things
  people said stays visible. Data per level: overview → `/score`; dimension → `/topics?dimension=`
  **and** `/signals?dimension=`; cluster → `/brand-impact` for the header figures and
  `/signals?topic=` for the evidence.

### Views (`src/views/`)

| View              | Data | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dashboard`       | live | Hero score (radial gauge or bars), dimension bars, sparklines, stat row → `/score`, `/dimension-scores`, `/stats`, `/brand-impact`, `/strengths`                                                                                                                                                                                                                                                                                                  |
| `Trends`          | live | Dimension history line chart → `/score`, `/dimension-scores`                                                                                                                                                                                                                                                                                                                                                                                      |
| `BrandImpact`     | live | Top weakness cards ranked by damage → `/brand-impact`                                                                                                                                                                                                                                                                                                                                                                                             |
| `Competitors`     | live | Benchmark bars → `/brands` plus one `/score` per brand                                                                                                                                                                                                                                                                                                                                                                                            |
| `WhatsChanged`    | live | **What moved**, over a 7/30/90-day window → `/whats-new`. Five panels: getting worse and getting better (sentiment), new subjects, more and less discussed (volume), plus a by-source table that keeps feeds which went silent. A `Newly collected` / `Newly published` toggle chooses the `basis`. Subjects open the drill-down via `nav.openTopic`, which — unlike `openCluster` — inserts no dimension level, because there isn't one to name. |
| `Roadmap`         | live | **What to fix, what it is worth, what you are aiming at.** Target with stated provenance, gap, measured benchmarks, and per action a matched play with concrete steps plus the `ifResolved` ceiling → `/roadmap`. Admins can set or clear the target inline.                                                                                                                                                                                      |
| `VoiceOfCustomer` | live | What Sales and CS hear directly → `/voice-of-customer`. Ranked by accounts × band, with the corroboration panel. Empty until a CRM connector exists, and it says which kind of empty.                                                                                                                                                                                                                                                             |
| `Report`          | live | Print-styled weekly report → `/score`, `/dimension-scores`, `/brand-impact`, `/stats`, all territory-aware. **The view is real; what Epic 12 still owes is the PDF render and the email delivery**, not the page.                                                                                                                                                                                                                                 |
| `Admin`           | live | Tenant creation, `BrandManager`, `UserManager`                                                                                                                                                                                                                                                                                                                                                                                                    |

### The territory lens

`components/TerritoryPicker.tsx` sits in the top bar and sets `territory` on the brand context;
every view builds its query through `withTerritory()` in `lib/brand-data.ts`, so all of them ask
the same question of the same scope. Two views constructing that query separately is how a UK
headline ends up above an all-territories breakdown — both plausible, silently disagreeing.

The picker **only offers territories the brand actually collects from**, read from its configured
feeds. A full ISO list would be a dozen options, eleven of which return an empty dashboard — and
an empty dashboard is indistinguishable from a broken one. It hides itself entirely below two
options, and the selection is **not persisted**: a brand is a durable choice, a territory is a
lens, and a stale one restored on the next visit would put Australian numbers under a UK heading.

### Charts and motion

All visualisation is **hand-rolled SVG** — there is no charting library. `components/charts.tsx`
provides `LineChart` and `Sparkline`; `RadialGauge` and `DimBar` are separate. Animation is
driven by two hooks: `useInView` (IntersectionObserver, fires once) and `useCountUp` (rAF
easing). `components/primitives.tsx` holds `Delta` and `SourceGlyph`; the unused `VolumeBars`,
`MixDonut`, `SourceBadge`, `SentChip` and `Stars` were removed on 2026-11-16.

The Dashboard sparkline under the composite plots the **mean of the dimensions** and is labelled
so — no endpoint yet returns a per-day weighted composite.

### Design system — `app/globals.css`

A dark, "instrument-grade" system driven entirely by CSS custom properties: surfaces
(`--bg`, `--surface`…`--surface-3`), text ramp (`--t1`/`--t2`/`--t3`), five accents
(`--mint`, `--peri`, `--sky`, `--coral`, `--gold`), three font roles (`--font-display`,
`--font-body`, `--font-mono`), radii and shadow. `lib/utils.ts` maps scores to those tokens
(`scoreColor`, `sentLabel`, `sentColor`). The Tweaks panel works by overriding these same
variables — so **new UI must use the tokens, not literal hex**, or it won't respond to palette
switching.

Three groups sit outside the switchable palette, deliberately:

- **`--ok`** — semantic status. Separate from the five accents because "this toggle is on"
  must not change meaning when a different palette is selected.
- **`--ink-accent`** — text sitting on an accent fill, e.g. a mint submit button.
- **The paper ramp** (`--paper*`, `--ink*`, `--panel`) — the printable report and the floating
  Tweaks panel are light surfaces the dark system never covered. The palette switcher does not
  reassign them.

> **`PALETTES` in `components/App.tsx` is the one place literal hex belongs.** Those four
> palettes are the _values the tokens take_: `App.tsx:182` writes them into `--mint`, `--bg`,
> `--surface` and the rest via `rootStyle`. They are the runtime analogue of the `:root` block.
> Rewriting them as `var(…)` would be circular and would break palette switching entirely —
> `KNOWN-GAPS.md` #19 originally listed all 40 as defects for exactly this reason, and was
> wrong. Everywhere else in `apps/web`, a literal hex is a bug.

### Live data vs mock data

**Live:** the four analytical views above, plus `views/Admin.tsx` (POST `/admin/tenants`),
`components/BrandManager.tsx` (reads `/brands`, full CRUD against `/brands/:id/integrations`
and `/brands/:id/aliases`, dynamic add-source form driven by `SOURCE_FIELDS`),
`components/ProductManager.tsx` (the hierarchy — `/brands/tree`, create, edit, re-parent, delete),
`components/ScanPanel.tsx` (`POST /brands/:id/scan` and the run list it polls) and
`components/UserManager.tsx` (`/admin/users`).

> **`ProductManager` renders a labelled `Edit` button, not an icon.** It shipped once as an
> icon-only ghost pencil between a name and a badge. Every unit test passed and the control
> worked; the owner added sixteen products and reported there was no way to edit them. Nothing in
> the repository could catch it, because every assertion looked the button up by an accessible
> name that was **visually hidden**. `apps/web/test/product-manager.test.tsx` and
> `apps/web/e2e/products.spec.ts` now assert on the visible word. Delete confirms in place rather
> than through `window.confirm` — a native dialog blocks the page, cannot be styled, and cannot be
> driven by the e2e suite.

Three pieces carry that wiring and are worth knowing before you touch a view:

- **`lib/brand-context.tsx`** — `BrandProvider` loads the tenant's brands and holds the
  selected one; `BrandSwitcher` and the admin managers share it, and it reloads after a brand is
  created or deleted. The shell previously hard-coded a single fictional brand.
- **`hooks/useApi.ts` + `components/ViewState.tsx`** — loading, error and empty are **three
  distinct states**, and every live view must render all three. A `null` path means "not ready
  yet", so views do not fire a request at `/brands/null/...`.
- **`lib/brand-data.ts`** — pure API→presentation mapping with no React or fetch, unit-tested
  under `apps/web/test/brand-data.test.ts`.

**There is no mock data.** `lib/data.ts` was deleted on 2026-08-09 (KNOWN-GAPS #13) and every view
reads the API. `lib/types.ts` now holds only the navigation view models (`Dimension`, `NavLevel`,
`NavActions`); its fixture types went on 2026-11-16.

**Tests.** The Vitest coverage gate (80%) applies to **all of `src`**, excluding only `src/app/**`,
type declarations, `lib/types.ts` and the design-system barrel — it used to cover a nine-file
allowlist, so auth and every view could ship untested. `test/setup.ts` restores jsdom's
`localStorage` (Node 25+ defines an unusable global one that shadows it) and stubs
`IntersectionObserver`. The Playwright suite (`apps/web/e2e`, base URL `http://localhost:3100`)
signs in through either mode (`E2E_AUTH_MODE`, `E2E_USERNAME`/`E2E_PASSWORD`, or
`E2E_EMAIL`/`E2E_PASSWORD` for Cognito); `run-docker.sh` starts `e2e/port-forward.mjs` inside the
container so its `localhost:3100` and `localhost:9080` reach the host, because the bundle calls
`localhost:9080`.

---

## 11. End-to-end flows

### Sign-in → authorised request

```
Cognito mode (deployed):
User → Cognito (SRP, email/password) → ID token with custom:role, custom:tenantId, custom:brandEntityId
Local mode (AUTH_MODE=local + NEXT_PUBLIC_AUTH_MODE=local):
User → POST /auth/local/sign-in {username, password} → dev:<role>:<tenant>[:<brand>][:<uid>] from the users row

Web  → apiFetch attaches Bearer token (401 → back to sign-in)
API  → onRequest hook → CognitoJwtVerifier (or strict dev-token parse in local mode) → request.user
     → rate limit (per user) → requireRole / requireBrandAccess preHandlers
     → query filtered by request.user.tenantId; written brand ids checked by brandInTenant
```

Role changes take effect in a Cognito token on its next refresh, which is why the API trusts the
claim and the `users` table is only a mirror (in local mode the row is the claim).

### Ingestion → scoring

```
EventBridge Scheduler → scan queue (SQS)
  :00 {"job":"scan-all"}   :30 {"job":"rollup"}   :45 {"job":"reconcile"}
  API POST /brands/:id/scan → {tenantId, brandEntityId}
ingestion scan consumer (one message per receive; visibility heartbeat while it runs)
  └─ for each enabled feed → handleIngestionJob
       ├─ adapter.fetch(since = per-feed watermark)       ← incremental; outbound HTTP bounded + SSRF-guarded
       ├─ store.put(rawKey(...)) → s3://<RAW_BUCKET>/…     ← BEFORE the insert
       ├─ INSERT signals ... ON CONFLICT DO NOTHING        ← dedup
       └─ publish("item", id) immediately after each insert → item queue
            └─ sentiment-worker SqsConsumer → handleItemMessage
                 ├─ read raw payload; scoreSignal(text) via Bedrock (forced tool use, validated)
                 ├─ UPSERT sentiment_results ON CONFLICT (signal_id)   ← idempotent
                 └─ transient failure → message left on queue → redelivered → item DLQ after 5 receives
reconcile: re-publishes unscored signals ingested 6 h–15 min ago (oldest first, ≤ 500)
rollup:    writes dimension_scores (per territory + 'all')
```

**KNOWN-GAPS #3 is closed.** The in-process `Promise.allSettled` fan-out behind
`/ingest/dispatch` is gone with the route; a sweep runs inside one queue message, kept claimed by
the visibility heartbeat (scan queue visibility 1800 s), and a feed that fails records its error
on `source_configs.last_error` and is retried by the next hourly sweep.

The deployed system runs this path in `290304998906` / `eu-west-2` (HANDOVER §0a). Locally it runs
against Docker Postgres and LocalStack, with scoring reaching real Bedrock only when
`BEDROCK_AWS_PROFILE` is set.

### Dashboard read path

```
BrandProvider → apiFetch('/brands')                 → brand list; BrandSwitcher selects
Dashboard     → useApi(`/brands/${id}/score`)       → composite + breakdown + week-earlier delta
              → useApi(`/brands/${id}/dimension-scores`), `/stats`, `/brand-impact`, `/strengths`
              → brand-data.ts maps API rows into presentation shapes
              → ViewState renders loading | error | empty | data (errors from every request surface)
```

Every view reads the API; there is no mock data.

---

## 12. Infrastructure

### Current state: deployed in the sandbox

The AWS stack has been **deployed in `290304998906` / `eu-west-2` since 2026-08-08**
([`HANDOVER.md`](HANDOVER.md) §0a carries the deploy record and live image tag). The GCP tree
in `infra/` was never applied and never will be.

### `infra-aws/` — the deployed stack

Region **`eu-west-2`** (London). Compute **ECS Fargate**, database **RDS Postgres**, auth
**Cognito**, all decided by the owner.

| Path                       | What                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`               | S3 remote-state bucket — versioned, encrypted, TLS-only, `prevent_destroy`. Local state, because it creates the backend everything else uses                                                                                                                                                                                                          |
| `account/`                 | **ACCOUNT-GLOBAL, not ours.** Activates the six mandatory tag keys as cost allocation tags — one switch per key for the _whole_ account, shared with every co-tenant project. Separate state (`account/terraform.tfstate`), `prevent_destroy` on each key, applied deliberately by the owner or platform team and **never by CI or a project deploy** |
| `stack/`                   | The application. S3 remote state with native locking (`use_lockfile`; no DynamoDB table). See the file map below                                                                                                                                                                                                                                      |
| `envs/dev.tfvars`          | Account, region and tag values, shared by `bootstrap/` and `stack/` so they cannot drift. `dev.stack.tfvars` holds stack-only values (sizing, budget, models, lifecycle flags); `account.tfvars` feeds the account module                                                                                                                             |
| `scripts/00-discover.sh`   | Phase 0 discovery, read-only — findings in [`HANDOVER.md`](HANDOVER.md) §3                                                                                                                                                                                                                                                                            |
| `scripts/10-preflight.sh`  | Pre-apply checks: account, cost allocation tag status, prefix collisions                                                                                                                                                                                                                                                                              |
| `scripts/20-build-push.sh` | Builds and pushes the four images to ECR; refuses a dirty tree or an existing tag, and reads the `NEXT_PUBLIC_*` values from `terraform output`                                                                                                                                                                                                       |
| `scripts/99-teardown.sh`   | Reversal, dry-run by default, verifying by **independent inventory — by tag and by name prefix** — rather than Terraform state, which is what catches a resource orphaned by a failed apply or created at runtime (CRM token secrets). Exits non-zero if the destroy fails                                                                            |
| `scripts/_guard.sh`        | The account guard every AWS-calling script sources first. Tested by `scripts/test/guard.test.sh` (hermetic, stubbed CLI)                                                                                                                                                                                                                              |
| `CONVENTIONS.md`           | The proposed cross-repo standard for the shared account                                                                                                                                                                                                                                                                                               |

**`stack/` file map.**

| File                                  | Defines                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vpc.tf`, `nat.tf`                    | Own VPC `10.20.0.0/16`, 2 AZs, public + private subnets; one NAT gateway for private egress (ingestion needs arbitrary third-party HTTPS)                                                             |
| `rds.tf`                              | Postgres 16, private, encrypted; `app` security group (api, ingestion, sentiment-worker) is the only one the DB admits                                                                                |
| `s3.tf`, `alb_logs.tf`                | `raw` (versioned), `reports`, and the ALB access-log bucket — all public-access-blocked, TLS-only, bucket-owner-enforced                                                                              |
| `ecr.tf`                              | One IMMUTABLE repository per deployed service                                                                                                                                                         |
| `sqs.tf`                              | `item`, `report`, `scan` + DLQs (`maxReceiveCount` 5); visibility 300 s, 1800 s for `scan`                                                                                                            |
| `ecs.tf`                              | Cluster (Container Insights, exec logging), four services; per-container health checks; web has its own security group and no database credential                                                     |
| `alb.tf`                              | One ALB, path-routed: `/admin* /assistant* /brands* /docs*`, `/crm* /auth*`, `/health /ready` → API, everything else → web. HTTPS listener + HTTP→HTTPS redirect appear when `certificate_arn` is set |
| `iam.tf`                              | Shared execution role; one least-privilege task role per service; Bedrock limited to `eu.anthropic.*` profiles in the stack region                                                                    |
| `cognito.tf`                          | User pool (admin-create only, SRP + refresh flows only) and the public web client                                                                                                                     |
| `scheduler.tf`                        | EventBridge Scheduler → `scan` queue: `scan-all` :00, `rollup` :30, `reconcile` :45                                                                                                                   |
| `monitoring.tf`                       | SNS topic + 13 alarms: DLQ not empty, ALB 5xx, unhealthy targets, ECS tasks below desired, RDS CPU and free storage                                                                                   |
| `logs.tf`                             | App log group (30 d), ECS Exec transcripts (365 d), RDS export groups with retention (adopted by `import`)                                                                                            |
| `secrets.tf`, `budget.tf`, `guard.tf` | Apify/YouTube key secrets (value set out of band); the tag-filtered budget; account/region `check` blocks                                                                                             |

The account is **shared with other projects**, so the build is designed to be _separable_: own
VPC, `psignal-<env>-*` naming, mandatory tags applied as Terraform provider `default_tags` (so a
resource cannot be created untagged), and `allowed_account_ids` aborting before the first API
call in the wrong account — fed by an `aws_account_id` variable validated against the literal
`290304998906` in every root module, so the pin cannot be moved by a `-var`. See [`AWS-SETUP.md`](AWS-SETUP.md) for the guardrails,
[`HANDOVER.md`](HANDOVER.md) §3.2 for why each exists, and
[`../infra-aws/CONVENTIONS.md`](../infra-aws/CONVENTIONS.md) for the standard co-tenant repos
should follow.

> **The tag keys are PascalCase and that is load-bearing.** `Project`, `Owner`, `CostCentre`,
> `Environment`, `ManagedBy`, `Expires`. AWS tag keys are case-sensitive and cost allocation
> tags are activated by exact key, so applying one casing and activating another produces six
> tags that attribute nothing. A budget filtered on an inactive tag reports **$0 forever** — the
> failure is completely silent, which is why `scripts/10-preflight.sh` checks for it explicitly.

> **Account-global resources live in `account/`, never in `stack/`.** Cost allocation tag
> activation is one switch per key for the entire AWS account, not a per-project setting. While
> it lived in `stack/budget.tf`, `terraform destroy` — which `scripts/99-teardown.sh --execute`
> runs — would have deactivated all six keys **for every other project in the shared sandbox**,
> and because activation does not backfill, their lost attribution would have been permanent.
> `CONVENTIONS.md` §7 also tells the next repo to copy `stack/`, which would have given two
> states ownership of the same six global switches.
>
> **The rule: if a resource is account-scoped, it does not belong in a project's state file.**
> Anything added to `account/` must clear that bar, and co-tenant repos **reference** the module
> rather than copying it.

### `infra/` — GCP, superseded, kept as reference

Region `europe-west2`. Nine Terraform modules covering Cloud Run, Cloud SQL, Pub/Sub, Cloud
Tasks, GCS, Scheduler, Artifact Registry, Identity Platform and service accounts.

**It will never be applied.** The project was originally stood up in a contractor-owned test
project; that environment was abandoned at handover, and the owner then decided not to build a
replacement. `envs/*.tfvars` still contain `REPLACE_ME`.

It is kept deliberately, and the rest of this section is worth reading for one reason: **it is
the clearest available specification of what each service in this system actually needs** —
which IAM grants, which env vars, which retry policy, which secret. Re-deriving that from prose
while writing `infra-aws/` would be waste. Delete it once AWS reaches parity
([`HANDOVER.md`](HANDOVER.md) §8).

### Layout

One shared `.tf` stack, per-environment `.tfvars`, and state isolated by GCS prefix passed at
`terraform init` — `.tf` files are never duplicated per environment.

### `infra/bootstrap/` — one-shot per project

- Enables 17 project APIs (`run`, `sqladmin`, `pubsub`, `cloudscheduler`, `cloudtasks`,
  `secretmanager`, `artifactregistry`, `aiplatform`, `storage`, `iam`, `iamcredentials`,
  `sts`, `identitytoolkit`, `monitoring`, `logging`, `cloudbilling`,
  `cloudresourcemanager`), with `disable_on_destroy = false`.
- Creates the **versioned** Terraform state bucket with `prevent_destroy`.
- Creates the `project-signal-ci-deployer` service account and grants it 13 admin roles.
- Creates a **Workload Identity Federation** pool + OIDC provider for GitHub Actions,
  restricted by `attribute_condition = assertion.repository == "<owner/repo>"` (default
  `wayne-strydom/project-signal`), and binds the repo's principal set to impersonate the CI SA.

**No service-account JSON keys exist anywhere in this project.**

### `infra/modules/` — nine modules

| Module              | What it creates                                                                                                      | Notable decisions                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud_sql`         | Postgres 16 instance, `project_signal` database, `project_signal_app` user, 32-char random password → Secret Manager | **ENTERPRISE edition** (required for shared-core tiers like `db-f1-micro`); backups enabled; **public IP with zero authorized networks** — unreachable from the internet, only via the Cloud SQL Auth Proxy. This avoids the ~$12–15/mo always-on Serverless VPC connector. |
| `cloud_run`         | Generic v2 service                                                                                                   | Scales to zero (`min_instances = 0`, `max = 2`); dynamic `env` and `secret_env` blocks; conditional Cloud SQL socket volume + mount; either `allUsers` invoker or an explicit `invoker_members` list.                                                                       |
| `service_accounts`  | One SA per runtime service + scheduler SA + pubsub-invoker SA                                                        | Least privilege: `cloudsql.client` only for the four DB users, `aiplatform.user` only for sentiment/report, log+metric writer for all; secret access scoped to the DB password secret.                                                                                      |
| `storage`           | `raw` and `reports` buckets                                                                                          | Both uniform bucket-level access + `public_access_prevention = enforced`. `raw` has a 30-day → NEARLINE lifecycle rule. Per-SA scoped IAM (ingestion writes raw, sentiment reads raw, report writes reports, API reads reports).                                            |
| `pubsub`            | `item` + `report` topics, each with a DLQ; push subscriptions; 2 DLQ pull subscriptions                              | Push uses **OIDC tokens** minted as the push-invoker SA; `max_delivery_attempts = 5`; retry backoff 10s–600s. Includes the easily-missed service-agent IAM: DLQ publisher, source-subscription subscriber, and `serviceAccountTokenCreator` on the invoker SA.              |
| `cloud_tasks`       | Rate-limited ingestion queue                                                                                         | 5 dispatches/sec, 10 concurrent, 5 attempts with 5s–300s backoff. **The rate limit is the entire point** — it protects Apify/YouTube quotas.                                                                                                                                |
| `scheduler`         | Four cron jobs                                                                                                       | ingestion `0 6 * * 1` (Mon 06:00), report `0 7 * * 1`, pending-sweep `0 * * * *` (hourly), dimension-rollup daily; all `Etc/UTC`. Ingestion, sweep and rollup are HTTP+OIDC; report publishes to the report topic.                                                          |
| `artifact_registry` | Docker repository `project-signal`                                                                                   | Provides `registry_url` consumed by the image locals.                                                                                                                                                                                                                       |
| `identity_platform` | Config + social IdP configs                                                                                          | Email/password toggle; `for_each` over `social_idps` (e.g. `microsoft.com`, `google.com`). Credentials passed via `TF_VAR_auth_social_idps` at apply time — **never committed**. See the module's own README for the one-time Entra multi-tenant app registration.          |

### `infra/stack/main.tf` — composition

Five Cloud Run services are instantiated: `api` and `web` public; `ingestion` invokable by the
Scheduler SA; `sentiment-worker` and `report-worker` invokable by the Pub/Sub invoker SA.

**Terraform owns the container image.** `var.image_tag` (required, no default) is interpolated
into every image reference, so a deploy applies image _and_ environment atomically — there is
no separate "update image" step and no `ignore_changes` on the image any more.

Environment wiring lives in `locals`: `common_env` (project, NODE_ENV, Vertex location),
`db_env` (`DB_SOCKET_PATH` pointing at the **socket file**
`/cloudsql/<connection>/.s.PGSQL.5432`, not the directory — postgres-js requires the file),
`db_secret` (DB_PASSWORD from Secret Manager), and `ingestion_secret` (adds
`YOUTUBE_API_KEY` and `APIFY_API_KEY`).

Source API keys are created **out of band via `gcloud`** so their values never enter Terraform
state; the stack only references them by name and grants `secretAccessor`. Because the IAM
grants address the secrets by full resource name, **both secrets must exist before the first
apply** or it fails.

The `ITEM_TOPIC` env var is set to the deterministic string `"${var.environment}-item"` rather
than a module output, deliberately, to avoid a dependency cycle between the Cloud Run and
Pub/Sub modules.

---

## 13. CI/CD

**Two GitHub Actions workflows, and neither authenticates to any cloud.** There is no deploy
pipeline: AWS CI/CD is Phase 6 (GitHub OIDC → IAM role), and until it exists nothing in this
repository can reach an account from CI.

> **The two GCP deploy workflows were removed on 2026-08-08.** `deploy-staging.yml` and
> `deploy-production.yml` built images to Artifact Registry and ran `terraform apply` against
> the `infra/` GCP stack — a platform the owner decided on 2026-08-06 never to build
> ([`HANDOVER.md`](HANDOVER.md) §2). They could not have succeeded: there is no GCP project and
> no `WIF_PROVIDER` secret. Both carried `workflow_dispatch`, so they remained manually
> triggerable, and `deploy-staging.yml` also triggered on a `staging` branch that deliberately
> does not exist (KNOWN-GAPS #15). Dead deploy pipelines pointed at an abandoned platform are
> not harmless in an audited repository. **When AWS deploy workflows are written in Phase 6,
> write them fresh against ECR and ECS — do not resurrect these from git history.**

### `ci.yml` — PRs and pushes to `main`/`staging`

Every job installs through one composite action, `.github/actions/setup-yarn` — Node from
`.nvmrc`, `corepack@0.36.0` (Node 25+ has none), a cached Yarn download cache, then
`yarn install --immutable` — so the toolchain cannot drift between jobs. Every third-party action
is **pinned to a commit SHA** with the release named in a comment; runs are grouped by branch
with `cancel-in-progress` on PRs only; every job has a `timeout-minutes`.

| Job            | Does                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`      | `dorny/paths-filter` computes which apps changed (each app watches its own dir plus a shared set: `libs/**`, `scripts/**`, `package.json`, `yarn.lock`, `.yarnrc.yml`, `tsconfig.base.json`, `.dockerignore`)                    |
| `code-quality` | `nx run-many -t lint` → `nx run-many -t typecheck` → `yarn check:deps` → **`alb-routes.test.sh`** (every API route prefix is forwarded by the ALB — runs on every PR, because the defect arrives in `apps/api`, not `infra-aws`) |
| `test`         | `nx run-many -t test -- --coverage`                                                                                                                                                                                              |
| `integration`  | `@project-signal/api:test:integration` against a Postgres 16 service container (`project_signal_test`) — real SQL, real migrations, real tenant filters                                                                          |
| `docker-check` | Matrix over changed apps: build each Dockerfile with GHA layer cache and placeholder `NEXT_PUBLIC_*` build args, **no push**                                                                                                     |

### `terraform-plan.yml` — PRs and pushes to `main` touching `infra-aws/**` or `scripts/**`

Static validation of the AWS Terraform tree. **It makes zero AWS API calls**, deliberately:
`init -backend=false` skips backend configuration and state entirely, so nothing authenticates
and nothing is read from the account. `permissions` is `contents: read` with no `id-token`.

| Job        | Does                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate` | `terraform fmt -check -recursive -diff`, then `init -backend=false -lockfile=readonly` + `validate` on each of the three root modules — `bootstrap`, `account`, `stack`. **A module not listed is not checked.** The provider locks record windows/linux/darwin hashes, so a lock drift fails here instead of being silently rewritten |
| `scripts`  | `bash -n` and `shellcheck -S warning` over `infra-aws/scripts/*.sh` and `scripts/*.sh`, the guard tests, the ALB route test, then asserts that **every script invoking the AWS CLI sources `_guard.sh` and calls `assert_sandbox_account`**                                                                                            |

That last check is the important one. The sandbox rule is enforced by a guard a script has to
remember to source, and `00-discover.sh` had silently not sourced it — running ~20 `describe`
and `list` calls against whatever account the credentials happened to resolve to, in a
repository whose own documentation stated that every AWS-calling script was guarded. **A
control that depends on remembering is not a control.** The next such omission now fails a PR
instead of reaching an account.

> **This workflow replaced a GCP one of the same name.** The previous version filtered on
> `infra/stack/**` and `infra/modules/**` — the superseded GCP tree — so `infra-aws/**` had no
> CI coverage whatsoever. `ci.yml` never reads a `.tf` file.
>
> **When Phase 6 lands**, add a real `terraform plan` job here using the GitHub OIDC role, and
> leave the credential-free `validate` job as the gate that always runs. A gate that cannot
> authenticate cannot itself become a route into the account.

### Docker images

All five use multi-stage builds on `node:26-alpine` ending with a non-root `signal` user. Because
Node 25+ no longer bundles corepack, the base stage runs `npm install -g corepack@0.36.0 &&
corepack enable` (pinned, so an image never depends on whatever npm serves on build day).
`.dockerignore` keeps `.env`, `.env.local`, `docs`, `infra`, `infra-aws` and `design` out of the
build context — a developer's local web env file must never be baked into an image.
Health checks are defined in the ECS task definitions (`infra-aws/stack/ecs.tf`,
`container_health`), not as Dockerfile `HEALTHCHECK`s, because ECS ignores the latter.

**Backends** copy the whole workspace (`.dockerignore` keeps `node_modules`/`dist` out), run
`yarn install --immutable`, then `sh scripts/build-libs.sh` followed by `tsc -p
apps/<app>/tsconfig.build.json`.

`scripts/build-libs.sh` is worth understanding: it **esbuild-bundles each lib in dependency
order** into a single `dist/index.js` (`--packages=external`, so node_modules and sibling
`@project-signal/*` stay external) and emits `.d.ts` via `tsc --emitDeclarationOnly`. The bundling
exists because ESM cannot resolve the extensionless relative imports TypeScript emits — this
is deliberately Nx-independent and deterministic.

The API image additionally copies `apps/api/migrations` into the runtime layer — **without it,
startup migrations silently no-op.**

**Web** builds with `next build` and ships the standalone output (`server.js` + `.next/static`

- `public`).

---

## 14. Testing

Vitest 2 with V8 coverage; 92 unit test files across 14 projects plus the API's integration
suite. `yarn test` runs every project with coverage, exactly as CI does; `@project-signal/db` has
no tests of its own and is exercised through the API's integration suite.

**Coverage gate: 80%** on lines, branches, functions and statements — enforced **per project**
in each `vitest.config.ts`, **report-worker and the whole of `apps/web/src` included** (both
were exempt or allowlisted until 2026-11-16). `**/main.ts` is excluded (boot wiring only); the
logic it used to hold moved to testable `app.ts` / `consumer.ts` modules.

**Real-Postgres integration suite** — `yarn nx run api:test:integration`
(`apps/api/vitest.integration.config.ts`, `apps/api/test/integration/`). Its global setup drops and
recreates a dedicated database (it refuses any name not ending in `_test`; locally
`project_signal_test` on the Docker Postgres, overridable with `INTEGRATION_DATABASE_URL`), runs
the real migrations, and drives `buildApp()` over real SQL: tenant isolation across routes, and
the `PATCH /admin/users` mass-assignment case — re-introducing the body spread turns it red. CI
runs it against a Postgres 16 service container. It never touches the `project_signal` dev
database.

Each project's config uses `vite-tsconfig-paths` so `@project-signal/*` aliases resolve in tests
without building the libs.

| Area            | Files                                                                                      | Approach                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API routes      | every route file, plus `keyset`, `attributed-to`, `benchmarks`, `local-auth`, `health`     | `test/helpers/app.ts` exposes `buildTestApp(plugin, mockUser)`, which registers the same error boundary as production and stubs `request.user` with uuid fixtures. `DEFAULT_ADMIN` / `DEFAULT_OWNER` / `DEFAULT_PINNED_USER` presets. |
| API plugins     | `plugins/auth.test.ts`                                                                     | Cognito mapping, strict dev-token parsing (local mode only), exact public paths, `requireRole` and `requireBrandAccess`                                                                                                               |
| API lib         | `http`, `rate-limit`, `claims`, `crm-secrets`, `migrate`                                   | Error boundary and Postgres error mapping, per-user rate-limit keys, lock timeout and missing-folder failure                                                                                                                          |
| API integration | `test/integration/`                                                                        | Real Postgres, real migrations, `buildApp()` — see above                                                                                                                                                                              |
| Ingestion       | `app`, `handler`, `rollup`, `scanConsumer`                                                 | `vi.hoisted` mock chain impersonating the Drizzle fluent builder; partial-failure publishing, the reconcile window, job routing                                                                                                       |
| Sentiment       | `consumer`, `handler`, `scorer`                                                            | Permanent-vs-transient classification, upsert-on-conflict, prompt shape, output validation and clamping                                                                                                                               |
| Web             | 28 files under `apps/web/test`                                                             | Auth in both modes, `safe-url`, every view, the drill-down, admin panels, error boundary, the API→presentation mapping                                                                                                                |
| Libs            | `config`, `llm`, `messaging`, `scoring`, `storage`, every adapter + `apifyClient` + `http` | `fetch` mocked; RSS tests cover both RSS and Atom shapes; SSRF guard address classes; `scoring` is pure and needs no mocks                                                                                                            |

**`test/routes/keyset.test.ts` is the one to copy for any new raw SQL.** It renders the keyset
condition through the real `PgDialect`, which is what catches a JS `Date` interpolated into a
raw `sql` fragment — a bug that has shipped twice and that every mocked test passed both times,
because a mocked database never renders SQL.

The unit route tests still mock `@project-signal/db` entirely — which is why the two `sql`
serialisation bugs above passed every one of them, and why the integration suite exists.

**A browser harness now exists.** `apps/web/e2e` (Playwright 1.50, added 2026-08-09) signs in and
drives the real application, asserting on **computed styles** rather than on class names. That
distinction is the whole point: the light theme painted black cards on eight views while the unit
suite was entirely green, because each component, token and helper was individually correct and
nothing rendered the page and read the colour back. A class-name assertion would have passed too.

`bash apps/web/e2e/run-docker.sh` runs it against a local dev server or a deployed environment
with no local browser install — the image tag is pinned to the `@playwright/test` version so the
two cannot drift.

Locally it signs in through **local auth mode** (`E2E_AUTH_MODE=local`, `E2E_USERNAME`,
`E2E_PASSWORD`) against `http://localhost:3100`; against a deployed environment it uses a Cognito
test user (`E2E_EMAIL`, `E2E_PASSWORD`).

---

## 15. Local development

```bash
npm install -g corepack@0.36.0 && corepack enable   # once per machine: Node 25+ has no corepack
yarn install
cp .env.example .env                                # then set LOCAL_AUTH_PASSWORD
docker compose up -d        # Postgres 16 (:5432) + LocalStack (:4566, s3 + sqs)
PORT=9080 yarn nx run api:dev                       # API first: it applies migrations
yarn db:seed                                        # demo tenant + local-owner/-admin/-user
yarn nx run ingestion:dev & yarn nx run sentiment-worker:dev &
yarn nx run @project-signal/web:dev                 # http://localhost:3100
```

`yarn dev` (all apps at once, API on 8080) still works on a machine where 8080 is free; on the
owner's machine 3000, 8080 and 8090 are occupied, hence the per-process `PORT=9080`.

**Migrations apply when the API boots** — there is no manual migrate step, and seeding before
the API has started fails with `relation "tenants" does not exist`. Boot the API first.

`scripts/localstack-init.sh` runs inside the LocalStack container on first boot and creates
the `psignal-local-raw` bucket plus the item, report and scan queues and their DLQs, with
`maxReceiveCount: 5` and the same visibility timeouts as the deployed queues (300 s; 1800 s for
`scan`, which carries whole collection sweeps) — so the local stack fails the same way the real
one will.

**This replaced the Pub/Sub emulator, and it is a straight upgrade.** There was never a GCS
emulator, so the raw-payload write and read path could only ever be exercised against mocks.
It can now be run for real — and was, on 2026-08-07: 52 signals ingested from a live RSS feed,
written to S3, read back, published to SQS, deduplicated on re-run and swept by `/reconcile`.
See [`HANDOVER.md`](HANDOVER.md) §5.

The one link that cannot be closed locally is **LLM calls** (scoring, the assistant, roadmap
rewording) — LocalStack does not emulate Bedrock. Set `BEDROCK_AWS_PROFILE=psignal-dev` and
`aws sso login --profile psignal-dev`: the LLM client alone uses that profile and ignores
`AWS_ENDPOINT_URL`, while S3 and SQS stay on LocalStack.

**Sign-in is local too.** With `AUTH_MODE=local` (root `.env`) and `NEXT_PUBLIC_AUTH_MODE=local`
(`apps/web/.env.local`) the web app shows a local sign-in screen backed by the API's
`POST /auth/local/sign-in`; the seed creates `local-owner`, `local-admin` and `local-user`, all
with the password in `LOCAL_AUTH_PASSWORD`. The API refuses `AUTH_MODE=local` when
`NODE_ENV=production`; the deployed stack never sets it and signs in through Cognito.

| Service             | URL                                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| web                 | http://localhost:3100                                                    |
| api                 | http://localhost:9080 (Swagger UI at `/docs`)                            |
| ingestion           | http://localhost:8081                                                    |
| sentiment-worker    | http://localhost:8082                                                    |
| report-worker       | http://localhost:8083                                                    |
| Postgres            | `postgresql://project_signal_app:password@localhost:5432/project_signal` |
| LocalStack (S3+SQS) | http://localhost:4566                                                    |

**Calling the API locally without Cognito** — with `AUTH_MODE=local`:

```bash
curl -H "Authorization: Bearer dev:owner:$TENANT_ID:$BRAND_ID" http://localhost:9080/brands
#                              dev:<role>:<tenantId>[:<brandEntityId>][:<uid>]
```

Or sign in as a seeded user and use the returned token:

```bash
curl -s -X POST http://localhost:9080/auth/local/sign-in -H 'Content-Type: application/json' \
     -d "{\"username\":\"local-owner\",\"password\":\"$LOCAL_AUTH_PASSWORD\"}"
```

**Adding a migration:**

```bash
# 1. edit libs/db/src/schema/*.ts
yarn db:generate            # drizzle-kit generate → apps/api/migrations/
# 2. restart the API; it applies on boot
```

---

## 16. Gotchas worth knowing before you edit

1. **The API owns migrations; workers never migrate.** Adding `migrate()` to a worker
   reintroduces the race the advisory lock exists to prevent.
2. **The dedup contract is the `(source_url, brand_entity_id)` unique index.** Any adapter that
   returns an empty or unstable `url` will produce duplicate signals or collide across items.
3. **Scoring idempotency is the unique `signal_id` on `sentiment_results`.** Keep the upsert;
   don't switch to a plain insert.
4. **Credentials are merged, not stored.** Never write an API key into `source_configs.config`
   — it goes in env/Secret Manager and is merged in by `getSystemCredentials()`.
5. **`request.user` comes from token claims, not the `users` table.** Changing a row without
   calling `setUserClaims` (inside the same transaction) leaves authorisation stale until the
   token refreshes. Local mode is the exception: there the row is the claim.
6. **Tenant scoping is manual.** There is no RLS. Every new query must filter on `tenant_id`,
   and every new `/brands/:id...` route must add the `requireBrandAccess` preHandler — it is
   not applied globally. Missing it is how `GET /brands/:id` leaked a sibling brand's metadata
   after the analytical routes were fixed.
7. **Never interpolate a JS `Date` into a raw drizzle `sql` fragment.** It bypasses the
   timestamptz serialiser and Postgres rejects the value at runtime. Embed typed operators
   instead — ``sql`COUNT(*) FILTER (WHERE ${gte(signals.publishedAt, since)})` `` — and cover
   it the way `test/routes/keyset.test.ts` does. This has shipped twice.
8. **Fastify strips undeclared response fields.** `fast-json-stringify` removes any property
   the response schema does not declare, silently. `GET /brands/:id/signals` returned
   `items: [{}, {}]` for exactly this reason and no unit test caught it — check every new or
   changed route against a real HTTP response.
9. **`apps/web` is client-side by necessity.** Don't convert views to Server Components while
   they depend on the Cognito SDK and browser session storage.
10. **Style with CSS custom properties.** Literal hex values break the Tweaks palette switcher.
11. **One API response convention** (since 2026-11-16): bare objects/arrays on success, Fastify's
    `{statusCode,error,message}` on error. Routes that declare error statuses use `ERROR_RESPONSE`
    from `lib/http.ts`, because fast-json-stringify strips undeclared fields.
12. **`commitlint` enforces a closed scope list.** New scope → update `commitlint.config.js`.
13. **Terraform requires `image_tag`.** `terraform apply` without it fails; that is intentional
    so local applies can't accidentally roll images back.
14. **Every request body needs `additionalProperties: false`, and every id `format: 'uuid'`.**
    Without the first, Fastify passes undeclared keys straight through — the mass-assignment hole
    in `PATCH /admin/users` (KNOWN-GAPS #31). A written brand id must also pass `brandInTenant()`.
15. **Read [`KNOWN-GAPS.md`](KNOWN-GAPS.md) and [`HANDOVER.md`](HANDOVER.md).** Most of the
    register is closed; the open items are listed in its summary table.
