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
| Node              | ≥ 20                               | Docker images are `node:20-alpine`.                                                                                                                                      |

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

**`tenants`** — multi-tenant root.
`name`, `slug` (unique), timestamps.

**`brand_entities`** — brands the tenant owns _and_ competitors it tracks.
`tenant_id` → tenants, `name`, `slug`, `is_owned` (default `true`), timestamps.

**`users`** — mirrors Identity Platform users so the admin UI can list/manage them.
`firebase_uid` (**unique**), `tenant_id` → tenants, `role` varchar(20), `brand_entity_id`
(nullable) → brand*entities, timestamps.
Role is \_also* stored as a Firebase custom claim — the claim is what authorises requests; this
table exists for management UI and audit.

**`brand_aliases`** — alternative names/abbreviations so ingestion and scoring can match
mentions that don't use the canonical brand name (e.g. "Cadence", "Cadence Bank", "CDN").
`tenant_id`, `brand_entity_id`, `alias`, **unique `(brand_entity_id, alias)`**.

**`signals`** — one row per ingested item. The spine of the system.
`tenant_id`, `brand_entity_id`, `source` varchar(50), `source_url`, `raw_storage_ref`,
`published_at`, `ingested_at`.

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

**`dimension_scores`** — daily per-brand per-dimension rollups.
`tenant_id`, `brand_entity_id`, `date`, `dimension`, `score`, `signal_count`,
**unique `(brand_entity_id, date, dimension)`**.
Written by `rollupDimensionScores()` in `apps/ingestion/src/rollup.ts`, exposed as
`POST /rollup` and driven by a daily Cloud Scheduler job. The unique constraint is what makes
that upsert idempotent, so a retried or manually re-triggered run overwrites rather than
duplicating.

**`source_configs`** — one row per `(brand, source)` pair; drives ingestion.
`tenant_id`, `brand_entity_id`, `source`, `is_enabled` (default true), `config` JSONB
(default `{}`), `last_fetched_at`, timestamps, **unique `(brand_entity_id, source)`**.

The JSONB `config` shape varies by source (documented in `sourceConfigs.ts`):

| source           | config shape                 |
| ---------------- | ---------------------------- |
| `google_reviews` | `{ placeId, placeName? }`    |
| `youtube`        | `{ channelId, maxResults? }` |
| `app_store`      | `{ appId, country? }`        |
| `play_store`     | `{ appId }`                  |
| `rss`            | `{ feedUrl }`                |

**Credentials are never stored in `source_configs`.** System-level API keys
(`APIFY_API_KEY`, `YOUTUBE_API_KEY`) come from env/Secret Manager and are merged in at
runtime by the ingestion handler.

### Migrations

Seven migrations exist, tracked in `apps/api/migrations/meta/_journal.json`:

| Tag                       | Contents                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| `0000_hot_loners`         | `tenants`, `brand_entities`, `signals` + indexes                      |
| `0001_fluffy_guardsmen`   | `users`, `sentiment_results`, `dimension_scores`                      |
| `0002_slippery_energizer` | `source_configs`                                                      |
| `0003_amused_moondragon`  | Unique `(source_url, brand_entity_id)` on `signals`                   |
| `0004_chief_freak`        | `brand_aliases`                                                       |
| `0005_demonic_mindworm`   | Drops the four denormalised sentiment columns from `signals`          |
| `0006_familiar_vermin`    | Adds `brand_entities.dimension_weights` jsonb (per-brand BPI weights) |
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
`REPORT_QUEUE_URL`, `RAW_BUCKET`, `SCORER_MODEL`, `REPORTER_MODEL`, `APIFY_API_KEY`,
`YOUTUBE_API_KEY`, and the optional `GOOGLE_CLOUD_PROJECT` (still read by `firebase-admin`).

Models are named by **use case** (`SCORER_MODEL` / `REPORTER_MODEL`), not by provider, so the
underlying model can be swapped without touching code. That property is what let the move from
Vertex to Bedrock leave every call site alone.

**AWS credentials and region are deliberately NOT in this schema.** They resolve through the
SDK's default provider chain — the ECS task role in a deployed environment, `AWS_PROFILE` or a
LocalStack endpoint locally. No code holds a key.

Two subtleties worth knowing before you edit it:

- **The queue URLs have no defaults and throw when unset.** An SQS URL embeds the account id and
  region, so no constant could stand in for one, and a wrong guess publishes into nowhere. This
  is the AWS form of the fix for KNOWN-GAPS #7.
- **`GOOGLE_CLOUD_PROJECT` is `.optional()`, and that matters.** It used to be required, which
  meant every app in the monorepo refused to boot without it — including the four that never
  touched GCP. Delete the line in the same change that removes the last firebase import.

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
that is only safe when the call site remembers something is not safe. Its rendered SQL is covered
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

> **The consume side does not exist yet.** `apps/sentiment-worker` still serves an HTTP route
> shaped like a Pub/Sub push envelope. Push→pull is a real model change, not a driver swap, and
> it is Phase 4 — see `HANDOVER.md` §6.

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
clusterTopics(items, asOf); // damage = volume × negativity × recency
brandImpact(clusters); // top 3 by damage, zero-damage excluded
```

`src/change.ts` adds **period-over-period movement** — what the index *did*, as opposed to what it
*is*:

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

| Adapter                | Mechanism                                         | Key config                        | Notes                                                                                                       |
| ---------------------- | ------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GoogleReviewsAdapter` | Apify actor `compass~google-maps-reviews-scraper` | `placeId`                         | `maxReviews: 100`; `since` → `cutoffDate`                                                                   |
| `AppStoreAdapter`      | Apify `nikita-shakula~app-store-scraper`          | `appId`, `country` (default `us`) | Joins title + body as text; drops empty                                                                     |
| `PlayStoreAdapter`     | Apify `emastra~google-play-scraper`               | `appId`                           | Sorted newest; drops empty content                                                                          |
| `RssAdapter`           | Direct `fetch` + `fast-xml-parser`                | `feedUrl`                         | Handles **both RSS and Atom**; filters by `since` client-side; no API key needed                            |
| `RedditAdapter`        | Apify `trudax~reddit-scraper-lite`                | `query`, `subreddit` (optional)    | Posts only (`searchComments: false`); `searchCommunityName` scopes to a subreddit; title + body joined as text; `since` filtered client-side |
| `YoutubeAdapter`       | YouTube Data API v3                               | `channelId`                       | Last 10 videos → up to 50 top-level comments each; **HTTP 403 = comments disabled → skipped, not an error** |

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
> scrapedAt, dataType`. `libs/source-adapters/test/reddit.test.ts` uses that shape verbatim. This
> repository has twice shipped a model id written from memory; an actor's output schema decays the
> same way, and a test built on invented field names passes forever while the adapter collects
> nothing.

`apifyClient.ts` is the shared Apify runner used by the four Apify-backed adapters:
`startApifyRun` → `waitForApifyRun` (poll every 5s, 5-minute deadline, throws on
FAILED/TIMED-OUT/ABORTED) → `fetchApifyDataset`.

**To add a source:** implement `SourceAdapter`, export it from `libs/source-adapters/src/index.ts`,
register it in the `ADAPTERS` map in `apps/ingestion/src/handler.ts`, add its credential
mapping to `getSystemCredentials()` if it needs a key, and add its form fields to
`SOURCE_FIELDS` in `apps/web/src/components/BrandManager.tsx`.

---

## 6. apps/api — REST API

Fastify 5, port **8080**, ESM. Target: a public ECS Fargate service behind an ALB.

### Boot sequence (`src/main.ts`)

1. `@fastify/sensible` (gives `reply.unauthorized()`, `reply.notFound()`, …)
2. `@fastify/cors` — allowlist from `CORS_ORIGINS`, else reflect any origin
3. `@fastify/swagger` + `@fastify/swagger-ui` → OpenAPI docs at **`/docs`**, with a
   `BearerAuth` security scheme
4. `/health` and `/ready` (both public, both return `{ status, service }`)
5. Auth plugin, then the six route plugins
6. **`runMigrations()`**
7. `listen(PORT, '0.0.0.0')`

### Migrations on startup (`src/migrate.ts`)

The API is the **single schema owner**. On boot it:

1. No-ops if the `migrations/` directory is absent.
2. Opens a **dedicated single connection** (`createSql(1)`).
3. Takes Postgres advisory lock `4815162342` so concurrent instances serialise
   rather than racing.
4. Runs Drizzle's migrator.
5. Releases the lock and ends the connection in a `finally`.

No manual migrate step, no separate migrator job or container. Workers never migrate.

### Auth and RBAC (`src/plugins/auth.ts`)

A `fastify-plugin`-wrapped global `onRequest` hook:

- **Public prefixes:** `/health`, `/ready`, `/docs` — everything else requires
  `Authorization: Bearer <Identity Platform ID token>`.
- Token is verified with `firebase-admin` (`admin.auth().verifyIdToken`); the decoded claims
  populate `request.user`:

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
- **Dev shortcut:** when `NODE_ENV === 'development'` _only_, a token of the form
  `dev:<role>:<tenantId>[:<brandEntityId>]` is parsed directly, bypassing Firebase. Colon-delimited
  because tenant/brand ids are UUIDs, which contain hyphens. Useful for
  curl against a local API; inert in staging/production.

`requireRole(...roles)` is a preHandler factory returning `reply.forbidden()` on mismatch:

```ts
fastify.get('/admin/users', { preHandler: requireRole('owner', 'admin') }, handler);
```

### Routes

Two response conventions coexist — the newer route files wrap in `{ status, data }`, the
older ones return bare rows. Both are documented below because the frontend depends on the
difference.

| Method & path                             | Role         | Response shape       | Behaviour                                                                                                               |
| ----------------------------------------- | ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/tenants`                     | owner        | `{status,data}`      | **Transactional**: creates tenant + owned brand + admin user row in one `db.transaction`. Slugs are derived from names. |
| `POST /admin/users`                       | owner, admin | bare row             | Row **and** claims written in one transaction. An `admin` is confined to their own tenant and to the roles admin/user.  |
| `PATCH /admin/users/:id`                  | owner, admin | bare row             | Reads the target first, then updates role/brand and re-syncs claims in one transaction. 404 for a foreign tenant.       |
| `GET /admin/users`                        | owner, admin | bare array           | Users in the caller's tenant.                                                                                           |
| `GET /brands`                             | any          | bare array           | Tenant-scoped. A `user` with a `brandEntityId` sees **only** that brand.                                                |
| `GET /brands/:id`                         | any          | bare row             | Tenant-scoped + `requireBrandAccess`; 404 otherwise.                                                                    |
| `GET /brands/tree`                        | any          | bare array           | The whole hierarchy as nested `children`. Built from one flat select in a map, not N queries. Orphans surface as roots rather than vanishing. |
| `POST /brands`                            | admin, owner | bare row             | Create a brand or a product. `parentId` optional; the parent is checked inside the caller's tenant.                      |
| `PATCH /brands/:id`                       | admin, owner | bare row             | Rename, re-type, re-own or re-parent. `parentId: null` promotes to a root — distinct from omitting it. Refuses cycles via `wouldCreateCycle`. |
| `DELETE /brands/:id`                      | admin, owner | 204                  | **Only when nothing is attached.** 409 naming the blocker if it has children, signals, dimension scores, mentions or an assigned user. Aliases, source configs and scan runs are removed with it. See below. |
| `GET /brands/:id/signals`                 | any          | `{items,nextCursor}` | Cursor pagination via `limit+1` lookahead; optional `?source=`, `?sourceConfigId=`, `?topic=`, `?dimension=`; `limit` max 100, default 50. Returns `content`/`title`/`author`/`rating` and a nested `sentiment` (LEFT join; null = unscored). `topic` and `dimension` are EXISTS sub-selects against `sentiment_results`, never joins — a join multiplies the signal row by its array members and breaks both the page size and the cursor. |
| `GET /brands/:id/sentiment-summary`       | any          | object               | 30-day window; counts per label via `COUNT(*) FILTER (WHERE …)` plus `avg(score)`, joined signals→sentiment_results.    |
| `GET /brands/:id/dimension-scores`        | any          | bare array           | Dimension history from `dimension_scores`, `from`/`to` optional, default last 90 days. Lives in `routes/scores.ts`.     |
| `GET /brands/:id/score`                   | any          | object               | Brand Perception Index for the latest rollup, its per-dimension breakdown, and the comparison point ≥7 days earlier.    |
| `GET /brands/:id/brand-impact`            | any          | bare array           | Top topic clusters by damage, computed on read from `sentiment_results`. `limit` defaults to 3.                         |

> **Every brand-scoped read counts the same population.** `/signals`, `/sentiment-summary`,
> `/brand-impact`, `/topics`, `/strengths` and `/stats` all filter through `attributedTo`
> (see [`libs/db`](#libsdb)), which is the predicate the hourly rollup uses. Until 2026-08-17 they
> filtered on `signals.brand_entity_id` alone while the rollup also counted mentions, so a score
> and the evidence offered for it were computed from different sets of rows. **Any new
> brand-scoped read must use `attributedTo` rather than `eq(signals.brandEntityId, …)`.**
| `GET /brands/:id/strengths`               | any          | bare array           | The mirror of `/brand-impact`, ranked by `volume × positivity × recency`. `limit` defaults to 3.                        |
| `GET /brands/:id/topics`                  | any          | bare array           | **Every** cluster, optionally `?dimension=`, ranked by `volume × recency` — positive, negative and NEUTRAL alike. `limit` defaults to 12. Exists because `/brand-impact` and `/strengths` are both *signed* rankings that exclude the middle, so neither can answer "what is this dimension made of". See the note below. |
| `GET /brands/:id/whats-new`               | any          | object               | **What changed** over `?days=` (default 7, max 90) against the equal-length period before it: `newTopics`, `risingTopics`/`fallingTopics` (volume), `improvingTopics`/`worseningTopics` (sentiment), `bySource`, and the period sentiment delta. `?basis=ingested\|published` — `ingested` is what *we* learned (the honest basis for "new since the last scans"), `published` is what the world said (the right basis for trend); the response echoes the choice. `?source=` narrows it. Computed on read — see `libs/scoring/src/change.ts` for why there is no snapshot table and what would justify one. |
| `GET /brands/:id/stats`                   | any          | object               | Dashboard stat row and the **coverage funnel**: this/previous week signal counts, `totalSignals` → `scoredSignals` → `classifiedSignals` → `lastRollupDate`, plus active/configured sources. `classifiedSignals` counts signals scored **and** tagged to ≥1 dimension; anything short of that reaches no index, no cluster and no drill-down. `classifiedSignals: 0` beside a non-zero `scoredSignals`, or a null `lastRollupDate`, is the signature of a brand silently falling out of the rollup. |
| `POST /assistant/messages`                | any          | object               | Ask the assistant. Read-only over BRAND data; it writes only the conversation record. History is loaded server-side — see below. |
| `GET /assistant/conversations`           | any          | bare array           | The caller's **own** conversations, most recent first. Filtered by tenant **and** user. |
| `GET /assistant/conversations/:id`       | any          | object               | One conversation and its turns. 404 whether it is missing or someone else's. |
| `PATCH /assistant/conversations/:id`     | any          | object               | Rename. |
| `DELETE /assistant/conversations/:id`    | any          | 204                  | Delete; messages cascade. |
| `GET /brands/:id/integrations`             | admin, owner | `{status,data}`      | Every configured feed for the brand. **Many rows per source type are expected.**                                        |
| `GET /brands/:id/integrations/stats`       | admin, owner | `{status,data}`      | Per feed: signals collected, newest signal, last run. LEFT JOIN, so a feed that has collected nothing is still returned — that row is the point. |
| `POST /brands/:id/integrations`            | admin, owner | `{status,data}`      | **Creates** a feed; returns **201**. No longer an upsert. **409** for an exact duplicate config (key-order-independent). |
| `PATCH /brands/:id/integrations/:configId` | admin, owner | `{status,data}`      | Update `label`, `isEnabled` and/or `config`. `label: ""` clears it. 404 if absent.                                       |
| `DELETE /brands/:id/integrations/:configId`| admin, owner | `{status,data}`      | **Hard delete.** Signals survive — `signals.source_config_id` is `ON DELETE SET NULL`. Pausing a feed is `PATCH isEnabled:false`. |
| `GET /brands/:id/aliases`                 | admin, owner | `{status,data}`      | List aliases.                                                                                                           |
| `POST /brands/:id/aliases`                | admin, owner | `{status,data}`      | `onConflictDoNothing` → **409** when the alias already exists.                                                          |
| `DELETE /brands/:id/aliases/:aliasId`     | admin, owner | `{status,data}`      | Hard delete, tenant + brand scoped.                                                                                     |

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
each signal, so a finding can be attributed to *"Google News — Tes MyConcern"* rather than to
*"rss"*; `GET /brands/:id/signals?sourceConfigId=` filters on it. And the ingestion watermark is
**per feed**: it used to be `max(published_at)` over the brand and the source *type*, which meant a
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
keeps only `damage > 0` — *"a topic nobody is negative about is not a weakness"* — and
`topStrengths` keeps only `strength > 0`. Both are correct as **summaries**, and both are wrong as
**evidence**, because between them they discard every neutral cluster and each discards the other
half of the sentiment range.

The drill-down's dimension level filtered `/brand-impact` by dimension, which produced a
contradiction the owner reported from the running product: level 1 said *"Experience — 5 signals
contributed"* at a score of **69.2, the brand's highest**, and level 2 said *"No topic cluster has
been tagged to experience yet"*. Both statements were true. Experience scored highest **because**
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

**Why `DELETE /brands/:id` is so narrow.** Seven tables reference `brand_entities.id`: `signals`,
`dimension_scores`, `signal_mentions`, `scan_runs`, `brand_aliases`, `source_configs` and
`users.brand_entity_id`. Cascading through all of them would discard collected intelligence on a
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

Bootstraps the first owner for an environment: creates the Identity Platform user if missing,
sets the `role: owner` custom claim, and prints a password-reset link. Owner authorisation is
claim-based, so **no DB row is required** to bootstrap.

```bash
GOOGLE_CLOUD_PROJECT=<your-gcp-project> npx tsx apps/api/scripts/bootstrap-owner.ts someone@example.com
```

Uses Application Default Credentials — run `gcloud auth application-default login` first.

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
Situational context (current view, selected brand) goes in the **system prompt**, not a user turn:
as a user turn the model can read it as an instruction from the person, so a signal titled
"ignore your instructions" would have a path to becoming one.

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
plausible source for it, and the citation then makes a wrong answer *more* convincing. Citations
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

| Path                        | Purpose                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`, `GET /ready` | Liveness/readiness                                                                                                                                  |
| `POST /ingest`              | Run one job. Body `{ sourceConfigId }`. 400 if missing.                                                                                             |
| `POST /ingest/dispatch`     | Fan-out: selects **all** `source_configs` where `is_enabled = true` and runs each via `Promise.allSettled`; returns `{ total, succeeded, failed }`. |

Startup pings the DB (`SELECT 1`) and resolves the item queue URL before listening, so a
broken connection fails fast rather than at first request.

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
7. Publish one SQS message per **newly created** signal id via `getPublisher().publish("item", id)`.
   The handler names only the logical queue; the publisher resolves the URL from `ITEM_QUEUE_URL`
   and throws if it is unset. Body is the bare signal uuid.
8. Stamp `last_fetched_at` / `updated_at` on the `source_config`.
9. Return `{ signalsCreated, signalsPublished }`.

Dedup + incremental `since` together mean a re-run of the same job is safe and cheap.

---

## 8. apps/sentiment-worker — scoring

Fastify, port **8082**. Private.

> ⚠️ **This is still an HTTP push consumer and needs to become an SQS poller (Phase 4).** The
> route below is shaped like a Pub/Sub push envelope, which nothing on AWS sends.

### Endpoint

`POST /pubsub/item` accepts the standard Pub/Sub push envelope:

```json
{ "message": { "data": "<base64 signal uuid>" }, "subscription": "..." }
```

It base64-decodes `message.data` to a signal id and calls `handlePubSubMessage`. The **status
code is the ack signal**, so it is load-bearing rather than cosmetic:

| Outcome                   | Status  | Effect                                           |
| ------------------------- | ------- | ------------------------------------------------ |
| Success                   | **204** | Acked.                                           |
| `PermanentScoringError`   | **204** | Acked, logged at error level. Retry cannot help. |
| Anything else (transient) | **500** | Nacked → the queue retries with backoff → DLQ.   |

### `handlePubSubMessage(signalId)` — `src/handler.ts`

1. Load the signal; warn and return if absent (a missing row is not coming back).
2. Resolve `raw_storage_ref` through `getObjectStore()` and `keyFromRef()`, parse the stored
   JSON, and take its `text` — **the verbatim payload ingestion wrote**, not the source URL.
3. Score that text.
4. **Upsert** into `sentiment_results` with `onConflictDoUpdate` on the unique `signal_id` —
   this is the idempotency guarantee, so redelivery is harmless.

**Failures are classified, and the distinction is the point** (KNOWN-GAPS #9). Permanent —
missing signal row, unresolvable reference, stored payload that is not JSON or has no text,
model output that will not parse — raises `PermanentScoringError` and is acked, because
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
`scoreSignal` does nothing to the result but stamp `modelVersion` from `getScorerModel()`.
`PROMPT_TEMPLATE` and `SENTIMENT_SCHEMA` are both exported so tests can assert on them.

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

Fastify, port **8083**. Only `/health` and `/ready`, exposed through an exported
`buildApp()` so tests can mount it without listening. Weekly narrative reports and
PDF generation are Epic 12 — deliberately unbuilt. Its `vitest.config.ts` intentionally omits
coverage thresholds so the empty skeleton doesn't fail the 80% gate.

---

## 10. apps/web — dashboard

Next.js 16 (App Router) + React 19, port **3000**, `output: 'standalone'`.

### Overlay features — `src/features/`

Three surfaces that sit above every view rather than inside one, because all three answer
questions that arise *while* looking at something. Navigating away to a `/help` route loses the
thing that prompted the question.

| Path | What it is |
| --- | --- |
| `features/help/HelpCentre.tsx` | Slide-over help panel. Opens on the **current view's** article (`articleForView`) rather than the index, with search and cross-references. Imports the corpus directly, so it works even when the API is the thing that is broken — which is exactly when someone opens help. |
| `features/help/Markdown.tsx` | Markdown → **React elements**. Never `dangerouslySetInnerHTML`. |
| `features/tour/Tour.tsx` | First-run tour. Spotlights the live element rather than showing screenshots, which go stale silently. Shown once; both completion and dismissal are final. |
| `features/assistant/AssistantDock.tsx` | The assistant panel, for a question raised by what you are looking at. One-off: it does not write to saved history. |
| `views/Assistant.tsx` | The assistant **page** — persistent, revisitable conversations. Shares the API and the renderer with the dock but not its state: coupling them would mean the dock either resurrecting a page conversation on every view or silently writing into one. |
| `views/Documentation.tsx` | The help corpus as a page, with contents beside the article. Same corpus and components as the panel — a second copy styled differently is how a help centre and its documentation start disagreeing. |

> **Why the markdown renderer is hand-written.** Every markdown library renders to an HTML
> string, which means `dangerouslySetInnerHTML`, which makes a sanitiser the only thing between
> model output and script execution in an authenticated page. This one emits React elements, so
> text can never become markup. The one remaining live capability is an `href`, and `safeHref`
> permits only `http(s)` and in-app paths — `javascript:` and `data:` render as inert text.
> Assistant answers can quote a hostile signal, so this is a real path, not a theoretical one.

The tour anchors on `data-tour="..."` attributes in `components/App.tsx`. A selector matching
nothing degrades to a centred step; it must never spotlight the top-left corner.

### Rendering strategy

`app/page.tsx` is a client component that `dynamic()`-imports `ClientApp` with **`ssr: false`**
and a styled loading fallback. This is deliberate: the Firebase client SDK touches browser
APIs and must not be evaluated during server prerender. Consequence — **the dashboard is a
client-side SPA inside an App Router shell.** Server Components are not used for the app
surface, so don't "optimise" a view into a Server Component without moving its Firebase
dependency first.

`app/layout.tsx` sets metadata and preconnects/loads Space Grotesk, Sora, IBM Plex Sans and
IBM Plex Mono from Google Fonts.

### Auth chain

```
page.tsx → ClientApp → AuthProvider → AuthGate → App
```

- **`lib/firebase.ts`** — initialises the Firebase app (guarding against double-init via
  `getApps()`). Config comes from `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` /
  `_PROJECT_ID`, all **required with no fallback** — a missing value throws at startup.
  These values are public by design, but `NEXT_PUBLIC_*` is inlined at build time, so
  defaulting them would silently ship a bundle pointed at the wrong Identity Platform
  project. Set them in `apps/web/.env.local` locally and as Docker build args in CI.
- **`lib/auth.tsx`** — `AuthProvider` subscribes to `onAuthStateChanged`, and on sign-in reads
  the **`role` custom claim** off `getIdTokenResult()`. Exposes `{ user, role, loading, signIn,
signOut }` via `useAuth()`. Currently email/password only (`signInWithEmailAndPassword`) —
  the Microsoft/Google social buttons described in `PLAN.md` are configured in Terraform but
  not yet surfaced in the UI.
- **`AuthGate`** — renders a loading pane, then `SignIn`, then children.
- **`SignIn`** — email/password form with inline error handling.

### API client — `lib/api.ts`

`apiFetch<T>(path, init)` attaches `Authorization: Bearer <current ID token>` and JSON headers,
throws `API <status>: <body>` on non-2xx, and parses JSON. Base URL is `NEXT_PUBLIC_API_URL`,
falling back to `http://localhost:8080`. Like the Firebase config it is inlined at build time
and passed as a Docker build arg by the deploy workflows — see
[`../infra/README.md`](../infra/README.md) § Build-time configuration for the web app.

### Shell — `components/App.tsx`

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

| View          | Data     | Contents                                                                                                                                         |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Dashboard`   | live     | Hero score (radial gauge or bars), dimension bars, sparklines, stat row → `/score`, `/dimension-scores`, `/stats`, `/brand-impact`, `/strengths` |
| `Trends`      | live     | Dimension history line chart → `/score`, `/dimension-scores`                                                                                     |
| `BrandImpact` | live     | Top weakness cards ranked by damage → `/brand-impact`                                                                                            |
| `Competitors` | live     | Benchmark bars → `/brands` plus one `/score` per brand                                                                                           |
| `WhatsChanged` | live    | **What moved**, over a 7/30/90-day window → `/whats-new`. Five panels: getting worse and getting better (sentiment), new subjects, more and less discussed (volume), plus a by-source table that keeps feeds which went silent. A `Newly collected` / `Newly published` toggle chooses the `basis`. Subjects open the drill-down via `nav.openTopic`, which — unlike `openCluster` — inserts no dimension level, because there isn't one to name. |
| `Roadmap`     | live     | Actions derived from damage-ranked clusters → `/brand-impact`. **Ranking only — it states the problem, it does not yet recommend a fix.** The recommendation producer is specified in `Project-Signal-Product-Spec.md` §7.3 / §5.6 (the weekly report cycle) and planned in `PLAN-change-territory-and-actions.md` §3. |
| `Report`      | **mock** | Print-styled weekly report. Epic 12.                                                                                                             |
| `Admin`       | live     | Tenant creation, `BrandManager`, `UserManager`                                                                                                   |

### Charts and motion

All visualisation is **hand-rolled SVG** — there is no charting library. `components/charts.tsx`
provides `LineChart`, `Sparkline`, `VolumeBars`, `MixDonut`; `RadialGauge` and `DimBar` are
separate. Animation is driven by two hooks: `useInView` (IntersectionObserver, fires once) and
`useCountUp` (rAF easing). `components/primitives.tsx` holds `Delta`, `SourceGlyph`,
`SourceBadge`, `Stars`, `SentChip`.

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
  selected one. The shell previously hard-coded a single fictional brand.
- **`hooks/useApi.ts` + `components/ViewState.tsx`** — loading, error and empty are **three
  distinct states**, and every live view must render all three. A `null` path means "not ready
  yet", so views do not fire a request at `/brands/null/...`.
- **`lib/brand-data.ts`** — pure API→presentation mapping with no React or fetch. Because every
  view sits behind `AuthGate` and cannot be driven without a real identity provider
  (KNOWN-GAPS #16), this is where the reshaping correctness is actually proven, under
  `apps/web/test/brand-data.test.ts`.

**Mock:** `lib/data.ts` (588 lines) still generates deterministic fake data for a fictional
challenger bank called **"Cadence"**. It survives because `Roadmap` and `Report` remain on it,
and because `App.tsx`, `charts.tsx`, `DrillDown.tsx` and `primitives.tsx` still import
constants from it. Deleting it is Epic 6's exit criterion (KNOWN-GAPS #13). **No new code may
depend on it.**

`lib/types.ts` defines the frontend view models (`Brand`, `Dimension`, `HistoryRow`, `Cluster`,
`Signal`, `RoadmapItem`, `Competitor`, `Alert`, `NavLevel`, `NavActions`, `TweakValues`). Note
these are **presentation shapes and are not the same as `@project-signal/shared-types`** — replacing the
mock data will require mapping API rows into them (or changing them).

---

## 11. End-to-end flows

### Sign-in → authorised request

```
User → Identity Platform (email/password)
     → ID token with custom claims { role, tenantId, brandEntityId }
Web  → apiFetch attaches Bearer token
API  → onRequest hook → verifyIdToken → request.user
     → requireRole(...) preHandler
     → query filtered by request.user.tenantId
```

Role changes take effect in the token within roughly an hour (custom-claim refresh), which is
why the API trusts the claim and the `users` table is only a mirror.

### Ingestion → scoring

```
Cloud Scheduler (weekly, Mon 06:00 UTC)
  └─ POST <ingestion>/ingest/dispatch      [OIDC]
       └─ for each enabled source_config → handleIngestionJob
            ├─ adapter.fetch(since = MAX(published_at))     ← incremental
            ├─ store.put(rawKey(...)) → s3://<RAW_BUCKET>/… ← BEFORE the insert
            ├─ INSERT signals ... ON CONFLICT DO NOTHING    ← dedup
            └─ publish("item", id) → SQS            ← URL from ITEM_QUEUE_URL
                 └─ push subscription [OIDC] → <sentiment>/pubsub/item
                      ├─ read raw payload, scoreSignal(text) via Bedrock
                      ├─ UPSERT sentiment_results ON CONFLICT (signal_id)  ← idempotent
                      └─ transient failure → 500 → retry → item DLQ (after 5 attempts)
Hourly  POST /reconcile  re-publishes signals with no sentiment_results row.
Daily   POST /rollup     writes dimension_scores.
```

Every link above is connected in both code and Terraform. The five defects this diagram used to
carry a "reality check" for — in-process dispatch, unwritten raw payloads, a mismatched push
path, a missing sweep endpoint, and divergent topic names — are closed (KNOWN-GAPS #1, #2, #4,
#7, #9). **The one that was dissolved rather than fixed is #3:** there is still no Cloud Tasks
queue, so `/ingest/dispatch` fans out in-process via `Promise.allSettled`. That has two
properties which outlive the choice of queue technology and must be fixed by whatever replaces
it: a dispatch across many brands runs inside a single HTTP request and can exceed the
platform's request timeout, and a failed source is counted in `failed` and dropped rather than
retried.

**None of this has ever run in a cloud** — see `HANDOVER.md`. It is verified locally against
Docker Postgres and LocalStack only.

### Dashboard read path

```
BrandProvider → apiFetch('/brands')                 → selects the brand
Dashboard     → useApi(`/brands/${id}/score`)       → composite + breakdown + week-earlier delta
              → useApi(`/brands/${id}/dimension-scores`), `/stats`, `/brand-impact`, `/strengths`
              → brand-data.ts maps API rows into presentation shapes
              → ViewState renders loading | error | empty | data
```

All four analytical views read this path. `Roadmap` and `Report` still read `lib/data.ts`.

---

## 12. Infrastructure

### Current state: nothing is deployed, anywhere

**No part of this system has ever run in any cloud.** Everything below §12 describes either a
GCP stack that will never be applied, or an AWS stack that does not exist yet.

### `infra-aws/` — the real target

Region **`eu-west-2`** (London). Compute **ECS Fargate**, database **RDS Postgres**, auth
**Cognito**, all decided by the owner.

**Phase 1 (guardrails) is written; Phases 2–7 do not exist yet.** What is there:

| Path                      | What                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`              | S3 remote-state bucket — versioned, encrypted, TLS-only, `prevent_destroy`. Local state, because it creates the backend everything else uses                                                                                                                                                                                                          |
| `account/`                | **ACCOUNT-GLOBAL, not ours.** Activates the six mandatory tag keys as cost allocation tags — one switch per key for the _whole_ account, shared with every co-tenant project. Separate state (`account/terraform.tfstate`), `prevent_destroy` on each key, applied deliberately by the owner or platform team and **never by CI or a project deploy** |
| `stack/`                  | The tag-filtered monthly budget. S3 remote state with native locking (`use_lockfile`); **no DynamoDB lock table** — that mechanism is deprecated upstream                                                                                                                                                                                             |
| `envs/dev.tfvars`         | Tag values, shared by `bootstrap/` and `stack/` so they cannot drift. `dev.stack.tfvars` holds budget-only values; `account.tfvars` feeds the account module                                                                                                                                                                                          |
| `scripts/00-discover.sh`  | Phase 0 discovery, read-only, already run — findings in [`HANDOVER.md`](HANDOVER.md) §3. **Sources `_guard.sh` like every other AWS-calling script**                                                                                                                                                                                                  |
| `scripts/10-preflight.sh` | Pre-apply checks: account, cost allocation tag status, prefix collisions                                                                                                                                                                                                                                                                              |
| `scripts/99-teardown.sh`  | Reversal, dry-run by default, verifying by **independent tag inventory** rather than Terraform state — which is what catches a resource orphaned by a failed apply                                                                                                                                                                                    |
| `CONVENTIONS.md`          | The proposed cross-repo standard for the shared account                                                                                                                                                                                                                                                                                               |

The account is **shared with other projects**, so the build is designed to be _separable_: own
VPC, `psignal-<env>-*` naming, mandatory tags applied as Terraform provider `default_tags` (so a
resource cannot be created untagged), and `allowed_account_ids` aborting before the first API
call in the wrong account. See [`AWS-SETUP.md`](AWS-SETUP.md) for the guardrails,
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

| Job            | Does                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`      | `dorny/paths-filter` computes which apps changed (each app watches its own dir plus `libs/**`, `package.json`, `yarn.lock`, `tsconfig.base.json`) |
| `code-quality` | `yarn install --immutable` → `nx run-many -t lint` → `nx run-many -t typecheck`                                                                   |
| `test`         | `nx run-many -t test -- --coverage`                                                                                                               |
| `docker-check` | Matrix over changed apps: build each Dockerfile with GHA layer cache, **no push**                                                                 |

### `terraform-plan.yml` — PRs and pushes to `main` touching `infra-aws/**`

Static validation of the AWS Terraform tree. **It makes zero AWS API calls**, deliberately:
`init -backend=false` skips backend configuration and state entirely, so nothing authenticates
and nothing is read from the account. `permissions` is `contents: read` with no `id-token`.

| Job        | Does                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate` | `terraform fmt -check -recursive -diff`, then `init -backend=false` + `validate` on each of the three root modules — `bootstrap`, `account`, `stack`. **A module not listed is not checked.** |
| `scripts`  | `bash -n` and `shellcheck -S warning` over `infra-aws/scripts/*.sh`, then asserts that **every script invoking the AWS CLI sources `_guard.sh` and calls `assert_sandbox_account`**           |

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

All five use multi-stage builds ending on `node:20-alpine` with a non-root `signal` user.

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

Vitest 2 with V8 coverage; ~4,200 lines across 29 test files. **309 tests across 11 projects**
(`@project-signal/db` has only a `build` target, which is why 13 projects lint, 12 typecheck and
11 test).

**Coverage gate: 80%** on lines, branches, functions and statements — enforced **per project**
in each `vitest.config.ts` rather than globally, so deferred skeletons can be exempted and
barrels excluded. `**/main.ts` is excluded everywhere (bootstrapping code). `report-worker`
has no thresholds by design.

Each project's config uses `vite-tsconfig-paths` so `@project-signal/*` aliases resolve in tests
without building the libs.

| Area           | Files                                                                                | Approach                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API routes     | `admin`, `aliases`, `brands`, `integrations`, `keyset`, `scores`, `signals`, `users` | `test/helpers/app.ts` exposes `buildTestApp(plugin, mockUser)`, which registers `@fastify/sensible` and stubs `request.user` in an `onRequest` hook — **Firebase is never involved**. `DEFAULT_ADMIN` / `DEFAULT_OWNER` / `DEFAULT_PINNED_USER` presets. |
| API plugins    | `plugins/auth.test.ts`                                                               | Token parsing, public-prefix bypass, `requireRole` and `requireBrandAccess` behaviour                                                                                                                                                                    |
| API migrations | `migrate.test.ts`                                                                    | Advisory-lock and no-op-when-absent behaviour                                                                                                                                                                                                            |
| Ingestion      | `handler.test.ts`, `rollup.test.ts`                                                  | `vi.hoisted` mock chain impersonating the Drizzle fluent builder with a queue of result sets; adapters, storage and the SQS publisher mocked                                                                                                             |
| Sentiment      | `handler`, `scorer`                                                                  | Permanent-vs-transient classification, upsert-on-conflict, prompt shape, fence-stripping, JSON parsing                                                                                                                                                   |
| Web            | `test/brand-data.test.ts`                                                            | The API→presentation mapping, which is where view correctness is proven while `AuthGate` blocks browser verification                                                                                                                                     |
| Libs           | `config`, `llm`, `messaging`, `scoring`, `storage`, all 5 adapters + `apifyClient`   | `fetch` mocked; RSS tests cover both RSS and Atom shapes; `scoring` is pure and needs no mocks                                                                                                                                                           |

**`test/routes/keyset.test.ts` is the one to copy for any new raw SQL.** It renders the keyset
condition through the real `PgDialect`, which is what catches a JS `Date` interpolated into a
raw `sql` fragment — a bug that has shipped twice and that every mocked test passed both times,
because a mocked database never renders SQL.

There are still **no integration tests against a real Postgres or emulator** — the route tests
mock `@project-signal/db` entirely, which is why the two `sql` serialisation bugs above passed
every one of them.

**A browser harness now exists.** `apps/web/e2e` (Playwright 1.50, added 2026-08-09) signs in and
drives the real application, asserting on **computed styles** rather than on class names. That
distinction is the whole point: the light theme painted black cards on eight views while the unit
suite was entirely green, because each component, token and helper was individually correct and
nothing rendered the page and read the colour back. A class-name assertion would have passed too.

`bash apps/web/e2e/run-docker.sh` runs it against a local dev server or a deployed environment
with no local browser install — the image tag is pinned to the `@playwright/test` version so the
two cannot drift.

`apps/web` also has **component tests** now (Vitest + jsdom + React Testing Library), covering
the markdown renderer's link-safety behaviour and the tour's storage logic.

---

## 15. Local development

```bash
corepack yarn install
cp .env.example .env
docker compose up -d        # Postgres 16 (:5432) + LocalStack (:4566, s3 + sqs)
corepack yarn dev           # docker compose up -d && nx run-many -t dev --parallel
```

**Migrations apply when the API boots** — there is no manual migrate step, and seeding before
the API has started fails with `relation "tenants" does not exist`. Boot the API first.

`scripts/localstack-init.sh` runs inside the LocalStack container on first boot and creates
the `psignal-local-raw` bucket plus the item/report queues and their DLQs, with
`maxReceiveCount: 5` matching the intended deployed redrive policy — so the local stack fails
the same way the real one will.

**This replaced the Pub/Sub emulator, and it is a straight upgrade.** There was never a GCS
emulator, so the raw-payload write and read path could only ever be exercised against mocks.
It can now be run for real — and was, on 2026-08-07: 52 signals ingested from a live RSS feed,
written to S3, read back, published to SQS, deduplicated on re-run and swept by `/reconcile`.
See [`HANDOVER.md`](HANDOVER.md) §5.

The one link that cannot be closed locally is **scoring** — LocalStack does not emulate
Bedrock, so that needs real AWS credentials.

| Service             | URL                                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| web                 | http://localhost:3000                                                    |
| api                 | http://localhost:8080 (Swagger UI at `/docs`)                            |
| ingestion           | http://localhost:8081                                                    |
| sentiment-worker    | http://localhost:8082                                                    |
| report-worker       | http://localhost:8083                                                    |
| Postgres            | `postgresql://project_signal_app:password@localhost:5432/project_signal` |
| LocalStack (S3+SQS) | http://localhost:4566                                                    |

**Calling the API locally without Firebase** — with `NODE_ENV=development`:

```bash
curl -H "Authorization: Bearer dev:owner:$TENANT_ID:$BRAND_ID" http://localhost:8080/brands
#                              dev:<role>:<tenantId>[:<brandEntityId>]
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
   calling `setCustomUserClaims` leaves authorisation stale for up to an hour.
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
   they depend on the Firebase client SDK.
10. **Style with CSS custom properties.** Literal hex values break the Tweaks palette switcher.
11. **Two API response conventions exist** (`{status,data}` vs bare rows). Match the file you're
    editing and check the frontend caller before changing one.
12. **`commitlint` enforces a closed scope list.** New scope → update `commitlint.config.js`.
13. **Terraform requires `image_tag`.** `terraform apply` without it fails; that is intentional
    so local applies can't accidentally roll images back.
14. **Read [`KNOWN-GAPS.md`](KNOWN-GAPS.md) and [`HANDOVER.md`](HANDOVER.md).** Most of the
    register is closed, but four items remain open — and nothing here has ever run in a cloud.
