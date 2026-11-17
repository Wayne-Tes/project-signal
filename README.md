# Project Signal

AI-powered brand intelligence platform by Wayne Strydom.

Project Signal ingests public brand signals (reviews, app-store feedback, YouTube comments, RSS),
scores them for sentiment with **Claude on Amazon Bedrock**, and surfaces a Brand Perception
Index, a "Brand impact" analysis and an action roadmap — with a full audit trail, multi-tenant
and role-scoped.

> ### Status: deployed in the AWS sandbox; runs fully locally for development
>
> The system was built for GCP and never deployed there. On 2026-08-06 the owner decided to go
> straight to AWS, and it has run in `290304998906` / `eu-west-2` since 2026-08-08 — ECS
> Fargate, RDS, SQS, S3, Cognito behind one ALB ([`docs/HANDOVER.md`](docs/HANDOVER.md) §0a has
> the deploy record). No Google dependency remains in the code.
>
> Day-to-day development runs **locally**: Postgres and LocalStack in Docker, local sign-in, and
> only LLM calls going to Bedrock.

## Documentation

Read in this order.

| Document                                                                | Read it for                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`docs/HANDOVER.md`](docs/HANDOVER.md)**                              | **Start here.** Current state, proven vs assumed, verified AWS account facts, the phase plan, the regression checklist. Written for a reader with no prior context. |
| [`DEVRULES.md`](DEVRULES.md)                                            | The operating rules. Verify, never assume.                                                                                                                          |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                          | Complete code-accurate reference: every app, lib, table, route and module, plus end-to-end flows and editing gotchas.                                               |
| [`docs/AWS-SETUP.md`](docs/AWS-SETUP.md)                                | The AWS runbook and its guardrails. Phase 0 discovery is executable and read-only.                                                                                  |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)                              | The defect register. The closed entries explain _why_ things are as they are.                                                                                       |
| [`docs/PLAN.md`](docs/PLAN.md)                                          | Design rationale, key decisions, epic status.                                                                                                                       |
| [`docs/SETUP.md`](docs/SETUP.md) · [`infra/README.md`](infra/README.md) | **Superseded.** GCP setup and Terraform, kept as the clearest specification of what each service needs. Will never be applied.                                      |

## Quick start

```bash
# 0. Toolchain, once per machine. Node 26 (.nvmrc). Node 25+ does NOT bundle corepack, so
#    install it pinned — it then provides the exact Yarn in package.json "packageManager" (4.9.2).
npm install -g corepack@0.36.0 && corepack enable

# 1. Install dependencies (Yarn 4 — not npm, not pnpm)
corepack yarn install

# 2. Copy env and start local services (Postgres 16 + LocalStack for S3/SQS).
#    In .env set AUTH_MODE=local and a LOCAL_AUTH_PASSWORD; in apps/web/.env.local set
#    NEXT_PUBLIC_AUTH_MODE=local — see "Signing in locally" below.
cp .env.example .env
docker compose up -d

# 3. Start each app in watch mode — API FIRST, with PORT=9080 (see "Local ports" below;
#    `corepack yarn dev` binds api 8080, which is occupied on this machine)
PORT=9080 corepack yarn nx run api:dev         # applies migrations on startup — boot before seeding
corepack yarn nx run ingestion:dev             # 8081
corepack yarn nx run sentiment-worker:dev      # 8082
corepack yarn nx run report-worker:dev         # 8083
corepack yarn nx run @project-signal/web:dev   # 3100 (the dev script's port)
```

**Local ports (landed 2026-11-16).** On the owner's machine `3000`, `8080` and `8090` are held by
unrelated applications, so local dev runs **web on 3100** and **API on 9080**; the workers keep
8081–8083. The API's port is passed as a _per-process_ `PORT` env var, never set in the root
`.env` — that file is shared by all four backends, and the workers read `process.env.PORT` too,
so a single `PORT` there makes them all fight for one socket (see the comment in `.env.example`).
Every local process binds **`127.0.0.1` only** (`listenHost()` in `libs/config`; containers bind
`0.0.0.0` because they run with `NODE_ENV=production`), so the local sign-in endpoint is not reachable
from the office or home network. Set `HOST` to override. The e2e container still reaches the host
through `host.docker.internal`, which Docker Desktop proxies to loopback.
`corepack yarn dev` (one shared environment, api 8080) still works on a machine where 8080 is
free. The web app reads `apps/web/.env.local`, not the root `.env`; copy `apps/web/.env.example`.
In local auth mode the `NEXT_PUBLIC_COGNITO_*` values can stay empty; for Cognito sign-in, fill
them from `terraform -chdir=infra-aws/stack output` — they have no fallback by design.

**Migrations are applied by the API on startup** — there is no migrate step. Boot the API before
seeding, or `yarn db:seed` fails with `relation "tenants" does not exist`.

| Service               | Local URL                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| web                   | http://localhost:3100                                                            |
| api                   | http://localhost:9080 (Swagger UI at `/docs`)                                    |
| ingestion             | http://localhost:8081                                                            |
| sentiment-worker      | http://localhost:8082                                                            |
| report-worker         | http://localhost:8083                                                            |
| Postgres              | localhost:5432 (user `project_signal_app`, db `project_signal`, pass `password`) |
| LocalStack (S3 + SQS) | http://localhost:4566                                                            |

`scripts/localstack-init.sh` runs inside the container on first boot and creates the
`psignal-local-raw` bucket, the item/report/scan queues and their DLQs, with `maxReceiveCount: 5`
and the deployed visibility timeouts — so the local stack fails the way the real one will.

**LocalStack does not emulate Bedrock.** Scoring, the assistant and roadmap rewording need the
real service: put a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK` in `.env`, with
`BEDROCK_REGION=eu-west-2`. Only the LLM client uses it; S3 and SQS stay on LocalStack. How the
key is created and what it may do: `docs/HANDOVER.md` §4.5.

### Running the pipeline locally

```bash
# after starting the apps (API first — see "Local ports"), with the API booted and seeded:
corepack yarn db:seed
SRC=$(docker compose exec -T postgres psql -U project_signal_app -d project_signal -t -A \
      -c "select id from source_configs where source='rss' and is_enabled=true limit 1")
curl -X POST localhost:8081/ingest -H 'Content-Type: application/json' \
     -d "{\"sourceConfigId\":\"$SRC\"}"
```

Use the **RSS** source (or App Store): they need no API key. The others require
`APIFY_API_KEY` or `YOUTUBE_API_KEY`. `POST /ingest` exists for local use only; deployed,
collection runs from the scan queue.

### Calling the API locally

**Only with `AUTH_MODE=local`** (never implied by `NODE_ENV`) the API accepts an unsigned dev
token instead of a Cognito ID token, so you can curl it without an identity provider:

```bash
# format: dev:<role>:<tenantId>[:<brandEntityId>] — colon-delimited, since UUIDs contain hyphens
curl -H "Authorization: Bearer dev:owner:$TENANT_ID:$BRAND_ID" http://localhost:9080/brands

# or sign in as a seeded user and use the token it returns
curl -s -X POST http://localhost:9080/auth/local/sign-in -H 'Content-Type: application/json' \
     -d "{\"username\":\"local-owner\",\"password\":\"$LOCAL_AUTH_PASSWORD\"}"
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
corepack yarn lint         # 15 projects
corepack yarn typecheck    # 14 projects
corepack yarn test         # 14 projects, 80% coverage gate
corepack yarn nx run api:test:integration   # API against a real Postgres (project_signal_test)
```

The integration suite drops and recreates `project_signal_test` on the Docker Postgres (it refuses
any database whose name does not end in `_test`; override with `INTEGRATION_DATABASE_URL`) and
never touches the `project_signal` dev database.

> **Check the project count, not just the exit code.** If Nx computed its graph while
> `node_modules` was incomplete, it caches a graph with zero lint/test targets and `yarn lint`
> exits 0 having run nothing. Expect **15 / 14 / 14** (counted 2026-11-16). Fix with `nx reset`.

> **`nx run-many -t test` has hung for 35+ minutes here.** Drive vitest per project instead:
> `cd apps/api && corepack yarn vitest run --coverage`.

Project names are **not** uniform: the four backend apps have a `project.json` and use short
names (`api`, `ingestion`, `sentiment-worker`, `report-worker`); `web` and the libs use their
`package.json` name (`@project-signal/web`, `@project-signal/db`, …).
**Never enable Nx Cloud** (see [`CLAUDE.md`](CLAUDE.md)).

## Architecture at a glance

```
apps/
  web/               Next.js 16 dashboard (client-side SPA; Cognito sign-in, local sign-in in dev)
  api/               Fastify 5 REST API — owns the schema, applies migrations on startup
  ingestion/         SQS scan consumer: scheduled collection, rollup, reconcile
  sentiment-worker/  SQS consumer: scores signals via Bedrock (forced tool use)
  report-worker/     Skeleton only — reporting deferred (Epic 12), not deployed
libs/
  config/  shared-types/  db/  storage/  scoring/  llm/  messaging/  source-adapters/
  playbook/  help-content/
infra/               GCP Terraform — SUPERSEDED, reference only
infra-aws/           AWS Terraform — deployed: VPC, RDS, S3, SQS, ECR, ECS, ALB, Cognito, alarms
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

**Amazon Cognito** in every deployed environment — admin-created users only, email + password
over SRP. RBAC uses the **ID token's custom attributes** (`custom:role` — `owner`, `admin`,
`user` — plus `custom:tenantId` and `custom:brandEntityId`), so authorisation needs no DB lookup
per request.

### Signing in locally

Local development does not need Cognito. With `AUTH_MODE=local` (root `.env`) and
`NEXT_PUBLIC_AUTH_MODE=local` (`apps/web/.env.local`), the web app shows a local sign-in screen
backed by the API's `POST /auth/local/sign-in`. `yarn db:seed` creates three users —
`local-owner`, `local-admin`, `local-user` (pinned to the demo brand) — all with the password in
`LOCAL_AUTH_PASSWORD`. The API **refuses to start** with `AUTH_MODE=local` when
`NODE_ENV=production`, and the deployed stack never sets it.

LLM calls are the one thing that still needs AWS locally (LocalStack has no Bedrock): a Bedrock
API key in `AWS_BEARER_TOKEN_BEDROCK` (`docs/HANDOVER.md` §4.5).

The `users` table mirrors roles for the management UI; in Cognito mode it is **not** what
authorises a request (in local mode the row is the claim).

Tenant isolation is enforced at the query layer (**no RLS**), so every query must filter on
`tenant_id`, and every `/brands/:id...` route must add the `requireBrandAccess` preHandler. That
guard is opt-in and nothing fails when a new route omits it — which is exactly how
`GET /brands/:id` kept an intra-tenant hole until it was found and closed.

## Current state

Every analytical view — Dashboard, Trends, Brand impact, What's changed, Voice of the customer,
Action roadmap, Competitors and the Weekly report — reads the live API; the mock-data file
`apps/web/src/lib/data.ts` was deleted on 2026-08-09. The stack is deployed in the AWS sandbox
(see the status note at the top). [`docs/HANDOVER.md`](docs/HANDOVER.md) is authoritative on
state; [`docs/OWNER-ACTIONS.md`](docs/OWNER-ACTIONS.md) lists what waits on the owner.

Not yet built: the report PDF render and email delivery (Epic 12), alerting (Epic 13), CI/CD
deploys via GitHub OIDC (Phase 6), and HTTPS on the load balancer (needs a domain).
