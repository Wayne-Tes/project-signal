# Project Signal

AI-powered brand intelligence platform by Wayne Strydom.

Project Signal ingests public brand signals (reviews, app-store feedback, YouTube comments, RSS),
scores them for sentiment with Gemini Flash, and surfaces a Brand Perception Index, an
"Achilles Heel" analysis and an action roadmap — with a full audit trail, multi-tenant and
role-scoped.

## Documentation

| Document | Read it for |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** | **Start here.** Complete code-accurate reference: every app, lib, table, route and module, plus end-to-end flows and editing gotchas. |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md) | What's provisioned but not wired. **Read before debugging any end-to-end flow.** |
| [`docs/PLAN.md`](docs/PLAN.md) | Design rationale, key decisions, epic status and roadmap. |
| [`infra/README.md`](infra/README.md) | Terraform layout, bootstrap and deployment. |
| [`infra/modules/identity_platform/README.md`](infra/modules/identity_platform/README.md) | Entra app registration for Sign in with Microsoft. |
| [`docs/project_signal_architecture_diagram.svg`](docs/project_signal_architecture_diagram.svg) | System diagram. |

## Quick start

```bash
# 1. Install dependencies (Yarn 4 — do not use npm or pnpm)
yarn install

# 2. Copy env and start local services (Postgres 16 + Pub/Sub emulator)
cp .env.example .env
docker compose up -d

# 3. Start all apps in watch mode
#    DB migrations are applied automatically by the API on startup — no manual step.
yarn dev
```

| Service          | Local URL                                                   |
| ---------------- | ----------------------------------------------------------- |
| web              | http://localhost:3000                                       |
| api              | http://localhost:8080 (Swagger UI at `/docs`)               |
| ingestion        | http://localhost:8081                                       |
| sentiment-worker | http://localhost:8082                                       |
| report-worker    | http://localhost:8083                                       |
| Postgres         | localhost:5432 (user: project_signal_app, db: project_signal, pass: password) |
| Pub/Sub emulator | localhost:8085                                              |

### Calling the API locally

With `NODE_ENV=development` the API accepts a dev token instead of a real Identity Platform
one, so you can curl it without Firebase:

```bash
# format: dev:<role>:<tenantId>[:<brandEntityId>]  — colon-delimited, since UUIDs contain hyphens
curl -H "Authorization: Bearer dev:owner:$TENANT_ID:$BRAND_ID" http://localhost:8080/brands
```

### Changing the database schema

```bash
# 1. edit libs/db/src/schema/*.ts
yarn db:generate     # drizzle-kit generate → apps/api/migrations/
# 2. restart the API — it applies pending migrations on boot
```

## Nx commands

```bash
nx run-many -t lint          # lint all projects
nx run-many -t typecheck     # typecheck all projects
nx run-many -t test          # test all projects (80% coverage gate)
nx run-many -t build         # build all projects
nx affected -t test          # test only affected projects (for PRs)
```

Project names are **not** uniform: the four backend apps have a `project.json` and so use short
names (`api`, `ingestion`, `sentiment-worker`, `report-worker`), while `web` and the libs use
their `package.json` name (`@project-signal/web`, `@project-signal/db`, …).
**Never enable Nx Cloud** (see [`CLAUDE.md`](CLAUDE.md)).

## Architecture at a glance

```
apps/
  web/               Next.js 16 dashboard (client-side SPA, Identity Platform auth)
  api/               Fastify 5 REST API — owns the schema, applies migrations on startup
  ingestion/         Scheduled source pull + dispatcher
  sentiment-worker/  Pub/Sub consumer → Gemini Flash scoring
  report-worker/     Skeleton only — reporting deferred (Epic 12)
libs/
  shared-types/  config/  db/  gemini/  messaging/  source-adapters/
infra/
  bootstrap/  modules/  stack/  envs/          Terraform, GCP, europe-west2
```

### Data layer — one shared Postgres, API owns the schema

- **Cloud SQL (Postgres)** is the single source of truth — signals, sentiment results, trend
  rollups and app/auth metadata. BigQuery and Firestore were evaluated and dropped (see
  `PLAN.md`).
- Raw verbatim payloads are **designed** to live in Cloud Storage, referenced from the signal
  rows for the audit trail — this is not yet implemented, see `KNOWN-GAPS.md` #4.
- The **API owns the schema** and applies **Drizzle migrations on startup**, guarded by a
  Postgres advisory lock so concurrent instances don't race. `yarn db:generate` authors
  migration SQL at dev time; there is no manual migrate step and no separate migrator app.
- The worker services connect to the same database **directly** via the shared
  [`libs/db`](libs/db) — the pipeline does not route bulk writes through API calls. These
  services are a pipeline over shared data, not independent bounded contexts, so a shared
  database is the deliberate choice; database-per-service is a future option, not a current
  need.

### Auth

**GCP Identity Platform**: email/password plus social sign-in — primarily **Sign in with
Microsoft** (one multi-tenant Entra app registration covers any Microsoft-house customer) and
Google. Auth is decoupled from hosting; see
[`infra/modules/identity_platform/README.md`](infra/modules/identity_platform/README.md) for
the Entra steps. Federated SAML/SCIM SSO is a future, customer-driven option.

RBAC uses **Firebase custom claims** — `owner`, `admin`, `user` — so authorisation needs no
DB lookup per request. The `users` table mirrors roles for the management UI. Tenant isolation
is enforced at the query layer (no RLS), so **every new query must filter on `tenant_id`**.

> The web dashboard is built, auth-gated, and its Admin area is wired to the live API. The six
> analytical views still render mock data from `apps/web/src/lib/data.ts`; replacing it is
> tracked as Epic 6 in `PLAN.md`.

## Current state

Roughly Epics 0–8 of [`docs/PLAN.md`](docs/PLAN.md) are built as code: monorepo and tooling,
Terraform modules, CI/CD, schema and migrations, shared libs, auth and RBAC, five source
adapters, the ingestion pipeline, and Gemini scoring.

**No cloud environment is provisioned.** This codebase was originally developed by a
contractor team against their own test project; at handover that environment was abandoned
and every reference to it stripped out. `infra/envs/*.tfvars` hold `REPLACE_ME` for
`project_id` / `project_number`, and `infra/bootstrap/` has not been run against a new
project. Building staging from scratch is the first task — see
[`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md) #16 for the ordered checklist.

Local development is fully self-contained and needs no GCP account: Postgres and the Pub/Sub
emulator run in Docker.

The scoring engine (Epic 11), reporting (Epic 12) and alerts (Epic 13) are deliberately
deferred. **Several pipeline links are also provisioned but not connected — read
[`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md) before assuming an end-to-end flow works.**

## Infrastructure

See [`infra/README.md`](infra/README.md) for Terraform setup and deployment.
