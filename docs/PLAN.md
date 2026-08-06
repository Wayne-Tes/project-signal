# Project Signal — MVP

## Context

Project Signal is an agency-managed, multi-tenant brand-intelligence SaaS:
ingest public brand signals → score perception → surface an "Achilles Heel" + action
roadmap with a full audit trail. The repo is greenfield.

The goal is a **working MVP**: a real user can sign in, see live brand signals for their
brand scored by sentiment, and navigate the full dashboard backed by real data. Budget
**< $50/mo**. This effort covers the **full vertical slice** — infra, pipelines, auth,
one end-to-end ingestion source, basic sentiment scoring, and the dashboard wired to the
live API. Advanced scoring, additional sources, report generation, and alerts are deferred.

**Environment scope — `staging` only.** Everything targets the **staging** environment:
Terraform resources are prefixed `staging-` (via `var.environment`), remote state uses the
`env/staging` prefix, deploys run through `deploy-staging.yml`. `infra/envs/production.tfvars`
is scaffolded but deliberately not provisioned yet.

---

## Status — as of 2026-08-05

> This document is the **plan and decision record**. For what the code actually does today,
> read [`ARCHITECTURE.md`](ARCHITECTURE.md); for the places where the two disagree, read
> [`KNOWN-GAPS.md`](KNOWN-GAPS.md). The epic descriptions below are preserved as written —
> this table is the reality check over them.

| Epic                                | State                       | Notes                                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Repo & tooling                  | ✅ Done                     | Nx 20, Yarn 4, strict TS, ESLint 9, husky + commitlint                                                                                                                                                                                                               |
| 1 — Infrastructure (Terraform)      | 🟡 Code done, unprovisioned | All 8 modules written and previously applied in the contractor's test project. That environment was abandoned at handover; `staging.tfvars` / `production.tfvars` now hold `REPLACE_ME` and `bootstrap/` must be re-run against a new GCP project                    |
| 2 — CI/CD                           | ✅ Done                     | 4 workflows, WIF keyless auth, 80% coverage gate. **Deploy triggers on the `staging` branch, not `main`** — the plan text below predates that change                                                                                                                 |
| 3 — Database & migrations           | ✅ Done                     | 8 tables, 5 migrations, advisory-locked startup migration                                                                                                                                                                                                            |
| 4 — Shared libs & skeletons         | ✅ Done                     | All 6 libs; all 4 backend services build and serve health checks                                                                                                                                                                                                     |
| 5 — Auth & RBAC                     | 🟡 Mostly                   | Token verification, `requireRole`, admin routes and Swagger all exist. **Brand-level scoping is not enforced on `/brands/:id/*` reads** (`KNOWN-GAPS.md` #5), and `POST /admin/users` is owner-only rather than admin+ (#12)                                         |
| 6 — Web deploy + live data          | 🟡 Partial                  | App is deployed, auth-gated, and the Admin area (tenant creation, source configs, aliases) is wired to the live API. The six analytical views still render `lib/data.ts` mock data; the users-management UI is not built (#13, #12)                                  |
| 7 — Ingestion: Google Reviews       | 🟡 Mostly                   | Adapter, dispatcher, dedup and Pub/Sub publish all implemented — and **four more sources shipped early** (see Epic 10). Not wired: Cloud Tasks dispatch (#3), raw payload → Cloud Storage (#4), topic naming (#7)                                                    |
| 8 — Sentiment scoring               | 🟡 Mostly                   | Worker, Gemini Flash prompt and idempotent upsert are implemented. Not working end-to-end: the push subscription targets a path the worker doesn't serve (#1), scoring reads a URL instead of review text (#4), and errors are swallowed so the DLQ never fires (#9) |
| 9 — Observability & cost guardrails | ❌ Not started              | Log/metric writer IAM is granted, but no uptime checks, dashboards or budget alert exist                                                                                                                                                                             |
| 10 — Additional sources             | ✅ Done early               | App Store, Play Store, RSS/Atom and YouTube adapters are all implemented alongside Google Reviews — this epic is no longer deferred                                                                                                                                  |
| 11 — Full scoring engine            | ❌ Deferred                 | `dimension_scores` table and read endpoint exist; nothing writes them (#10)                                                                                                                                                                                          |
| 12 — Reporting                      | ❌ Deferred                 | `report-worker` is a health-check skeleton                                                                                                                                                                                                                           |
| 13 — Alerts & anomaly detection     | ❌ Deferred                 | —                                                                                                                                                                                                                                                                    |
| 14 — Enterprise SSO                 | ❌ Deferred                 | Customer-driven                                                                                                                                                                                                                                                      |

**Net position.** The vertical slice is built but **not yet connected end to end.** A user can
sign in, an admin can provision a tenant and configure sources, and ingestion can pull and
deduplicate real signals. What does not yet work in a deployed environment is the hop from
ingestion to scoring, and the raw-text storage that makes scoring meaningful. Those are four
small, located fixes — see the suggested order of attack at the end of `KNOWN-GAPS.md`.

One further blocker sits outside the code: the working tree is **not a git repository**, so
none of the CI/CD above can trigger (`KNOWN-GAPS.md` #15).

---

## Key decisions

- **Database: Cloud SQL (Postgres)**, not Firestore. Driven by the automated-migration
  requirement (Firestore has no migrations) and aggregation-heavy scoring. BigQuery dropped
  for simplicity: text-only data stays well clear of the multi-TB range where a columnar
  warehouse pays off, and trend rollups live in Postgres. Staging instance `db-f1-micro`
  ≈ $10/mo.
- **Data-layer ownership — one shared Postgres, API owns the schema.** Worker services
  (ingestion, sentiment, report) connect directly via `libs/db` (shared schema + client).
  Pipeline writes do not route through API calls (HTTP-per-signal is wasteful for bulk
  writes). These services are a pipeline over shared data, not independent bounded contexts;
  database-per-service is a future option only.
- **Migrations: Drizzle, applied on API startup.** The API is the single schema owner and
  runs migrations once on boot (Postgres advisory lock guards concurrent instances).
  `drizzle-kit generate` authors SQL at dev time. No manual migrate step, no separate job.
- **Auth: GCP Identity Platform.** Email/password plus social sign-in — primarily **Sign in
  with Microsoft** (one multi-tenant Entra app registration covers any Microsoft-house
  customer, no per-customer setup) and Google. Auth0/WorkOS were rejected: costlier and
  still require the same Entra registration. True federated SAML/SCIM SSO is a future,
  customer-driven option via Identity Platform multi-tenancy.
- **RBAC via Firebase custom claims.** Three roles: `owner` (manages admins), `admin`
  (manages users + all brands), `user` (their assigned brand only). Roles stored as custom
  claims on the Identity Platform token — no extra DB lookup on every request. A `users`
  table mirrors roles for the admin management UI and triggers `setCustomUserClaims` on
  changes. Token claims refresh within ~1 hour of a role change.
- **Monorepo: Nx** (yarn, TypeScript), **Docker** per app, **Next.js 16** web.
- **IaC: Terraform**, single **staging** environment, remote state in GCS.
- **CI/CD: GitHub Actions**, keyless auth via **Workload Identity Federation** (no JSON
  keys in repo). PR checks (lint / typecheck / test ≥80% coverage / Docker build) plus
  auto build, deploy, and Terraform apply on merge to `main`.
- **Lean architecture:** Cloud Run (scales to zero, min instances 0) + Pub/Sub (+ DLQs) +
  Cloud Scheduler/Tasks + Cloud Storage + Secret Manager + Identity Platform. Vertex AI
  Gemini Flash for per-item sentiment scoring.
- **No Serverless VPC connector.** Cloud SQL uses a public IP; Cloud Run connects via the
  Cloud SQL Auth Proxy socket (`?host=/cloudsql/<project>:<region>:<instance>`). Equally
  secure (mTLS + IAM) and avoids the ~$12–15/mo always-on connector cost.
- **MVP source: Google Reviews via Apify free tier.** One working end-to-end source is
  enough to prove the pipeline. Trustpilot, NewsAPI, and X remain deferred (ToS risk / cost).
  > **Superseded:** four further adapters (App Store, Play Store, RSS/Atom, YouTube) were
  > implemented alongside Google Reviews behind the same `SourceAdapter` interface. Epic 10
  > is done, not deferred.

## Pipeline architecture (event-driven)

1. **Cloud Scheduler** (weekly cron) triggers the **ingestion** dispatcher.
2. The dispatcher enumerates **(brand × source)** pairs and enqueues one **Cloud Tasks** job
   per pair. Cloud Tasks provides rate limiting to protect third-party source API quotas.
3. Ingestion workers pull each source, write raw payloads to the Cloud Storage **`raw`**
   bucket, insert `signal` rows (status `pending`) into Postgres, and publish one message
   per signal to the Pub/Sub **`item`** topic.
4. **sentiment-worker** consumes `item` (push subscription with OIDC), scores each signal
   with **Gemini Flash**, and upserts the result. Idempotent on `signalId`; failures →
   `item` DLQ.
5. A periodic **pending-sweep** Scheduler job re-publishes any `pending` signals missed by
   a failed dual-write (safety net).

**Tool choice:** Cloud Tasks = rate-limited, point-to-point dispatch (ingestion); Pub/Sub =
fan-out eventing with DLQs (scoring).

## Cost estimate (MVP, weekly ingestion, ~5 brands)

| Item                                                                                             | Monthly          |
| ------------------------------------------------------------------------------------------------ | ---------------- |
| Cloud SQL `db-f1-micro` (always-on)                                                              | ~$10             |
| Gemini Flash (per-item sentiment)                                                                | ~$2              |
| Cloud Storage + Artifact Registry                                                                | ~$1              |
| Cloud Run ×5 (scale to zero), Pub/Sub, Cloud Tasks, Scheduler, Secret Manager, Identity Platform | ~$0 (free tiers) |
| Apify Google Reviews (free tier)                                                                 | $0               |
| **Total**                                                                                        | **~$13–15/mo**   |

Headroom to bump Apify to Starter (~$49) if reliability needs it. Weekly cadence keeps
Gemini costs trivial; the only fixed cost is Cloud SQL.

## Monorepo structure

```
project-signal/
  apps/
    web/                 # Next.js 16 dashboard — auth-gated; Admin area on live API,
                         #   analytical views still on mock data
    api/                 # Node.js REST API (Fastify, Cloud Run)
    ingestion/           # scheduler-triggered pull + 5 source adapters (Cloud Run)
    sentiment-worker/    # Pub/Sub consumer → Gemini Flash (Cloud Run)
    report-worker/       # skeleton only — reporting deferred
  libs/
    shared-types/        # contracts: Signal, SentimentResult, etc.
    db/                  # Drizzle schema + client (migrations applied by API on startup)
    config/              # zod-validated env/config
    gemini/              # Vertex AI client wrapper
    messaging/           # Pub/Sub client + topic constants
    source-adapters/     # adapter interface + google_reviews, app_store, play_store,
                         #   rss, youtube implementations
  infra/
    bootstrap/           # one-shot: project APIs, state bucket, WIF + CI service account
    modules/             # 8 modules: artifact_registry, cloud_run, cloud_sql, cloud_tasks,
                         #   identity_platform, pubsub, scheduler, service_accounts, storage
    stack/               # shared .tf for every env; backend config passed at init
    envs/                # staging.tfvars / production.tfvars (no secrets committed)
  .github/workflows/     # ci.yml, deploy-staging.yml, deploy-production.yml,
                         #   terraform-plan.yml
                         #   (the separate terraform-apply-* workflows were folded into the
                         #    deploy workflows — Terraform now owns the image via image_tag,
                         #    so one apply deploys image + infra atomically)
  docker-compose.yml     # local: postgres + pubsub emulator
```

---

## Epics

### Epic 0 — Repo & tooling foundation

Nx workspace (yarn, TS strict), ESLint/Prettier, husky + lint-staged, conventional commits,
base `tsconfig`, root `README`, `.env.example`, `.gitignore`. App/lib structure established.
**Done when:** `nx run-many -t lint test build` passes locally on empty skeletons.

### Epic 1 — Infrastructure as Code (Terraform / GCP / staging)

- `infra/bootstrap/`: enable APIs, GCS Terraform-state bucket, Workload Identity Federation
  pool + provider + CI service account (keyless GitHub Actions auth).
- `infra/stack/` + `infra/envs/`: Cloud SQL Postgres (`db-f1-micro`, public IP via Cloud SQL
  Auth Proxy), Artifact Registry, Cloud Run services (one per app), Pub/Sub topics +
  subscriptions + DLQs (`item`, `report`), Cloud Scheduler jobs, Cloud Tasks queue, Cloud
  Storage buckets (`raw`, `reports`), Secret Manager, least-privilege IAM service accounts,
  Identity Platform.
- **Done when:** `terraform plan` is clean and parameterised by project/region tfvars.

### Epic 2 — CI/CD pipelines (fully automated, zero manual steps)

- `ci.yml` (PRs): lint / typecheck / test ≥80% coverage / Docker build dry-run.
- `deploy-staging.yml` (merge to `main`): WIF auth → build & push changed Docker images →
  smoke tests.
- `terraform-apply-staging.yml` (merge to `main`, infra changed): `terraform apply`
  auto-approve for staging.
- `terraform-apply-production.yml`: manual `workflow_dispatch` only, plan shown before apply,
  `environment: production` approval gate.
- **Done when:** a merge to `main` deploys all changed services and applies infra with no
  human action.

> **As built, this differs from the plan above in two ways.** (1) The deploy trigger is a push
> to the **`staging` branch**, not a merge to `main`. (2) The separate `terraform-apply-*`
> workflows were **folded into the deploy workflows**: Terraform owns the container image via
> a required `image_tag` variable, so build-and-push is followed by a single
> `terraform apply` that deploys image and infra atomically. `deploy-production.yml` mirrors
> staging but is `workflow_dispatch`-only until production is provisioned. There are no smoke
> tests. See [`ARCHITECTURE.md` §13](ARCHITECTURE.md#13-cicd).

### Epic 3 — Database & migrations

Schema covering all MVP tables — no placeholder columns for deferred features:

- `tenants` — multi-tenant root
- `users` — `(firebase_uid, tenant_id, role, brand_entity_id?)` for RBAC management UI
- `brand_entities` — owned brands + tracked competitors, scoped to tenant
- `signals` — source, source_url, raw_storage_ref, published_at, ingested_at, brand_entity_id
- `sentiment_results` — label, score, confidence, model_version, linked to signal
- `dimension_scores` — daily rollups per brand per dimension (populated by scoring engine,
  deferred; columns present so the dashboard can query them)

Two further tables were added during Epic 7 as ingestion needs emerged:

- `source_configs` — one row per `(brand_entity, source)`; `is_enabled` plus a JSONB `config`
  holding source-specific settings (placeId, feedUrl, appId, channelId). Credentials are
  **not** stored here — they come from Secret Manager at runtime.
- `brand_aliases` — alternative names/abbreviations per brand, so ingestion and scoring can
  match mentions that don't use the canonical name.

Multi-tenancy via `tenant_id` on every table, enforced at the application/query layer
(every query is tenant-scoped). Postgres RLS was considered and **dropped** for the MVP —
app-layer scoping is sufficient at this stage; RLS can be added later if needed.
Migrations applied by the API on startup (advisory lock guards concurrent boots).
`drizzle-kit generate` authors SQL; workers consume schema via `libs/db` and never migrate.

**Done when:** a fresh staging deploy applies all migrations automatically; no manual step.

### Epic 4 — Shared libs & deployable service skeletons

- `shared-types`: `Signal`, `SentimentResult`, source enum, role enum.
- `config`: zod-validated env loader used by every app.
- `gemini`: Vertex AI client wrapper (Flash + Pro).
- `messaging`: idempotent Pub/Sub publish/consume keyed on `signalId`.
- `source-adapters`: adapter interface (`fetch(brand): Signal[]`).
- All four backend apps deployed to Cloud Run staging as skeletons with health/readiness
  endpoints, wired to DB + Pub/Sub, passing smoke tests.
- **Done when:** all services deploy and return 200 on health checks.

### Epic 5 — Auth & RBAC

- Fastify plugin: verify Identity Platform (Firebase) ID tokens on every request; attach
  `request.user` (`uid`, `role`, `tenantId`, `brandEntityId`).
- `requireRole(...roles)` preHandler factory for route-level RBAC enforcement.
- `POST /admin/users` — create user, set custom claims via Firebase Admin SDK, write to
  `users` table. Owner only.
- `PATCH /admin/users/:id` — update role/brand assignment, sync custom claims. Admin+.
- `GET /admin/users` — list users in tenant. Admin+.
- `@fastify/swagger` + `@fastify/swagger-ui` wired up; all routes documented via JSON Schema.
- **Done when:** a signed-in user with role `user` can only access their assigned brand's
  data; an `admin` can manage users; an `owner` can manage admins.

### Epic 6 — Web app: deploy + live data wiring

- Dockerise `apps/web` and deploy to Cloud Run staging.
- Replace `apps/web/src/lib/data.ts` mock data with live API calls, scoped to the
  authenticated user's tenant + brand.
- Gate the entire app behind Identity Platform sign-in (Sign in with Microsoft / Google).
- All six dashboard views (Dashboard, Achilles, Roadmap, Report, Trends, Competitors) fetch
  from the API; empty-state UI where data is not yet populated (e.g. reports).
- **Admin/Owner area** (role-gated via token claims; hidden from `user` role) backing the
  Epic 5 `/admin/users` endpoints:
  - **Users list** — everyone in the tenant with their role + assigned brand.
  - **Provision new user** — form (email, role, brand assignment) → `POST /admin/users`;
    creates the Identity Platform user, sets custom claims, writes the `users` row.
  - **Edit user** — change role / brand assignment → `PATCH /admin/users/:id`.
  - Visibility follows RBAC: an `owner` can provision/manage **admins and users**; an
    `admin` can provision/manage **users** (their tenant only); a `user` never sees the area.
- **Done when:** a signed-in user sees their brand's real data in the dashboard; an `admin`
  can provision a new user from the UI and that user can sign in scoped to their brand; an
  `owner` can provision an admin; mock data file is deleted.

### Epic 7 — Ingestion: Google Reviews

- Implement the `source-adapters` Google Reviews adapter using Apify free tier.
- Ingestion dispatcher: enumerate active `(brand × source)` pairs, enqueue Cloud Tasks jobs.
- Pull raw reviews → write to Cloud Storage `raw` bucket → insert `signal` rows → publish to
  `item` Pub/Sub topic.
- Deduplication on `(brand_entity_id, source_url)`.
- **Done when:** a scheduled weekly run populates real signal rows for at least one brand.

### Epic 8 — Sentiment scoring (Gemini Flash)

- `sentiment-worker` consumes `item` Pub/Sub topic (push subscription + OIDC).
- Calls Gemini Flash with signal text; upserts `sentiment_results` row (label, score,
  confidence, model_version). Idempotent on `signalId`.
- Failures route to `item` DLQ; pending-sweep Scheduler job catches missed signals.
- **Done when:** all ingested signals have a sentiment result; dashboard sentiment views show
  real scores.

### Epic 9 — Observability & cost guardrails

Cloud Logging/Monitoring, Error Reporting, uptime checks on each service, pipeline-health
dashboard, and a **billing budget alert** (< $50/mo).
**Done when:** alerts fire to a test channel and budget alert is active.

---

## Deferred (post-MVP)

### Epic 10 — Additional ingestion sources ✅ **built early — no longer deferred**

YouTube Data API, app-store RSS, RSS/news feeds added behind the same `source-adapters`
interface. Deferred sources: NewsAPI (commercial tier ~$449/mo — use free RSS instead),
X (no affordable tier), Trustpilot (ToS risk).

**Shipped:** `AppStoreAdapter` and `PlayStoreAdapter` (both via Apify), `RssAdapter`
(handles RSS _and_ Atom, no API key required) and `YoutubeAdapter` (YouTube Data API v3,
channel videos → top-level comments) all exist alongside `GoogleReviewsAdapter`, are
registered in the ingestion `ADAPTERS` map, and are configurable from the Admin UI. NewsAPI,
X and Trustpilot remain deferred as planned.

### Epic 11 — Full scoring engine — **partially delivered**

5-dimension Brand Perception Index with 90-day recency decay, topic clustering → Achilles
Heel identification, daily dimension rollups written to `dimension_scores`.

**Delivered:** `libs/scoring` implements decay, per-dimension scoring, the weighted composite
and topic-cluster damage scoring. `POST /rollup` on ingestion writes daily rollups to
`dimension_scores`, driven by a daily Cloud Scheduler job, and
`GET /brands/:id/dimension-scores` now returns real data. Per-brand weights live in
`brand_entities.dimension_weights`.

Read endpoints follow in `apps/api/src/routes/scores.ts`: `GET /brands/:id/score` (composite +
breakdown + week-earlier comparison), `GET /brands/:id/achilles` (damage-ranked clusters), and
a date-ranged `GET /brands/:id/dimension-scores`.

**Outstanding:** topic clusters are computed on read rather than persisted, so there is no
cluster history and no drill-down from a cluster to its underlying signals — the DrillDown view
will need one. The action roadmap (`PS_ROADMAP`) has no producer at all; nothing in Epics 11–13
generates prioritised recommendations, so that view stays on mock data until it is specified.

### Epic 12 — Reporting

`report-worker`: weekly Gemini Pro narrative report + PDF to the `reports` Cloud Storage
bucket, email/webhook delivery, surfaced in the dashboard Report view.

### Epic 13 — Alerts & anomaly detection

Spike/anomaly detection on dimension scores; alerts via email/webhook using Cloud Tasks,
surfaced in the dashboard Alerts view.

### Epic 14 — Enterprise SSO

Per-customer federated SAML/OIDC SSO + SCIM provisioning via Identity Platform
multi-tenancy — built only when a customer requires it beyond Sign in with Microsoft.

---

## Prerequisites (one-time, then fully automated)

A GCP project with linked billing, and a first run of `infra/bootstrap/` (state bucket +
WIF). True zero-manual is impossible for the very first project/billing setup — this is a
single scripted bootstrap, after which every `main` merge is fully automated.

## Verification (end-to-end MVP)

1. Open a PR → `ci.yml` runs lint / typecheck / test / Docker build green.
2. Merge to `main` → `deploy-staging.yml` builds + pushes changed images; `terraform-apply-staging.yml` applies infra; migrations run on API startup.
3. A new user is created via `POST /admin/users` with role `user` scoped to a brand.
4. User signs in via Identity Platform (Microsoft or Google); JWT carries `{ role: 'user', brandEntityId }`.
5. Dashboard loads with real signal data for that brand; a second user for a different brand cannot see the first brand's data.
6. Weekly ingestion run populates new signals; sentiment-worker scores them; dashboard updates.
7. Budget alert is active; no manual step was performed anywhere after the initial bootstrap.
