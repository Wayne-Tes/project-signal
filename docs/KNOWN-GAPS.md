# Project Signal — Known Gaps

> **Read this before debugging any end-to-end flow.** Several links in the pipeline are
> provisioned in Terraform and implemented in code, but the two halves do not meet. Nothing
> below is a mystery bug — each item is a known, located discrepancy between what
> [`PLAN.md`](PLAN.md) intends, what [`ARCHITECTURE.md`](ARCHITECTURE.md) describes, and what
> the code currently does.
>
> Findings come from a full read of the repo on **2026-08-05**. Items struck through and
> marked ✅ have since been fixed; everything else is still open.
>
> **Severity key:** 🔴 breaks a flow · 🟠 correctness/security risk · 🟡 incomplete or drift

---

## Summary

| #   | Gap                                                           | Severity    | Area                  |
| --- | ------------------------------------------------------------- | ----------- | --------------------- |
| 1   | ~~Pub/Sub pushes to `/events`; workers serve `/pubsub/item`~~ | ✅ resolved | infra ↔ worker        |
| 2   | ~~Scheduler calls `/reconcile`, which does not exist~~        | ✅ resolved | infra ↔ ingestion     |
| 3   | Cloud Tasks queue provisioned but never used                  | 🟠          | ingestion             |
| 4   | ~~Raw payloads never written to Cloud Storage~~               | ✅ resolved | ingestion + sentiment |
| 5   | ~~Brand-scoped reads don't enforce `brandEntityId`~~          | ✅ resolved | API authz             |
| 6   | ~~Cursor pagination has no `ORDER BY`~~                       | ✅ resolved | API correctness       |
| 7   | ~~Topic names differ between code and Terraform~~             | ✅ resolved | messaging             |
| 8   | ~~Web app can't be pointed at the API at deploy time~~        | ✅ resolved | web ↔ infra           |
| 9   | ~~Sentiment worker swallows errors — DLQ never fires~~        | ✅ resolved | sentiment             |
| 10  | `dimension_scores` is never written                           | 🟡          | deferred (Epic 11)    |
| 11  | Unused denormalised sentiment columns on `signals`            | 🟡          | schema                |
| 12  | `POST /admin/users` is owner-only; no users UI                | 🟡          | API + web             |
| 13  | Six dashboard views still render mock data                    | 🟡          | deferred (Epic 6)     |
| 14  | ~~Hardcoded contractor fallbacks in the web client~~          | ✅ resolved | web config            |
| 15  | ~~Working directory is not a git repository~~                 | ✅ resolved | repo                  |
| 16  | No GCP environment provisioned (contractor's was abandoned)   | 🔴          | infra                 |

---

## 1. ✅ Pub/Sub pushed to `/events`; the workers serve different paths — **resolved**

**Where:** `infra/modules/pubsub/main.tf`.

Both push subscriptions targeted `/events`. The sentiment worker serves **`POST /pubsub/item`**;
the report worker serves **no POST route at all**. Every scoring message 404'd, retried five
times and dead-lettered, so no signal was ever scored in a deployed environment.

**Resolved** on the Terraform side, which is the half that was wrong:

- The item subscription now pushes to `${var.sentiment_push_url}/pubsub/item`.
- The report subscription is **no longer created by default**. It is gated behind
  `enable_report_subscription` (default `false`) because report-worker is a health-check
  skeleton until Epic 12 — creating it would 404 every weekly trigger and dead-letter it. The
  report _topic_ still exists so Cloud Scheduler has a publish target.

Note this gap was briefly recorded as "dissolved by the AWS migration" on the grounds that SQS
is pulled. That was wrong while GCP remains the environment being stood up for testing: it
would have blocked the first end-to-end run.

---

## 2. ✅ Scheduler called `/reconcile`, which did not exist — **resolved**

**Where:** `apps/ingestion/src/main.ts`, `apps/ingestion/src/handler.ts`.

The hourly pending-sweep job POSTed `${ingestion_url}/reconcile` and got a 404, so the safety
net in `PLAN.md` step 5 — re-publishing signals missed by a failed dual-write — never ran.

**Resolved** by `reconcilePendingSignals()` behind `POST /reconcile`. It selects signals with
no `sentiment_results` row (LEFT JOIN … IS NULL) and re-publishes their ids to the item topic.
Idempotent by construction: a scored signal is never selected, so repeated runs are safe. The
sweep is bounded at 500 rows so a large backlog cannot exceed the Cloud Run request timeout.

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

## 4. ✅ Raw payloads never reached Cloud Storage; scoring read a URL — **resolved**

**Where:** `libs/storage/`, `apps/ingestion/src/handler.ts`, `apps/sentiment-worker/src/handler.ts`.

No GCS client existed, nothing read `RAW_BUCKET`, ingestion stored `rawStorageRef: item.url`
and discarded the fetched text, and the sentiment worker scored that URL string — writing
real-looking labels and confidences derived from nothing. The audit trail was empty and every
sentiment number in the system was noise.

**Resolved** with a new `@project-signal/storage` lib exposing a two-method `ObjectStore`
(`put`/`get`) plus `rawKey()` and `keyFromRef()`, with a GCS implementation behind
`getObjectStore()`.

- **Ingestion** uploads each item as
  `gs://<RAW_BUCKET>/<tenant>/<brand>/<source>/<externalId>.json` and stores the returned
  reference. The upload happens **before** the row insert, so `raw_storage_ref` can never point
  at an object that does not exist.
- **The sentiment worker** resolves the reference and scores the stored `text`.

The interface is deliberate: the AWS migration's `S3ObjectStore` drops in behind it without
touching a caller, and `keyFromRef()` already parses both `gs://` and `s3://`.

**Rows written before this fix hold a bare URL** in `raw_storage_ref`. `keyFromRef()` rejects
those, and the worker classifies the rejection as a permanent failure (see #9), so they are
acked and logged rather than retried forever. They cannot be scored — the text was never kept.

---

## 5. ✅ Brand-scoped reads don't enforce `brandEntityId` — **resolved**

**Where:** `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/signals.ts`.

`GET /brands/:id/signals`, `/sentiment-summary` and `/dimension-scores` filtered on
`request.user.tenantId` and the `:id` from the URL, but never compared `:id` against
`request.user.brandEntityId`. A user with role `user` pinned to brand A could read brand B's
signals and sentiment — including competitor brands tracked by their tenant — by changing the
URL. Cross-tenant isolation held; intra-tenant brand isolation did not.

**Resolved** by a shared `requireBrandAccess` preHandler in the auth plugin, applied to all
three `/brands/:id/*` routes. It rejects with 403 when `role === 'user'` and the user's pinned
`brandEntityId` differs from `:id`.

One deliberate nuance: an **unpinned** `user` (no `brandEntityId` claim) is not constrained.
That matches `GET /brands`, which returns every brand in the tenant when no pin is set — both
routes treat "no pin" as tenant-wide read access. `owner` and `admin` are never constrained.

This meets `PLAN.md`'s Epic 5 acceptance criterion.

---

## 6. ✅ Cursor pagination has no `ORDER BY` — **resolved**

**Where:** `apps/api/src/routes/signals.ts`, `GET /brands/:id/signals`.

The query used `gt(signals.id, cursor)` for keyset pagination but issued no `ORDER BY`.
Postgres was free to return rows in any order, and `signals.id` is a random UUID carrying no
sequence, so pages could repeat rows, skip rows, or terminate early.

**Resolved** with `ORDER BY published_at DESC, id DESC` and a composite cursor. The cursor is
base64url of `<publishedAt ISO>|<id>`, and the keyset predicate is the row-value comparison
`(published_at, id) < (cursor.publishedAt, cursor.id)`. Both columns are encoded because
neither is a stable sort key alone — `published_at` is not unique and `id` carries no order.

A malformed cursor now returns **400** rather than silently serving page one.

**Two further defects were found while verifying this against a live Postgres**, neither of
which any mocked test could reach. Both are fixed:

- The first implementation used the textbook raw-SQL row-value predicate
  `(published_at, id) < ($1, $2)`. Valid Postgres, but interpolating a JS `Date` into a raw
  `sql` fragment bypasses drizzle's timestamptz serialiser — the parameter arrived as
  `Thu Jan 01 2026 04:00:00 GMT+0000 (Greenwich Mean Time)` and page 2 returned **500**. The
  predicate now uses drizzle's typed operators, which emit ISO-8601. `test/routes/keyset.test.ts`
  renders the condition through the real `PgDialect` to cover the serialisation directly.
- **`GET /brands/:id/signals` had never returned any signal data.** Its response schema
  declared `items: { type: 'object' }` with no `properties`, and fast-json-stringify strips
  everything undeclared, so every row serialised to `{}`. The endpoint returned
  `items: [{}, {}]`. This predates the pagination work and was invisible because the six
  dashboard views render mock data (#13). The schema now declares the columns.

---

## 7. ✅ Topic names differed between code and Terraform — **resolved**

**Where:** `libs/messaging/src/index.ts`, `apps/ingestion/src/handler.ts`.

|                 | Item topic                  | Item DLQ                  |
| --------------- | --------------------------- | ------------------------- |
| Code (`TOPICS`) | `project-signal-item-queue` | `project-signal-item-dlq` |
| Terraform       | `<env>-item`                | `<env>-item-dlq`          |

Terraform injected the correct name as `ITEM_TOPIC`, but nothing read it — ingestion published
to the hardcoded constant, a topic that does not exist in any deployed environment.

**Resolved** with `topicName('item' | 'report')`, which reads `ITEM_TOPIC` / `REPORT_TOPIC`
from the environment and falls back to the `TOPICS` constants for local development against the
emulator. An empty-string override is treated as unset rather than becoming the topic name.
Both `handleIngestionJob` and `reconcilePendingSignals` publish through it.

---

## 8. ✅ The web app can't be pointed at the API at deploy time — **resolved**

**Where:** `apps/web/Dockerfile`, `.github/workflows/deploy-{staging,production}.yml`.

Terraform set `API_URL` on the web Cloud Run service while the client read
`NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_*` is **inlined at build time** — so a runtime env var
could never have worked regardless of naming.

**Resolved by taking the build-arg option.** `apps/web/Dockerfile` now declares
`NEXT_PUBLIC_API_URL` and the three `NEXT_PUBLIC_FIREBASE_*` values as build args, and both
deploy workflows pass them from the environment's GitHub secrets for the `web` matrix leg only.

One wrinkle remains by nature rather than by defect: the API's Cloud Run URL doesn't exist
until the first apply, so the first deploy of a new environment builds web against the
localhost fallback. Read `terraform output api_url`, set the `NEXT_PUBLIC_API_URL` secret, and
re-run the deploy. `infra/README.md` § Build-time configuration for the web app documents it.

Related and still open: Terraform never sets `CORS_ORIGINS` on the API, so the API reflects any
origin. That is documented as acceptable (Bearer-only auth, no cookies), but it means the
allowlist code path is untested in a deployed environment.

---

## 9. ✅ The sentiment worker swallowed errors, so the DLQ never fired — **resolved**

**Where:** `apps/sentiment-worker/src/handler.ts`, `apps/sentiment-worker/src/main.ts`.

`handlePubSubMessage` wrapped scoring in try/catch, logged, and returned normally; `main.ts`
returned 204 regardless. Pub/Sub saw every delivery as a success, so the DLQ,
`max_delivery_attempts = 5` and the 10s–600s retry backoff configured in Terraform could never
trigger. A Gemini outage silently dropped every signal in the window.

**Resolved** by classifying failures:

- **Permanent** — missing signal row, unresolvable `raw_storage_ref`, stored payload that is
  not JSON or has no text, model output that will not parse. Raised as `PermanentScoringError`;
  `main.ts` logs at error level and returns **204** (ack). Retrying sends the identical prompt
  and gets the identical garbage, so five deliveries add noise, not information.
- **Transient** — network, quota, 5xx from Vertex or the bucket. Rethrown; `main.ts` returns
  **500** (nack), so Pub/Sub retries with backoff and eventually dead-letters.

---

## 10. ✅ `dimension_scores` was never written — **resolved (Epic 11, first slice)**

**Where:** `libs/scoring/` (new), `apps/ingestion/src/rollup.ts` (new),
`infra/modules/scheduler/main.tf`.

The table, its unique constraint and `GET /brands/:id/dimension-scores` all existed; nothing
populated them, so the endpoint always returned `[]`. That made it the hard dependency under
#13 — five of the six dashboard views read dimension scores.

**Resolved** by building the scoring engine's rollup, straight from the product spec rather
than invented:

- `recencyWeight` — exponential decay, `2^(-age/90d)`, per spec §Scoring: _"an exponential
  decay function with a 90-day half-life"_. A half-life, not a window: old signals fade, they
  do not drop.
- `scoreDimension` — weighted average of sentiment for items tagged to a dimension, weighted by
  `recency × confidence`, mapped onto the spec's 0–100 index. Returns `null` for a dimension
  with no data, which is distinct from a score of 0.
- `compositeScore` — the Brand Perception Index. Weights are configurable per brand (new
  `brand_entities.dimension_weights` jsonb, migration `0006`), defaulting to equal. Weights are
  **renormalised over dimensions that actually have data**, so a brand with no `value` signals
  is not penalised as though its value score were zero.
- `clusterTopics` / `achillesHeels` — the spec's `volume × negative sentiment × recency` damage
  score, top three, zero-damage clusters excluded rather than padding the list with topics
  nobody complained about.

`POST /rollup` on the ingestion service upserts one row per brand × dimension per day, driven
by a new daily Cloud Scheduler job. It is hosted on ingestion because that app is already the
private, scheduler-invoked home for batch work (`/reconcile`), which avoids standing up a sixth
Cloud Run service for a nightly aggregation.

**Verified against real Postgres**, not only in unit tests:

| Check                              | Result                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /rollup`                     | `{"brands":6,"rows":2}`                                                                                                                    |
| `dimension_scores`                 | trust 10.00 (5 signals), quality 95.00 (5 signals) — exactly `toIndex(-0.8)` and `toIndex(0.9)`                                            |
| `GET /brands/:id/dimension-scores` | returns real rows; it had never returned anything but `[]`                                                                                 |
| Recency decay                      | recent −1 vs 180-day-old +1 in one dimension → **20.00**, matching `(1×−1 + 0.25×1)/1.25 = −0.6`. An unweighted mean would have scored 50. |
| Idempotency                        | 3 rows before a second run, 3 after — upsert, not duplicate                                                                                |

**Read endpoints added.** `GET /brands/:id/score` returns the composite for the latest rollup
with its per-dimension breakdown and the comparison point at least seven days earlier;
`GET /brands/:id/achilles` returns the top damage-ranked topic clusters, computed on read;
`GET /brands/:id/dimension-scores` now takes `from`/`to` and defaults to 90 days, which it
needed once the table started growing daily. All three live in `apps/api/src/routes/scores.ts`.

Verified live against real Postgres with per-brand weights `{trust: 0.75, quality: 0.25}`:

| Endpoint                    | Result                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `/score`                    | `31.25` = `.75×10 + .25×95`; previous `45` = `.75×40 + .25×60`      |
| `/score` comparison         | picked the 9-day-old rollup, correctly skipping a 5-day-old one     |
| `/dimension-scores`         | 4 rows across 2 dates, ordered by date then dimension               |
| `/dimension-scores?from&to` | narrowed to the requested day only                                  |
| `/achilles`                 | `fees` damage `3.969` = `volume 5 × negativity 0.8 × recency 0.992` |

---

## 11. ✅ Unused denormalised sentiment columns on `signals` — **resolved**

**Where:** `libs/db/src/schema/signals.ts`, `apps/api/migrations/0005_demonic_mindworm.sql`.

`signals` carried `sentiment_label`, `sentiment_score`, `confidence` and `model_version`
alongside the `sentiment_results` table holding the same fields. Nothing wrote them; every read
joined `sentiment_results`.

**Resolved by dropping the columns** rather than adopting them as a read cache. Two plausible
homes for one fact invite a future writer to pick the wrong one and split the truth. Verified
safe before dropping: all four columns were NULL across every row, and the only reference
anywhere in the codebase was the schema definition itself.

If a denormalised cache is ever wanted for list performance, reintroduce it deliberately,
maintained by the sentiment worker in the same transaction as the `sentiment_results` write.

---

## 12. 🟠 `POST /admin/users` role gating — **API resolved, UI blocked**

**Where:** `apps/api/src/routes/users.ts`, `apps/web/src/components/UserManager.tsx`.

**Resolved on the API.** Three holes, one worse than this entry originally described:

1. `POST` was `requireRole('owner')`, so admins could not provision their own tenant's users.
   Now `owner, admin`, with an admin constrained to their own `tenantId` and to the roles
   `admin` / `user`.
2. `PATCH` allowed an admin to set `role: 'owner'` on anyone, including themselves. Now
   rejected, as is modifying an existing owner.
3. **`PATCH` had no tenant filter at all** — it updated on `id` alone, so an admin in tenant A
   could modify a user in tenant B. This was a cross-tenant isolation hole, not merely an
   escalation one. It now reads the target first and returns 404 for a foreign tenant, so the
   row's existence is not confirmed either.

Verified against a live API: escalation 403, modifying an owner 403, foreign tenant 404.

**The UI is written but cannot be called done.** `UserManager.tsx` lists the tenant's users,
allows role changes within the assignable set, and provisions new users. It lints, typechecks,
builds, and the endpoints behind it are verified — but it has never been driven in a browser.
The panel sits behind `AuthGate`, and signing in needs a real Identity Platform project, so it
is gated on **#16**, not on the build. DEVRULES requires UI work to be exercised as a real user
before it is complete.

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

**Blocked on, in order** — everything here needs a GCP account, so none of it can be done from
the repo. `infra/README.md` § First-time setup is the executable version of this list.

1. Create a GCP project with billing enabled; put its id and number into
   `envs/staging.tfvars` (both are still `REPLACE_ME`).
2. ~~Set `github_repository` in `infra/bootstrap/variables.tf` to match the real repo.~~ ✅
   done — it is `LokimotiveUK/project-signal`. Change it if the repo moves; the WIF provider's
   `attribute_condition` pins tokens to exactly that string.
3. Copy `infra/bootstrap/bootstrap.tfvars.example` → `bootstrap.tfvars`, fill it in, run
   `infra/bootstrap/` once, then set `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`
   and `TF_STATE_BUCKET` on the `staging` GitHub environment.
4. Create the `staging-youtube-api-key` and `staging-apify-api-key` secrets with `gcloud`
   **before the first stack apply** — the IAM grants in `stack/main.tf` reference them by
   resource name and the apply fails if they are absent.
5. Register the Entra multi-tenant app and export `TF_VAR_auth_social_idps`
   (see `infra/modules/identity_platform/README.md`). Optional — email/password sign-in works
   without it.
6. Create a Firebase web app in the new project and set `NEXT_PUBLIC_FIREBASE_API_KEY` /
   `_AUTH_DOMAIN` / `_PROJECT_ID` as GitHub environment secrets — they are passed as web build
   args (gap #8) and have no fallbacks (gap #14), so the app throws without them.
7. After the first apply, set `NEXT_PUBLIC_API_URL` from `terraform output api_url`, add the
   web URL to `auth_authorized_domains` in `envs/staging.tfvars`, and re-run the deploy.

Local development is unaffected — Postgres and the Pub/Sub emulator run in Docker and need no
GCP account.

---

## 17. ✅ `apps/web` production build failed — **resolved (local Node version)**

**Where:** the developer machine, not the codebase.

`yarn nx run @project-signal/web:build` failed during static generation:

```
Error occurred prerendering page "/_global-error"
TypeError: Cannot read properties of null (reading 'useContext')
```

The symptom matches a widely-reported Next.js 16 issue
([#86178](https://github.com/vercel/next.js/issues/86178),
[#85668](https://github.com/vercel/next.js/issues/85668),
[#84994](https://github.com/vercel/next.js/issues/84994)), and the obvious readings — an
application bug, or a stale Next version — were both wrong.

**Root cause: the local Node runtime was v24.14.0.** Next 16 targets Node 20/22. On Node 24 the
React dispatcher is null during the SSR prerender pass, which surfaces as the `useContext`
error on Next's internal `/_global-error` page.

Established by elimination, each step tested rather than reasoned about:

| Test                                                       | Result                                        |
| ---------------------------------------------------------- | --------------------------------------------- |
| Clean tree, all local changes stashed                      | Fails — pre-existing, not introduced          |
| Next 16.2.7 → 16.3.0 (latest)                              | Still fails                                   |
| Next → 16.3.1-canary.4                                     | Still fails                                   |
| Trivial `page.tsx`                                         | Still fails                                   |
| Trivial `page.tsx` **and** `layout.tsx`                    | Still fails                                   |
| `output: 'standalone'` removed                             | Still fails                                   |
| React copies in the tree                                   | Exactly one, 19.2.7, cleanly hoisted          |
| **`docker build -f apps/web/Dockerfile` (node:20-alpine)** | **Succeeds — 3/3 static pages, image tagged** |
| `next dev` on Node 24                                      | Works fine, serves 200                        |

**So nothing was ever broken for CI or deploy.** `ci.yml` pins `node-version: 20` for lint,
typecheck and test; every app Dockerfile is `node:20-alpine`. Only `next build` run directly on
a Node 24 host failed — and `next dev` on Node 24 is unaffected, which is why this went
unnoticed.

**Resolved** by pinning the local runtime rather than touching Next.js: added `.nvmrc` (`20`)
and narrowed `engines.node` to `>=20.0.0 <23.0.0` so an unsupported runtime fails loudly at
install instead of surfacing as a null React dispatcher three layers down.

> Correction to an earlier note in this document: this gap was recorded as blocking browser
> verification of UI work. It never did — `next dev` works. The actual blocker for verifying
> authed views is #16, because everything behind `AuthGate` needs a real Identity Platform
> project to sign in against.

---

## 18. ✅ User writes were not atomic with Firebase custom claims — **resolved**

**Where:** `apps/api/src/lib/claims.ts` (new), `apps/api/src/routes/users.ts`,
`apps/api/src/routes/admin.ts`.

Authorisation reads custom claims, not the `users` table, so the two diverging is a security
problem rather than an untidiness. Three paths were affected — the third found while fixing the
first two:

1. `POST /admin/users` wrote the row, then set claims. A claims failure left an orphan row for
   a user who could not authenticate.
2. `PATCH /admin/users/:id` did the same. A failed **demotion** was the dangerous case: the
   table recorded the new lower role while the user kept their old claim, and therefore their
   old access.
3. **`POST /admin/tenants` never set claims at all.** It created the tenant, its brand and its
   admin `users` row, and stopped. Because authz reads claims, that admin had no `role` or
   `tenantId` and could not authorise a single request — the primary onboarding path produced
   a tenant nobody could administer.

**Resolved** by writing the row and the claims inside one database transaction, via a shared
`setUserClaims()` helper that also pins the claim shape to what `plugins/auth.ts` reads. A
Firebase failure now rolls the row back and neither system moves.

The residual window is a commit failure _after_ the claims call succeeded, leaving claims ahead
of the table. That cannot be closed without a distributed transaction, and it is the safer of
the two directions since the claim is the value actually enforced. It is documented in
`claims.ts`.

**Verified against real Postgres with no GCP credentials**, so `setUserClaims` genuinely fails.
Same request, A/B across the fix:

|                                               | HTTP | orphan row persisted |
| --------------------------------------------- | ---- | -------------------- |
| Pre-fix ordering (row committed, then claims) | 500  | **1**                |
| Fixed (claims inside the transaction)         | 500  | **0**                |

All three paths confirmed: users 3 → 3, tenants 3 → 3, no orphan user, no orphan tenant, and a
PATCH that failed left the target's role unchanged at `owner`.

---

## 19. 🟡 Web components use literal hex instead of CSS custom properties

**Where:** every component under `apps/web/src` except `UserManager.tsx`.

`CLAUDE.md` and `DEVRULES.md` both require styling through the CSS custom properties defined in
`app/globals.css`, because literal hex breaks the runtime palette switcher. In practice
`BrandManager.tsx` alone carries 23 literal hex values and none of the others use `var(--…)`
either. Several literals are also off-palette (`#8a8f99`, `#1e2128`, `#e8e8ea`), so a
conversion is a visual change, not a mechanical substitution.

`UserManager.tsx` was written compliant. The rest was left alone deliberately: a 10-file
visual refactor inside a users-UI task would have been unreviewable, and it cannot currently be
verified in a browser because of #17.

---

## Burn-down order

**This register is the backlog** (owner's decision, 2026-08-06 — see `DEVRULES.md` § Standing
conflicts). It is not a list of sanctioned deferrals: no new feature work, including the AWS
migration, starts while items remain open.

Done:

1. ~~**#15** — get it into git.~~ ✅ at handover.
2. ~~**#14** — remove hardcoded contractor fallbacks.~~ ✅ at handover.
3. ~~**#8** — make the deployed web app configurable.~~ ✅ Docker build args.
4. ~~**#5 and #6** — intra-tenant authz hole and non-deterministic pagination.~~ ✅ Taken first
   because #5 was a live security defect.
5. ~~**#7 → #2 → #4 → #9**, plus **#1**.~~ ✅ The pipeline group: topic names from the
   environment, the `/reconcile` sweep, raw payload storage behind an `ObjectStore` interface,
   and permanent-vs-transient failure classification so the DLQ can fire. #1 was folded in
   because it blocks the very first end-to-end run on GCP.

Remaining, in dependency order:

6. ~~**#11** — denormalised sentiment columns.~~ ✅ dropped.
7. ~~**#17** — `apps/web` build failure.~~ ✅ local Node 24; pinned to 20.
8. ~~**#18** — user row and Firebase claims atomicity.~~ ✅ one transaction.
9. **#13** — wire the six mock-data views to the live API. The largest remaining item and the
   last of the original register.
10. **#19** — convert web components to CSS custom properties. Do it alongside #13, which
    rewrites those components anyway.
11. **#16** — stand up the GCP environment. Also the gate on finishing **#12's UI half** and on
    browser-verifying anything behind `AuthGate`, since sign-in needs a real Identity Platform
    project.

Closed by architectural decision rather than by a fix:

- **#3** (Cloud Tasks provisioned but unused) — the AWS migration replaces it with SQS, which
  covers both the queue and the rate-limiting role. Building a Cloud Tasks fan-out on a
  platform being left is waste.

Not debt: **#10** (`dimension_scores` never written) is the Epic 11 scoring engine, a feature
not yet built. The table and read endpoint exist so the dashboard can query them.

## Verification note

The pipeline group was verified against running services, not only unit tests — Docker
Postgres plus the Pub/Sub emulator, with the ingestion service and sentiment worker started
locally. Two defects surfaced that way which no mocked test reached: see #6's entry for the
keyset serialisation bug and the empty-`items` serialisation bug.

**Not reachable locally:** a successful Cloud Storage round-trip. There is no GCS emulator in
this repo, so #4's write path and the happy-path read are covered by unit tests and by the
worker genuinely attempting a GCS fetch (which fails on credentials, exercising the transient
branch). The first real round-trip happens when #16 lands.
