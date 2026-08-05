# Project Signal — Known Gaps

> **Read this before debugging any end-to-end flow.** Several links in the pipeline are
> provisioned in Terraform and implemented in code, but the two halves do not meet. Nothing
> below is a mystery bug — each item is a known, located discrepancy between what
> [`PLAN.md`](PLAN.md) intends, what [`ARCHITECTURE.md`](ARCHITECTURE.md) describes, and what
> the code currently does.
>
> Findings come from a full read of the repo on **2026-08-05**. Nothing here has been fixed;
> this document records the state, it does not change it.
>
> **Severity key:** 🔴 breaks a flow · 🟠 correctness/security risk · 🟡 incomplete or drift

---

## Summary

| # | Gap | Severity | Area |
|---|---|---|---|
| 1 | Pub/Sub pushes to `/events`; workers serve `/pubsub/item` | 🔴 | infra ↔ worker |
| 2 | Scheduler calls `/reconcile`, which does not exist | 🔴 | infra ↔ ingestion |
| 3 | Cloud Tasks queue provisioned but never used | 🟠 | ingestion |
| 4 | Raw payloads never written to Cloud Storage; scoring reads a URL | 🔴 | ingestion + sentiment |
| 5 | Brand-scoped reads don't enforce `brandEntityId` | 🟠 | API authz |
| 6 | Cursor pagination has no `ORDER BY` | 🟠 | API correctness |
| 7 | Topic names differ between code and Terraform | 🔴 | messaging |
| 8 | Web app can't be pointed at the API at deploy time | 🟠 | web ↔ infra |
| 9 | Sentiment worker swallows errors — DLQ never receives anything | 🟠 | sentiment |
| 10 | `dimension_scores` is never written | 🟡 | deferred (Epic 11) |
| 11 | Unused denormalised sentiment columns on `signals` | 🟡 | schema |
| 12 | `POST /admin/users` is owner-only; no users UI | 🟡 | API + web |
| 13 | Six dashboard views still render mock data | 🟡 | deferred (Epic 6) |
| 14 | ~~Hardcoded contractor fallbacks in the web client~~ | ✅ resolved | web config |
| 15 | ~~Working directory is not a git repository~~ | ✅ resolved | repo |
| 16 | No GCP environment provisioned (contractor's was abandoned) | 🔴 | infra |

---

## 1. 🔴 Pub/Sub pushes to `/events`; the workers serve different paths

**Where:** `infra/modules/pubsub/main.tf` (both subscriptions) vs
`apps/sentiment-worker/src/main.ts`, `apps/report-worker/src/main.ts`.

Terraform configures both push subscriptions with
`push_endpoint = "${var.sentiment_push_url}/events"` (and `${var.report_push_url}/events`).
The sentiment worker exposes **`POST /pubsub/item`**. The report worker exposes **no POST
route at all** — only `/health` and `/ready`.

**Effect:** every scoring message 404s, retries 5 times, then dead-letters. No signal is ever
scored in a deployed environment.

**Fix options:** change the worker route to `/events`, or change the Terraform
`push_endpoint` to `/pubsub/item`. Whichever is chosen, apply it consistently — and give
report-worker a matching endpoint (or drop its subscription until Epic 12).

---

## 2. 🔴 Scheduler calls `/reconcile`, which does not exist

**Where:** `infra/modules/scheduler/main.tf` (`google_cloud_scheduler_job.sweep`) vs
`apps/ingestion/src/main.ts`.

The hourly pending-sweep job POSTs `${ingestion_url}/reconcile`. Ingestion serves only
`/health`, `/ready`, `/ingest`, and `/ingest/dispatch`.

**Effect:** the safety net described in `PLAN.md` step 5 — re-publishing signals missed by a
failed dual-write — never runs. The job 404s hourly.

**Fix:** implement `POST /reconcile` in ingestion (find signals with no `sentiment_results`
row and re-publish their ids to the item topic), or remove the scheduler job until it exists.

---

## 3. 🟠 Cloud Tasks queue is provisioned but never used

**Where:** `infra/modules/cloud_tasks/` and the `TASKS_QUEUE` env var in
`infra/stack/main.tf` vs `apps/ingestion/src/main.ts`.

`PLAN.md` specifies that the dispatcher enqueues **one Cloud Tasks job per (brand × source)**,
with the queue's rate limit protecting third-party API quotas. In practice
`POST /ingest/dispatch` runs every enabled job in-process via `Promise.allSettled`. No Cloud
Tasks client exists anywhere in the codebase (`@google-cloud/tasks` is not a dependency), and
nothing reads `TASKS_QUEUE`.

**Effect:**
- The rate limiting that justified the queue (5 dispatches/sec, 10 concurrent) is not in
  effect — all sources are hit concurrently.
- A fan-out across many brands runs inside a single HTTP request and can exceed the Cloud Run
  request timeout. Each Apify adapter alone can block for up to 5 minutes polling a run.
- Cloud Tasks' retry policy (5 attempts, 5s–300s backoff) is unused; a failed source is simply
  counted in `failed` and dropped until next week.

**Fix:** have `/ingest/dispatch` enqueue a Cloud Tasks job per `source_config` targeting
`POST /ingest`, and let the queue drive concurrency and retries.

---

## 4. 🔴 Raw payloads never reach Cloud Storage; scoring reads a URL

**Where:** `apps/ingestion/src/handler.ts` vs `infra/modules/storage/`, and
`apps/sentiment-worker/src/handler.ts`.

The `raw` bucket exists, ingestion's SA has `objectAdmin` on it, the sentiment SA has
`objectViewer`, and `RAW_BUCKET` is injected into both services. But **no GCS client exists
in the codebase** (`@google-cloud/storage` is not a dependency) and nothing reads
`RAW_BUCKET`. Ingestion sets `rawStorageRef: item.url` — a URL, not a storage reference — and
the `RawItem.text` it fetched is discarded.

Downstream, the sentiment worker logs its own warning and scores the URL string:

```ts
console.warn(`[placeholder] Using source_url as scoring text — raw storage not yet wired.`);
const text = signal.sourceUrl;
```

**Effect:** two failures compounded —
- The **audit trail is empty**. `raw_storage_ref` cannot be resolved to anything; the
  verbatim-evidence promise in the product spec is unbacked.
- **Every sentiment score is meaningless.** Gemini is asked to judge the sentiment of a URL.
  Rows are written to `sentiment_results` with real-looking labels and confidences, so this
  fails silently and looks like it works.

**Fix:** in ingestion, upload each `RawItem` (text + metadata) to
`gs://<RAW_BUCKET>/<tenant>/<brand>/<source>/<externalId>.json` and store that path as
`raw_storage_ref`; in the sentiment worker, fetch and score the stored text. This is the single
highest-value gap on the list.

---

## 5. 🟠 Brand-scoped reads don't enforce `brandEntityId`

**Where:** `apps/api/src/routes/signals.ts` — all three handlers.

`GET /brands/:id/signals`, `/sentiment-summary` and `/dimension-scores` filter on
`request.user.tenantId` and the `:id` from the URL, but never compare `:id` against
`request.user.brandEntityId`.

**Effect:** a user with role `user`, pinned to brand A, can read brand B's signals and
sentiment by changing the URL — including competitor brands tracked by their tenant.
Cross-tenant isolation holds; **intra-tenant brand isolation does not**. `GET /brands` *does*
enforce it, so the restriction is visibly intended.

`PLAN.md`'s Epic 5 acceptance criterion — "a signed-in user with role `user` can only access
their assigned brand's data" — is not met.

**Fix:** add a shared preHandler or helper that rejects when
`role === 'user' && brandEntityId !== params.id`, and apply it to every `/brands/:id/*` route.

---

## 6. 🟠 Cursor pagination has no `ORDER BY`

**Where:** `apps/api/src/routes/signals.ts`, `GET /brands/:id/signals`.

The query uses `gt(signals.id, cursor)` for keyset pagination but issues no `ORDER BY`.
Postgres is free to return rows in any order, and `signals.id` is a **random UUID**, so it
carries no meaningful sequence.

**Effect:** pages can repeat rows, skip rows, or terminate early. The bug is invisible at
small row counts, which is exactly when it will be tested.

**Fix:** order by a stable, meaningful key — `ORDER BY published_at DESC, id DESC` — and make
the cursor a composite of those columns.

---

## 7. 🔴 Topic names differ between code and Terraform

**Where:** `libs/messaging/src/index.ts` vs `infra/modules/pubsub/main.tf`.

| | Item topic | Item DLQ |
|---|---|---|
| Code (`TOPICS`) | `project-signal-item-queue` | `project-signal-item-dlq` |
| Terraform | `<env>-item` (e.g. `staging-item`) | `<env>-item-dlq` |

Terraform even injects the correct name as `ITEM_TOPIC`, but **no code reads `ITEM_TOPIC`** —
ingestion publishes to the hardcoded `TOPICS.ITEM_QUEUE`.

**Effect:** in a deployed environment, ingestion publishes to a topic that does not exist.
Depending on client behaviour this either throws or silently creates an unsubscribed topic;
either way the sentiment worker never receives the message. Combined with gap #1, the scoring
pipeline is disconnected at both ends.

**Fix:** read topic names from the environment (`ITEM_TOPIC`, and add `REPORT_TOPIC`), with
the `TOPICS` constants as local-development defaults.

---

## 8. 🟠 The web app can't be pointed at the API at deploy time

**Where:** `infra/stack/main.tf` (`module.run_web`) vs `apps/web/src/lib/api.ts`.

Terraform sets `API_URL = module.run_api.uri` on the web Cloud Run service. The client reads
`process.env.NEXT_PUBLIC_API_URL`, falling back to a hardcoded staging URL. Two problems
compound: the names don't match, and `NEXT_PUBLIC_*` variables are **inlined at build time**,
so setting one as a Cloud Run runtime env var has no effect regardless of naming.

**Effect:** the deployed dashboard always talks to whatever URL was baked into the image —
currently the hardcoded staging fallback. A production deploy would call the staging API.

**Fix:** pass `NEXT_PUBLIC_API_URL` as a Docker **build arg** in the deploy workflow, or move
API-base resolution to a runtime-read server route / `window` config object.

Related: Terraform never sets `CORS_ORIGINS` on the API, so the API reflects any origin. That
is documented as acceptable (Bearer-only auth, no cookies), but it means the allowlist code
path is untested in a deployed environment.

---

## 9. 🟠 The sentiment worker swallows errors, so the DLQ never fires

**Where:** `apps/sentiment-worker/src/handler.ts`.

`handlePubSubMessage` wraps scoring in `try/catch`, logs, and returns normally. `main.ts`
then returns 204 regardless.

**Effect:** Pub/Sub sees every delivery as successful. The DLQ, `max_delivery_attempts = 5`,
and the 10s–600s retry backoff configured in Terraform can never trigger. A Gemini outage
silently drops every signal in the window, and there is no queue of failures to replay.

**Fix:** distinguish permanent failures (malformed JSON from the model → log, ack, move on)
from transient ones (network, quota, 5xx → rethrow so Pub/Sub retries and eventually
dead-letters). A missing signal row should stay a permanent, acked failure as it is today.

---

## 10. 🟡 `dimension_scores` is never written

**Where:** `libs/db/src/schema/dimensionScores.ts`, `GET /brands/:id/dimension-scores`.

The table, its unique constraint, and the read endpoint exist; nothing populates it. This is
**intended** — the scoring engine (5-dimension index with 90-day recency decay and daily
rollups) is Epic 11, explicitly deferred. `PLAN.md` notes the columns exist so the dashboard
can query them.

**Effect:** the endpoint always returns `[]`. Not a bug, but don't debug it as one.

---

## 11. 🟡 Unused denormalised sentiment columns on `signals`

**Where:** `libs/db/src/schema/signals.ts`.

`signals` carries `sentiment_label`, `sentiment_score`, `confidence`, and `model_version`
alongside the `sentiment_results` table that holds the same fields. Nothing writes the
columns on `signals`; all reads join `sentiment_results`.

**Effect:** two plausible homes for the same data invites a future writer to pick the wrong
one and split the truth.

**Fix:** either drop the columns in a migration, or adopt them deliberately as a denormalised
read cache maintained by the worker. Decide before anything starts writing them.

---

## 12. 🟡 `POST /admin/users` is owner-only, and there's no users UI

**Where:** `apps/api/src/routes/users.ts` vs `PLAN.md` Epics 5 and 6.

The plan says an `admin` can provision users in their tenant and an `owner` can provision
admins. The route is gated `requireRole('owner')` only, so admins cannot create users
(they *can* PATCH existing ones). There is also no check preventing an admin from escalating
someone — including themselves — to `owner` via PATCH.

Separately, the Admin view implements tenant creation plus brand/source/alias management, but
**not** the users list / provision / edit UI that Epic 6 specifies.

**Fix:** allow `admin` to POST users constrained to their own tenant and to non-`owner` roles;
constrain PATCH the same way; then build the users panel in `apps/web/src/views/Admin.tsx`.

---

## 13. 🟡 Six dashboard views still render mock data

**Where:** `apps/web/src/lib/data.ts` (~590 lines) consumed by Dashboard, Trends, Achilles,
Roadmap, Competitors and Report.

Only the Admin view and `BrandManager` call the live API. Everything analytical renders
deterministic generated data for a fictional bank, "Cadence".

This is **known and tracked** — Epic 6's exit criterion is "mock data file is deleted".
Note that `lib/types.ts` defines presentation shapes that don't match `@project-signal/shared-types`
or the API rows, so wiring will require a mapping layer or a reshape of those types.

**Effect:** the dashboard looks complete and fully populated while being entirely
disconnected. Demos will mislead unless this is stated.

---

## 14. ✅ Hardcoded contractor fallbacks in the web client — **resolved**

**Where:** `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/api.ts`.

Both used to fall back to the contractor's live values — their Firebase API key, auth domain
and project id, and their staging Cloud Run API URL — whenever the `NEXT_PUBLIC_*` variables
were absent. A build with missing env vars silently produced a working app pointed at
somebody else's environment.

**Resolved during the Project Signal handover rename.** The Firebase config values are now
required with no fallback and throw a named error at startup; `API_BASE` defaults to
`http://localhost:8080` instead of a remote URL. Gap #8 (build-time vs runtime env) is
unchanged and still open — the deployed web app still needs `NEXT_PUBLIC_API_URL` passed as a
Docker build arg.

---

## 15. ✅ Not a git repository — **resolved**

The working tree had no `.git` directory, so nothing could be committed and the entire CI/CD
design was unreachable.

**Resolved during handover:** the repo is initialised with `main` and `staging` branches (the
branches `ci.yml`, `deploy-staging.yml` and `terraform-plan.yml` expect). A remote still needs
adding, and `github_repository` in `infra/bootstrap/variables.tf` must match it or Workload
Identity Federation will reject the CI token.

---

## 16. 🔴 No GCP environment is provisioned

**Where:** `infra/envs/staging.tfvars`, `infra/envs/production.tfvars`,
`infra/bootstrap/variables.tf`.

The stack was originally applied to a **contractor-owned test project**. That environment was
abandoned at handover and every reference to it removed from this repo, so there is currently
no project, no Cloud SQL instance, no buckets, no Identity Platform tenant and no Artifact
Registry to deploy into.

**Blocked on, in order:**

1. Create a GCP project with billing enabled; put its id and number into
   `envs/staging.tfvars` (both are `REPLACE_ME`).
2. Create the GitHub repo and set `github_repository` in `infra/bootstrap/variables.tf` to
   match — the WIF provider's `attribute_condition` pins tokens to exactly that repo, so a
   mismatch fails CI auth with an unhelpful error.
3. Run `infra/bootstrap/` once, then set the `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`,
   `GCP_PROJECT_ID` and `TF_STATE_BUCKET` secrets on the `staging` GitHub environment.
4. Register the Entra multi-tenant app and export `TF_VAR_auth_social_idps`
   (see `infra/modules/identity_platform/README.md`).
5. Create a Firebase web app in the new project and supply
   `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` as web build args —
   these no longer have fallbacks (gap #14), so the web build fails loudly without them.

Local development is unaffected — Postgres and the Pub/Sub emulator run in Docker and need no
GCP account.

---

## Suggested order of attack

If the goal is a working end-to-end MVP, the dependency order is:

1. ~~**#15** — get it into git.~~ ✅ done at handover.
2. **#16** — stand up a GCP project and run `infra/bootstrap/`. Nothing deployable can be
   verified until this exists. Note that the pipeline fixes below can all be developed and
   unit-tested locally in the meantime, against Docker Postgres and the Pub/Sub emulator.
3. **#7 → #1 → #2** — reconnect the pipeline: correct topic names, matching push endpoints,
   the sweep endpoint. Cheap fixes, and nothing downstream can be observed until they land.
4. **#4** — persist raw text and score it. Until this is done, every sentiment number in the
   system is noise.
5. **#9** — make failures visible via the DLQ, so #4's rollout is debuggable.
6. **#5 and #6** — close the authz gap and fix pagination before the dashboard starts reading
   real data through those endpoints.
7. **#8** — make the deployed web app configurable, then **#13** wire the views to live data.
8. **#3, #11, #12** — hardening and cleanup once the vertical slice is proven.
