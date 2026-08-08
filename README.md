# Project Signal

AI-powered brand intelligence platform by Wayne Strydom.

Project Signal ingests public brand signals (reviews, app-store feedback, YouTube comments, RSS),
scores them for sentiment with **Claude on Amazon Bedrock**, and surfaces a Brand Perception
Index, a "Brand impact" analysis and an action roadmap — with a full audit trail, multi-tenant
and role-scoped.

> ### Status: code-complete on AWS libraries, verified locally, **deployed nowhere**
>
> The system was built for GCP and never deployed there. On 2026-08-06 the owner decided to go
> straight to AWS; `libs/storage`, `libs/messaging` and `libs/llm` now run on **S3, SQS and
> Bedrock**. Auth (Firebase) is the only Google dependency left.
>
> The pipeline has been run end to end for real — **locally**, against LocalStack. **Nothing has
> ever run in any cloud.** See [`docs/HANDOVER.md`](docs/HANDOVER.md) §5 for the exact line
> between what is proven and what is assumed.

## Documentation

Read in this order.

| Document                                                                | Read it for                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`docs/HANDOVER.md`](docs/HANDOVER.md)**                              | **Start here.** Current state, proven vs assumed, verified AWS account facts, the phase plan, the regression checklist. Written for a reader with no prior context. |
| [`DEVRULES.md`](DEVRULES.md)                                            | The operating rules. Verify, never assume.                                                                                                                          |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                          | Complete code-accurate reference: every app, lib, table, route and module, plus end-to-end flows and editing gotchas.                                               |
| [`docs/AWS-SETUP.md`](docs/AWS-SETUP.md)                                | The AWS runbook and its guardrails. Phase 0 discovery is executable and read-only.                                                                                  |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)                              | The defect register — 17 of 19 closed. The closed entries explain _why_ things are as they are.                                                                     |
| [`docs/PLAN.md`](docs/PLAN.md)                                          | Design rationale, key decisions, epic status.                                                                                                                       |
| [`docs/SETUP.md`](docs/SETUP.md) · [`infra/README.md`](infra/README.md) | **Superseded.** GCP setup and Terraform, kept as the clearest specification of what each service needs. Will never be applied.                                      |

## Quick start

```bash
# 1. Install dependencies (Yarn 4 — not npm, not pnpm)
corepack yarn install

# 2. Copy env and start local services (Postgres 16 + LocalStack for S3/SQS)
cp .env.example .env
docker compose up -d

# 3. Start all apps in watch mode
corepack yarn dev
```

**Migrations are applied by the API on startup** — there is no migrate step. Boot the API before
seeding, or `yarn db:seed` fails with `relation "tenants" does not exist`.

| Service               | Local URL                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| web                   | http://localhost:3000                                                            |
| api                   | http://localhost:8080 (Swagger UI at `/docs`)                                    |
| ingestion             | http://localhost:8081                                                            |
| sentiment-worker      | http://localhost:8082                                                            |
| report-worker         | http://localhost:8083                                                            |
| Postgres              | localhost:5432 (user `project_signal_app`, db `project_signal`, pass `password`) |
| LocalStack (S3 + SQS) | http://localhost:4566                                                            |

`scripts/localstack-init.sh` runs inside the container on first boot and creates the
`psignal-local-raw` bucket, the item/report queues and their DLQs, with `maxReceiveCount: 5`
matching the intended deployed redrive policy — so the local stack fails the way the real one
will.

**LocalStack does not emulate Bedrock.** The local stack proves ingest → S3 → SQS; scoring
against a real model needs real AWS credentials.

### Running the pipeline locally

```bash
# after `corepack yarn dev`, with the API booted and seeded:
corepack yarn db:seed
SRC=$(docker compose exec -T postgres psql -U project_signal_app -d project_signal -t -A \
      -c "select id from source_configs where source='rss' and is_enabled=true limit 1")
curl -X POST localhost:8081/ingest -H 'Content-Type: application/json' \
     -d "{\"sourceConfigId\":\"$SRC\"}"
```

Use the **RSS** source: it is the only adapter that needs no API key. The others require
`APIFY_API_KEY` or `YOUTUBE_API_KEY`.

### Calling the API locally

With `NODE_ENV=development` the API accepts a dev token instead of a real ID token, so you can
curl it without an identity provider:

```bash
# format: dev:<role>:<tenantId>[:<brandEntityId>] — colon-delimited, since UUIDs contain hyphens
curl -H "Authorization: Bearer dev:owner:$TENANT_ID:$BRAND_ID" http://localhost:8080/brands
```

### Changing the database schema

```bash
# 1. edit libs/db/src/schema/*.ts
corepack yarn db:generate    # drizzle-kit → apps/api/migrations/
# 2. restart the API — it applies pending migrations on boot
```

Migrations are **generated, never hand-written**. The `.sql`, its `meta/` snapshot and the
`_journal.json` entry all commit together.

## Nx commands

```bash
corepack yarn lint         # 13 projects
corepack yarn typecheck    # 12 projects
corepack yarn test         # 11 projects, 309 tests, 80% coverage gate
```

> **Check the project count, not just the exit code.** If Nx computed its graph while
> `node_modules` was incomplete, it caches a graph with zero lint/test targets and `yarn lint`
> exits 0 having run nothing. Expect **13 / 12 / 11**. Fix with `nx reset`.

> **`nx run-many -t test` has hung for 35+ minutes here.** Drive vitest per project instead:
> `cd apps/api && corepack yarn vitest run --coverage`.

Project names are **not** uniform: the four backend apps have a `project.json` and use short
names (`api`, `ingestion`, `sentiment-worker`, `report-worker`); `web` and the libs use their
`package.json` name (`@project-signal/web`, `@project-signal/db`, …).
**Never enable Nx Cloud** (see [`CLAUDE.md`](CLAUDE.md)).

## Architecture at a glance

```
apps/
  web/               Next.js 16 dashboard (client-side SPA, Firebase auth until Cognito)
  api/               Fastify 5 REST API — owns the schema, applies migrations on startup
  ingestion/         Scheduled source pull + dispatcher + rollup
  sentiment-worker/  Scores signals via Bedrock (HTTP route today; SQS consumer is Phase 4)
  report-worker/     Skeleton only — reporting deferred (Epic 12)
libs/
  config/  shared-types/  db/  storage/  scoring/  llm/  messaging/  source-adapters/
infra/               GCP Terraform — SUPERSEDED, reference only
infra-aws/           AWS tree — Phase 0 discovery script only so far
```

### Data layer — one shared Postgres, API owns the schema

- **Postgres** is the single source of truth — signals, sentiment results, trend rollups and
  app/auth metadata. Target is RDS; BigQuery and Firestore were evaluated and dropped
  (see `PLAN.md`).
- **Raw verbatim payloads live in S3**, referenced from the signal rows for the audit trail. The
  upload happens _before_ the row insert, so `raw_storage_ref` can never point at a missing
  object.
- The **API owns the schema** and applies Drizzle migrations on startup under a Postgres advisory
  lock so concurrent instances don't race. There is no manual migrate step and no migrator app.
- Worker services connect to the same database **directly** via [`libs/db`](libs/db) — the
  pipeline does not route bulk writes through API calls. These services are a pipeline over
  shared data, not independent bounded contexts.

### Auth

Currently **Firebase / GCP Identity Platform** — email/password, with social sign-in configured
in Terraform but not surfaced in the UI. **This is the last Google dependency and Cognito
replaces it in Phase 5.**

RBAC uses **identity-provider custom claims** — `owner`, `admin`, `user` — so authorisation
needs no DB lookup per request. The `users` table mirrors roles for the management UI; it is
**not** what authorises a request.

Tenant isolation is enforced at the query layer (**no RLS**), so every query must filter on
`tenant_id`, and every `/brands/:id...` route must add the `requireBrandAccess` preHandler. That
guard is opt-in and nothing fails when a new route omits it — which is exactly how
`GET /brands/:id` kept an intra-tenant hole until it was found and closed.

## Current state

Epics 0–8, 10 and part of 11 are built. Four of the six analytical views (Dashboard, Trends,
Brand impact, Competitors) read the live API; **Roadmap and Report still render mock data** from
`apps/web/src/lib/data.ts`, deferred by owner decision until AWS is running — no new code may
depend on that file.

**No cloud environment exists.** AWS discovery is complete against a live account and the
libraries are ported, but there is no Terraform beyond the discovery script, scoring has never
executed against a real model, and everything behind `AuthGate` has never been seen rendered.
[`docs/HANDOVER.md`](docs/HANDOVER.md) is authoritative; [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)
#16 is the tracking entry.

Reporting (Epic 12) and alerts (Epic 13) are deliberately deferred.
