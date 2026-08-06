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
2. **Score** each signal with Gemini Flash: sentiment label, score (−1…1), confidence, which
   of the five brand dimensions it touches, and topic tags.
3. **Surface** the result in a dashboard: a composite Brand Perception Index, per-dimension
   breakdown, an "Achilles Heel" ranking of the weaknesses doing the most damage, a
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
│   ├── sentiment-worker/     Pub/Sub push consumer → Gemini Flash scoring
│   ├── report-worker/        Health-check skeleton (reporting deferred, Epic 12)
│   └── web/                  Next.js 16 dashboard
├── libs/
│   ├── shared-types/         Cross-service contracts (no runtime deps)
│   ├── config/               zod-validated env loader
│   ├── db/                   Drizzle schema + postgres-js client
│   ├── gemini/               Vertex AI client wrapper
│   ├── messaging/            Pub/Sub client + env-resolved topic names
│   ├── storage/              ObjectStore interface + GCS implementation
│   ├── scoring/              Brand Perception Index: decay, dimensions, topic clusters
│   └── source-adapters/      Adapter interface + 5 implementations
├── infra/
│   ├── bootstrap/            One-shot: APIs, TF state bucket, Workload Identity Federation
│   ├── modules/              8 reusable Terraform modules
│   ├── stack/                Shared .tf for every environment
│   └── envs/                 staging.tfvars / production.tfvars
├── .github/workflows/        ci, deploy-staging, deploy-production, terraform-plan
├── scripts/build-libs.sh     Deterministic lib build used by app Dockerfiles
└── docs/                     PLAN.md, ARCHITECTURE.md, KNOWN-GAPS.md, diagram, spec
```

**Dependency direction.** `apps/*` depend on `libs/*`; libs depend on each other only in this
order (which `scripts/build-libs.sh` hard-codes):

```
config → shared-types → db → storage → scoring → gemini → messaging → source-adapters
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
`published_at`, `ingested_at`, plus four _currently unwritten_ denormalised columns
(`sentiment_label`, `sentiment_score`, `confidence`, `model_version`).

- Index `signals_tenant_brand_idx` on `(tenant_id, brand_entity_id)`
- Index `signals_published_at_idx` on `(published_at)`
- **Unique `(source_url, brand_entity_id)`** ← this is the deduplication key. Ingestion relies
  on it via `onConflictDoNothing()`.

**`sentiment_results`** — Gemini output, one row per signal.
`signal_id` (**unique**, → signals), `label`, `score` real, `confidence` real,
`dimensions` text[], `topics` text[], `model_version`, `scored_at`.
The unique constraint is what makes scoring idempotent — the worker upserts on it.

**`dimension_scores`** — daily per-brand per-dimension rollups.
`tenant_id`, `brand_entity_id`, `date`, `dimension`, `score`, `signal_count`,
**unique `(brand_entity_id, date, dimension)`**.
The table and its read endpoint exist so the dashboard can query it; **nothing writes to it
yet** — the rollup engine is Epic 11.

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

Five migrations exist, tracked in `apps/api/migrations/meta/_journal.json`:

| Tag                       | Contents                                            |
| ------------------------- | --------------------------------------------------- |
| `0000_hot_loners`         | `tenants`, `brand_entities`, `signals` + indexes    |
| `0001_fluffy_guardsmen`   | `users`, `sentiment_results`, `dimension_scores`    |
| `0002_slippery_energizer` | `source_configs`                                    |
| `0003_amused_moondragon`  | Unique `(source_url, brand_entity_id)` on `signals` |
| `0004_chief_freak`        | `brand_aliases`                                     |

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
because auth is Bearer-only with no cookies or ambient credentials), `PUBSUB_EMULATOR_HOST`,
`VERTEX_AI_LOCATION`, `SCORER_MODEL`, `REPORTER_MODEL`, `APIFY_API_KEY`, `YOUTUBE_API_KEY`.

Models are named by **use case** (`SCORER_MODEL` / `REPORTER_MODEL`), not by provider, so the
underlying model can be swapped without touching code.

### `libs/db`

Drizzle schema plus a lazily constructed postgres-js client.

```ts
import { db, client, createSql } from '@project-signal/db';

db.get(); // drizzle instance (schema-aware)
client.get(); // raw postgres-js tag — used for `SELECT 1` health pings
createSql(1); // fresh pool with an explicit max; used for migrations
```

Both `db` and `client` are lazy getters, not eagerly constructed clients — importing the lib
does not open a connection, which matters for tests and for Cloud Run cold starts.

### `libs/gemini`

Thin Vertex AI wrapper: `getVertexAI()` (memoised, configured with project + location),
`getScorerModel()`, `getReporterModel()`.

### `libs/messaging`

Memoised `getPubSub()` client — automatically targets the emulator when
`PUBSUB_EMULATOR_HOST` is set — plus `topicName(logical)`, which is how topic names must be
resolved:

```ts
topicName('item'); // ITEM_TOPIC from env, else TOPICS.ITEM_QUEUE
topicName('report'); // REPORT_TOPIC from env, else TOPICS.REPORT_QUEUE
```

The `TOPICS` constants are **local-development names only**, used against the emulator.
Terraform creates `<env>-item` / `<env>-report` and injects them as `ITEM_TOPIC` /
`REPORT_TOPIC`. Publishing to a `TOPICS` constant in a deployed environment targets a topic
that does not exist — always go through `topicName()`. An empty-string env override is treated
as unset.

### `libs/storage`

Object storage for raw ingested payloads, behind a deliberately narrow interface:

```ts
interface ObjectStore {
  put(key: string, body: string, contentType?: string): Promise<string>; // → gs://… | s3://…
  get(key: string): Promise<string>;
}
```

`getObjectStore()` returns a memoised `GcsObjectStore` built from `RAW_BUCKET`, throwing a
named error if it is unset. `rawKey(tenant, brand, source, externalId)` builds the deterministic
key (percent-encoding `externalId`, which can contain slashes); `keyFromRef()` parses a stored
reference back to a key and accepts both `gs://` and `s3://`.

Two methods is the whole surface, so the AWS migration's `S3ObjectStore` drops in behind
`getObjectStore()` without touching a caller.

### `libs/scoring`

The Brand Perception Index, implemented straight from the product spec. Pure functions with no
I/O, so the whole engine is unit-testable without a database:

```ts
recencyWeight(publishedAt, asOf); // 2^(-age/90d) — spec's 90-day half-life
scoreDimension(items, dimension, asOf); // weighted by recency × confidence → 0–100
compositeScore(rollups, weights); // the BPI; per-brand weights, renormalised
clusterTopics(items, asOf); // damage = volume × negativity × recency
achillesHeels(clusters); // top 3 by damage, zero-damage excluded
```

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
| `YoutubeAdapter`       | YouTube Data API v3                               | `channelId`                       | Last 10 videos → up to 50 top-level comments each; **HTTP 403 = comments disabled → skipped, not an error** |

`apifyClient.ts` is the shared Apify runner used by the three Apify-backed adapters:
`startApifyRun` → `waitForApifyRun` (poll every 5s, 5-minute deadline, throws on
FAILED/TIMED-OUT/ABORTED) → `fetchApifyDataset`.

**To add a source:** implement `SourceAdapter`, export it from `libs/source-adapters/src/index.ts`,
register it in the `ADAPTERS` map in `apps/ingestion/src/handler.ts`, add its credential
mapping to `getSystemCredentials()` if it needs a key, and add its form fields to
`SOURCE_FIELDS` in `apps/web/src/components/BrandManager.tsx`.

---

## 6. apps/api — REST API

Fastify 5, port **8080**, ESM, deployed to Cloud Run as a public service.

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
3. Takes Postgres advisory lock `4815162342` so concurrent Cloud Run instances serialise
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
| `POST /admin/users`                       | owner        | bare row             | Inserts the `users` row **and** calls `setCustomUserClaims(role, tenantId, brandEntityId)`.                             |
| `PATCH /admin/users/:id`                  | owner, admin | bare row             | Updates role/brand, re-syncs custom claims from the updated row. 404 if absent.                                         |
| `GET /admin/users`                        | owner, admin | bare array           | Users in the caller's tenant.                                                                                           |
| `GET /brands`                             | any          | bare array           | Tenant-scoped. A `user` with a `brandEntityId` sees **only** that brand.                                                |
| `GET /brands/:id`                         | any          | bare row             | Tenant-scoped; 404 otherwise.                                                                                           |
| `GET /brands/:id/signals`                 | any          | `{items,nextCursor}` | Cursor pagination via `limit+1` lookahead; optional `?source=`; `limit` max 100, default 50.                            |
| `GET /brands/:id/sentiment-summary`       | any          | object               | 30-day window; counts per label via `COUNT(*) FILTER (WHERE …)` plus `avg(score)`, joined signals→sentiment_results.    |
| `GET /brands/:id/dimension-scores`        | any          | bare array           | Dimension history from `dimension_scores`, `from`/`to` optional, default last 90 days. Lives in `routes/scores.ts`.     |
| `GET /brands/:id/score`                   | any          | object               | Brand Perception Index for the latest rollup, its per-dimension breakdown, and the comparison point ≥7 days earlier.    |
| `GET /brands/:id/achilles`                | any          | bare array           | Top topic clusters by damage, computed on read from `sentiment_results`. `limit` defaults to 3.                         |
| `GET /brands/:id/integrations`            | admin, owner | `{status,data}`      | List `source_configs` for the brand.                                                                                    |
| `POST /brands/:id/integrations`           | admin, owner | `{status,data}`      | **Upsert** on `(brand_entity_id, source)`.                                                                              |
| `PATCH /brands/:id/integrations/:source`  | admin, owner | `{status,data}`      | Update `isEnabled` and/or `config`. 404 if absent.                                                                      |
| `DELETE /brands/:id/integrations/:source` | admin, owner | `{status,data}`      | **Soft-disable** (`is_enabled = false`) — hard deletes are deliberately unsupported to preserve audit history.          |
| `GET /brands/:id/aliases`                 | admin, owner | `{status,data}`      | List aliases.                                                                                                           |
| `POST /brands/:id/aliases`                | admin, owner | `{status,data}`      | `onConflictDoNothing` → **409** when the alias already exists.                                                          |
| `DELETE /brands/:id/aliases/:aliasId`     | admin, owner | `{status,data}`      | Hard delete, tenant + brand scoped.                                                                                     |

Every route declares JSON Schema (`body` / `params` / `querystring` / `response`) so Swagger
output stays accurate and Fastify serialises responses fast.

> ⚠️ The three `/brands/:id/*` read endpoints scope by `tenant_id` but do **not** check the
> `:id` against `request.user.brandEntityId`. See `KNOWN-GAPS.md` #5.

### Ops script — `scripts/bootstrap-owner.ts`

Bootstraps the first owner for an environment: creates the Identity Platform user if missing,
sets the `role: owner` custom claim, and prints a password-reset link. Owner authorisation is
claim-based, so **no DB row is required** to bootstrap.

```bash
GOOGLE_CLOUD_PROJECT=<your-gcp-project> npx tsx apps/api/scripts/bootstrap-owner.ts someone@example.com
```

Uses Application Default Credentials — run `gcloud auth application-default login` first.

---

## 7. apps/ingestion — source pull

Fastify, port **8081**. Private on Cloud Run (invokable only by the Scheduler SA and itself).

### Endpoints

| Path                        | Purpose                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`, `GET /ready` | Liveness/readiness                                                                                                                                  |
| `POST /ingest`              | Run one job. Body `{ sourceConfigId }`. 400 if missing.                                                                                             |
| `POST /ingest/dispatch`     | Fan-out: selects **all** `source_configs` where `is_enabled = true` and runs each via `Promise.allSettled`; returns `{ total, succeeded, failed }`. |

Startup pings the DB (`SELECT 1`) and initialises the Pub/Sub client before listening, so a
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
   `gs://<RAW_BUCKET>/<tenant>/<brand>/<source>/<externalId>.json` via `getObjectStore()`,
   **then** insert into `signals` with the returned `gs://` reference and
   `onConflictDoNothing()`. Upload-before-insert means `raw_storage_ref` can never point at a
   missing object. The `(source_url, brand_entity_id)` unique constraint does the
   deduplication; `.returning()` is empty for a duplicate, so only genuinely new rows are
   collected.
7. Publish one Pub/Sub message per **newly created** signal id to `topicName('item')` — which
   resolves `ITEM_TOPIC` from the environment, NOT the local-dev `TOPICS` constant
   (payload = the raw uuid as a Buffer).
8. Stamp `last_fetched_at` / `updated_at` on the `source_config`.
9. Return `{ signalsCreated, signalsPublished }`.

Dedup + incremental `since` together mean a re-run of the same job is safe and cheap.

---

## 8. apps/sentiment-worker — scoring

Fastify, port **8082**. Private on Cloud Run (invokable only by the Pub/Sub push-invoker SA).

### Endpoint

`POST /pubsub/item` accepts the standard Pub/Sub push envelope:

```json
{ "message": { "data": "<base64 signal uuid>" }, "subscription": "..." }
```

It base64-decodes `message.data` to a signal id, calls `handlePubSubMessage`, and returns
**204**.

### `handlePubSubMessage(signalId)` — `src/handler.ts`

1. Load the signal; warn and return if absent (a missing signal must not be retried forever).
2. Score the text.
3. **Upsert** into `sentiment_results` with `onConflictDoUpdate` on the unique `signal_id` —
   this is the idempotency guarantee, so redelivery is harmless.
4. Errors are caught and logged, not rethrown — the message is acked rather than
   dead-lettered.

> ⚠️ Two placeholders here: the worker scores `signal.sourceUrl` because raw text is never
> persisted (it logs its own `[placeholder]` warning), and swallowing errors means genuine
> Gemini failures never reach the DLQ. See `KNOWN-GAPS.md` #4 and #9.

### `scoreSignal(text)` — `src/scorer.ts`

Prompts the scorer model for **strict JSON only**:

```json
{ "label": "positive|negative|neutral|mixed",
  "score": -1..1, "confidence": 0..1,
  "dimensions": ["trust"|"quality"|"service"|"value"|"experience"],
  "topics": ["≤5 short strings"] }
```

Response handling: pull `candidates[0].content.parts[0].text`, trim, strip ` ```json `
fences, `JSON.parse`, and stamp `modelVersion` from `getScorerModel()`. `PROMPT_TEMPLATE` is
exported so tests can assert on it.

---

## 9. apps/report-worker — deferred skeleton

Fastify, port **8083**. Only `/health` and `/ready`, exposed through an exported
`buildApp()` so tests can mount it without listening. Weekly Gemini Pro narrative reports and
PDF generation are Epic 12 — deliberately unbuilt. Its `vitest.config.ts` intentionally omits
coverage thresholds so the empty skeleton doesn't fail the 80% gate.

---

## 10. apps/web — dashboard

Next.js 16 (App Router) + React 19, port **3000**, `output: 'standalone'`.

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
  `NavActions` (`openOverview`, `openDimension`, `openCluster`, `to`, `close`) rendered as a
  breadcrumb overlay by `DrillDown`.

### Views (`src/views/`)

| View          | Contents                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| `Dashboard`   | Hero score (radial gauge or bars), dimension bars, sparklines, source volume, alert card |
| `Trends`      | 26-week multi-series line chart with legend hover-highlight                              |
| `Achilles`    | Top-3 weakness cards ranked by damage (volume × negative sentiment × recency)            |
| `Roadmap`     | Prioritised actions with impact/effort/confidence and cited evidence                     |
| `Competitors` | Animated benchmark bars, sorted, with "you" highlighted                                  |
| `Report`      | Print-styled weekly report composed from all datasets                                    |
| `Admin`       | **The only live-wired view** — see below                                                 |

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

### Live data vs mock data

**Live:** `views/Admin.tsx` (POST `/admin/tenants`) and `components/BrandManager.tsx` — which
reads `/brands` and does full CRUD against `/brands/:id/integrations` and
`/brands/:id/aliases`, with a dynamic add-source form driven by the `SOURCE_FIELDS` map.

**Mock:** everything else. `lib/data.ts` (~590 lines) generates deterministic fake data for a
fictional challenger bank called **"Cadence"** — a seeded sine-based 26-week history
generator, clusters, verbatim signals, roadmap items, competitors, and an alert. Wiring the
six dashboard views to the live API and deleting this file is Epic 6's remaining work.

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

### Ingestion → scoring (intended design)

```
Cloud Scheduler (weekly, Mon 06:00 UTC)
  └─ POST <ingestion>/ingest/dispatch      [OIDC]
       └─ for each enabled source_config → handleIngestionJob
            ├─ adapter.fetch(since = MAX(published_at))
            ├─ INSERT signals ... ON CONFLICT DO NOTHING   ← dedup
            ├─ (design) write raw payload → GCS raw bucket
            └─ publish signal id → item topic
                 └─ push subscription [OIDC] → sentiment-worker
                      ├─ scoreSignal(text) via Gemini Flash
                      └─ UPSERT sentiment_results ON CONFLICT (signal_id)  ← idempotent
                      └─ failures → item DLQ (after 5 attempts)
Hourly "pending sweep" re-publishes anything missed.
```

**Reality check:** the dispatcher runs jobs in-process instead of via Cloud Tasks; raw
payloads are never written to GCS; the push subscription targets a path the worker does not
serve; the sweep endpoint does not exist; and topic names differ between code and Terraform.
Each is itemised in `KNOWN-GAPS.md`.

### Dashboard read path

```
Web view → apiFetch('/brands/:id/sentiment-summary')
        → API: JOIN signals × sentiment_results, 30-day window, tenant-scoped
        → counts by label + avg score
```

Only the Admin view currently uses this path; the analytical views still read `lib/data.ts`.

---

## 12. Infrastructure (Terraform / GCP)

Region **`europe-west2`** (London).

**No GCP environment is currently provisioned.** The project was originally stood up in a
contractor-owned test project; on handover that environment was abandoned and every reference
to it removed. Both `infra/envs/staging.tfvars` and `infra/envs/production.tfvars` now contain
`REPLACE_ME` for `project_id` and `project_number`, and `infra/bootstrap/` has not been run
against a new project yet. Standing up staging from scratch is the first infrastructure task —
see [`../infra/README.md`](../infra/README.md).

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

### `infra/modules/` — eight modules

| Module              | What it creates                                                                                                      | Notable decisions                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud_sql`         | Postgres 16 instance, `project_signal` database, `project_signal_app` user, 32-char random password → Secret Manager | **ENTERPRISE edition** (required for shared-core tiers like `db-f1-micro`); backups enabled; **public IP with zero authorized networks** — unreachable from the internet, only via the Cloud SQL Auth Proxy. This avoids the ~$12–15/mo always-on Serverless VPC connector. |
| `cloud_run`         | Generic v2 service                                                                                                   | Scales to zero (`min_instances = 0`, `max = 2`); dynamic `env` and `secret_env` blocks; conditional Cloud SQL socket volume + mount; either `allUsers` invoker or an explicit `invoker_members` list.                                                                       |
| `service_accounts`  | One SA per runtime service + scheduler SA + pubsub-invoker SA                                                        | Least privilege: `cloudsql.client` only for the four DB users, `aiplatform.user` only for sentiment/report, log+metric writer for all; secret access scoped to the DB password secret.                                                                                      |
| `storage`           | `raw` and `reports` buckets                                                                                          | Both uniform bucket-level access + `public_access_prevention = enforced`. `raw` has a 30-day → NEARLINE lifecycle rule. Per-SA scoped IAM (ingestion writes raw, sentiment reads raw, report writes reports, API reads reports).                                            |
| `pubsub`            | `item` + `report` topics, each with a DLQ; push subscriptions; 2 DLQ pull subscriptions                              | Push uses **OIDC tokens** minted as the push-invoker SA; `max_delivery_attempts = 5`; retry backoff 10s–600s. Includes the easily-missed service-agent IAM: DLQ publisher, source-subscription subscriber, and `serviceAccountTokenCreator` on the invoker SA.              |
| `cloud_tasks`       | Rate-limited ingestion queue                                                                                         | 5 dispatches/sec, 10 concurrent, 5 attempts with 5s–300s backoff. **The rate limit is the entire point** — it protects Apify/YouTube quotas.                                                                                                                                |
| `scheduler`         | Three cron jobs                                                                                                      | ingestion `0 6 * * 1` (Mon 06:00), report `0 7 * * 1`, pending-sweep `0 * * * *` (hourly), `Etc/UTC`. Ingestion + sweep are HTTP+OIDC; report publishes to the report topic.                                                                                                |
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

Four GitHub Actions workflows. All GCP auth is keyless via Workload Identity Federation.

### `ci.yml` — PRs and pushes to `main`/`staging`

| Job            | Does                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`      | `dorny/paths-filter` computes which apps changed (each app watches its own dir plus `libs/**`, `package.json`, `yarn.lock`, `tsconfig.base.json`) |
| `code-quality` | `yarn install --immutable` → `nx run-many -t lint` → `nx run-many -t typecheck`                                                                   |
| `test`         | `nx run-many -t test -- --coverage`                                                                                                               |
| `docker-check` | Matrix over changed apps: build each Dockerfile with GHA layer cache, **no push**                                                                 |

### `deploy-staging.yml` — push to the `staging` branch (or manual)

1. `build-push` matrix over all five apps → build and push to Artifact Registry tagged both
   `staging-<short-sha>` and `staging`.
2. `deploy` → `terraform init` with `prefix=env/staging` → `terraform apply -auto-approve`
   with `-var="image_tag=staging-<short-sha>"`.

Because Terraform owns the image, that single apply deploys code and infrastructure together.

### `deploy-production.yml`

A structural mirror of staging, tagging `prod-<sha>` / `production` and using
`prefix=env/production`. The `push` trigger is **commented out** — currently
`workflow_dispatch` only — and both jobs are pinned to the `production` GitHub environment for
required-reviewer gating. The header comments list the three steps needed to enable it.

### `terraform-plan.yml` — PRs touching `infra/**`

Runs `terraform plan` for staging, tees output to a file, and posts (or **updates**, matching
on the heading) a collapsible plan comment on the PR. Output over 60,000 chars is truncated.
`continue-on-error` on the plan step plus a final explicit fail step means a broken plan still
gets commented before the job goes red.

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

Vitest 2 with V8 coverage; ~2,160 lines across 22 test files.

**Coverage gate: 80%** on lines, branches, functions and statements — enforced **per project**
in each `vitest.config.ts` rather than globally, so deferred skeletons can be exempted and
barrels excluded. `**/main.ts` is excluded everywhere (bootstrapping code). `report-worker`
has no thresholds by design.

Each project's config uses `vite-tsconfig-paths` so `@project-signal/*` aliases resolve in tests
without building the libs.

| Area           | Files                                                                | Approach                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API routes     | `admin`, `aliases`, `brands`, `integrations`, `signals`, `users`     | `test/helpers/app.ts` exposes `buildTestApp(plugin, mockUser)`, which registers `@fastify/sensible` and stubs `request.user` in an `onRequest` hook — **Firebase is never involved**. `DEFAULT_ADMIN` / `DEFAULT_OWNER` presets. |
| API plugins    | `plugins/auth.test.ts`                                               | Token parsing, public-prefix bypass, `requireRole` behaviour                                                                                                                                                                     |
| API migrations | `migrate.test.ts`                                                    | Advisory-lock and no-op-when-absent behaviour                                                                                                                                                                                    |
| Ingestion      | `handler.test.ts`                                                    | `vi.hoisted` mock chain that impersonates the Drizzle fluent builder (`select/from/where/insert/values/returning`) with a queue of result sets; adapters and Pub/Sub mocked                                                      |
| Sentiment      | `handler`, `scorer`                                                  | Upsert-on-conflict behaviour; prompt shape, fence-stripping, JSON parsing                                                                                                                                                        |
| Libs           | `config`, `gemini`, `messaging`, plus all 5 adapters + `apifyClient` | `fetch` mocked; RSS tests cover both RSS and Atom shapes                                                                                                                                                                         |

There are **no tests for `apps/web`** and no end-to-end/integration tests against a real
Postgres or emulator.

---

## 15. Local development

```bash
yarn install
cp .env.example .env
docker compose up -d        # Postgres 16 (:5432) + Pub/Sub emulator (:8085)
yarn dev                    # docker compose up -d && nx run-many -t dev --parallel
```

Migrations apply automatically when the API boots — there is no manual migrate step.

| Service          | URL                                                                      |
| ---------------- | ------------------------------------------------------------------------ |
| web              | http://localhost:3000                                                    |
| api              | http://localhost:8080 (Swagger UI at `/docs`)                            |
| ingestion        | http://localhost:8081                                                    |
| sentiment-worker | http://localhost:8082                                                    |
| report-worker    | http://localhost:8083                                                    |
| Postgres         | `postgresql://project_signal_app:password@localhost:5432/project_signal` |
| Pub/Sub emulator | localhost:8085                                                           |

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
6. **Tenant scoping is manual.** There is no RLS. Every new query must filter on
   `tenant_id` — and brand-scoped endpoints should also check `brandEntityId` for `user` role.
7. **`apps/web` is client-side by necessity.** Don't convert views to Server Components while
   they depend on the Firebase client SDK.
8. **Style with CSS custom properties.** Literal hex values break the Tweaks palette switcher.
9. **Two API response conventions exist** (`{status,data}` vs bare rows). Match the file you're
   editing and check the frontend caller before changing one.
10. **`commitlint` enforces a closed scope list.** New scope → update `commitlint.config.js`.
11. **Terraform requires `image_tag`.** `terraform apply` without it fails; that is intentional
    so local applies can't accidentally roll images back.
12. **Read [`KNOWN-GAPS.md`](KNOWN-GAPS.md).** Several pipeline links are provisioned but not
    connected — don't debug a flow that was never wired.
