# Handover — GCP is being abandoned; AWS is the target, starting now

**Written:** 2026-08-06
**Audience:** the next agent picking this up
**Status of this document:** authoritative on the decision below. Where it disagrees with
`docs/superpowers/plans/2026-08-06-aws-migration.md`, this document wins — that plan was written
under an assumption that no longer holds. See §2.

Read this in full before touching code or writing a plan. Then read, in order:
[`DEVRULES.md`](../DEVRULES.md), [`docs/ARCHITECTURE.md`](ARCHITECTURE.md),
[`docs/KNOWN-GAPS.md`](KNOWN-GAPS.md).

---

## 1. The decision

**The owner has decided (2026-08-06) not to stand up GCP at all. The system goes to AWS, and
that work starts now.**

The prior sequence was: stand up GCP → test end to end → then migrate to AWS. That is cancelled.
GCP was never provisioned (`KNOWN-GAPS` #16 — the contractor's environment was abandoned and no
replacement was ever built), and the owner has chosen not to build a throwaway one.

Everything to date has been developed and verified locally, against Docker Postgres and the
Pub/Sub emulator. **No part of this system has ever run in any cloud.** Treat every claim about
cloud behaviour in the repo's docs as untested design intent.

---

## 2. What the decision changes — this is no longer a migration

This is the single most important thing to internalise, and the existing plan does not reflect
it. `docs/superpowers/plans/2026-08-06-aws-migration.md` is a **migration** plan — 23 tasks
across 7 phases, built around the first bullet of its § Global Constraints —

> _"Nothing in this plan may break the GCP environment until Phase 7. Every phase before it must
> leave `CLOUD_PROVIDER=gcp` fully working."_

**There is no GCP environment to break.** That constraint is void, and with it a large fraction
of the plan's cost and risk. Concretely:

| Plan element                                                          | Status under the new decision                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1 — portability refactor to keep both clouds working (5–7 days) | **Mostly unnecessary as scoped.** No dual path needs maintaining. Keep the interfaces already built; do not build more of them purely for symmetry.                            |
| `CLOUD_PROVIDER` env switch and GCS/S3 factory branches               | **Reconsider.** A switch with one live branch is dead weight. See open decision §6.6.                                                                                          |
| Phase 7 Task 22 — data migration and cutover (3–5 days)               | **Dissolved.** There is no data and no traffic to cut over.                                                                                                                    |
| Phase 7 Task 23 — decommission GCP                                    | **Dissolved.** Nothing is commissioned. Reduces to deleting `infra/` (a decision — see §6.7).                                                                                  |
| Phase 6 — Cognito, rated "High — deepest app change, user-visible"    | **Still the deepest app change, but no longer user-visible.** There are no live users, so "password re-provisioning is irreversible" does not apply. Risk drops materially.    |
| Plan §"Open items requiring a decision before Phase 3", item 2        | **Closed by the decision.** Scoring-prompt parity between Gemini and Claude only mattered for comparing sentiment history across the cutover. There is no history to compare.  |
| Total estimate: 31–44 working days                                    | **Must be re-derived.** It explicitly includes work that no longer exists; the plan itself attributes the delta over its earlier 4–7 week figure "almost entirely" to Phase 1. |

### The risk that this decision _adds_

Be honest about this in the new plan. Skipping GCP removes the intermediate integration
checkpoint. The prior sequence would have proven the pipeline on managed cloud primitives the
team had already provisioned in Terraform, before changing primitives. Now the first real cloud
run happens on AWS, on unprovisioned infrastructure, with new SDKs, new auth and new
messaging semantics — all at once.

**Recommendation for the new plan:** insert a deliberately thin vertical slice as the first
AWS-touching phase — one brand, one source, one signal, end to end (ingest → S3 → queue → score
→ read via the API) on real AWS, before porting breadth. The existing plan's phase order
(foundation → adapters → compute → workers → auth) defers the first true end-to-end run to
Phase 5 of 7. That is too late when nothing has ever run in a cloud.

---

## 3. Where the codebase actually stands

**Re-verified 2026-08-07.** Full gate green — 13 projects lint, 12 typecheck, **297 tests
across 11 projects**. See §8 for the exact commands, the per-project counts, and two runner
traps: one that makes `yarn test` look hung, and one that makes the whole gate pass having run
nothing at all.

`KNOWN-GAPS.md` was made the backlog by owner decision and burned down over the preceding days.
**15 of 19 items are closed.** What remains:

- **#16** — no environment provisioned. **This item is now about AWS, not GCP.** It is still the
  binding constraint on everything: nothing has been verified in a cloud.
- **#12 (remainder)** — the users UI. The API half is done and tested; the UI cannot be driven
  until #16.
- **#13 (remainder)** — Roadmap and Report views still on `apps/web/src/lib/data.ts` mock data.
  Roadmap is **unspecified work, not deferred work**: nothing in Epics 11–13 produces prioritised
  recommendations. Report is Epic 12.
- **#19** — 119 literal hex values in `apps/web` that should be CSS custom properties.

None of these four block the AWS work, and the AWS work does not close any of them except #16.

**Two further defects were found and fixed on 2026-08-07**, both by re-verifying this document
against the code rather than by testing:

- **`GET /brands/:id` was missing `requireBrandAccess`** — the same intra-tenant hole as gap #5,
  at metadata scope. Closed, with tests. The general point is in §7's table: the guard is
  opt-in per route.
- **`deploy-staging.yml` cannot fire** — it triggers on a push to `staging`, and only `main`
  exists. Left as-is deliberately (see `KNOWN-GAPS.md` #15); the branch belongs with the AWS CI.

`ARCHITECTURE.md`, `PLAN.md` and `SETUP.md` were also re-based on the same date — all three
still described the pre-burn-down system in places, including five closed gaps presented as
live symptoms in `SETUP.md` §14.

---

## 4. GCP coupling inventory — verified, and smaller than you expect

This was measured by grep across `apps/` and `libs/` (excluding tests) on 2026-08-06. **Six
files import a Google Cloud SDK.** The blast radius of the port is narrow; the difficulty is
concentrated in auth, not in breadth.

| Concern         | File(s)                                                                                                                         | GCP today                    | AWS counterpart                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| Object storage  | `libs/storage/src/gcs.ts:1`                                                                                                     | `@google-cloud/storage`      | S3. **Interface already exists** — see below |
| Messaging       | `libs/messaging/src/index.ts:1,10`                                                                                              | `@google-cloud/pubsub`       | SQS (+ SNS if fan-out is ever needed)        |
| LLM             | `libs/gemini/src/index.ts:1,10`                                                                                                 | `@google-cloud/vertexai`     | Bedrock                                      |
| Auth (server)   | `apps/api/src/plugins/auth.ts:3,71`, `apps/api/src/lib/claims.ts:1`, `apps/api/scripts/bootstrap-owner.ts:12`                   | `firebase-admin`             | Cognito — **the hard one**, see §5.4         |
| Auth (browser)  | `apps/web/src/lib/firebase.ts:1-2`, `apps/web/src/lib/auth.tsx:9`                                                               | `firebase` v11 client SDK    | Amplify Auth / `amazon-cognito-identity-js`  |
| Project binding | `libs/config/src/index.ts:16`                                                                                                   | `GOOGLE_CLOUD_PROJECT`       | **required, not optional** — see §5.1        |
| Database socket | `libs/config/src/index.ts:11-12` (`DB_SOCKET_PATH`)                                                                             | Cloud SQL Auth Proxy socket  | RDS is plain TCP — `DATABASE_URL`            |
| Infrastructure  | `infra/modules/{artifact_registry,cloud_run,cloud_sql,cloud_tasks,identity_platform,pubsub,scheduler,service_accounts,storage}` | 9 Terraform modules          | New `infra-aws/` tree                        |
| CI/CD           | `.github/workflows/{deploy-staging,deploy-production,terraform-plan}.yml`                                                       | Workload Identity Federation | GitHub OIDC → IAM role                       |

**Already portable.** `libs/storage` was built during the backlog burn-down with the split the
plan asked for — `types.ts` (the `ObjectStore` interface), `gcs.ts` (implementation),
`index.ts` (a memoised `getObjectStore()` factory). Adding S3 is genuinely one new file plus a
branch in `libs/storage/src/index.ts:18`. Use it as the template for whatever you do to
messaging and the LLM client, both of which are still single-file and directly coupled.

**Not coupled at all** — do not waste plan budget here: `libs/db` (postgres-js, plain
Postgres), `libs/scoring` (pure functions), `libs/shared-types`, `libs/source-adapters` (all
five adapters talk to third-party HTTP APIs — Apify, YouTube, RSS, App Store, Play Store — and
need only `APIFY_API_KEY` / `YOUTUBE_API_KEY` from a secret store).

---

## 5. What will bite you

Each of these is a verified property of the current code, and each is a way the port can
silently regress something that already works.

### 5.1 `GOOGLE_CLOUD_PROJECT` is a hard boot requirement

`libs/config/src/index.ts:16` declares it `z.string()` — **not** `.optional()`. `getEnv()`
throws on a failed parse, so **every app in the monorepo refuses to start without it**, including
ones that never touch GCP. This is the first thing that will stop an AWS container from booting,
and the error (`Invalid environment: ...`) will not obviously point at it.

Do not simply delete it. `libs/config/src/index.ts` is the **single authority** on env vars
(DEVRULES — `.env.example` is documentation of it and is allowed to drift). Any change there
fans out to all five apps; enumerate the call sites.

### 5.2 Migrations apply on API startup, under an advisory lock — this is the design

`apps/api/src/migrate.ts:25` takes `pg_advisory_lock` before migrating and releases it after.
There is deliberately no `db:migrate` script, and DEVRULES forbids adding migration calls to a
worker.

This already handles concurrent boots, which is exactly the ECS/Fargate rolling-deploy scenario
the existing plan flags as "Medium risk — migration-on-startup under concurrency". **Read the
file before treating that as an open risk.** Do not "fix" it into a one-off task without a
reason that survives reading the lock.

### 5.3 Migrations are generated, never hand-written

Change `libs/db/src/schema/*.ts`, then `corepack yarn db:generate`. That emits the
`NNNN_name.sql`, its `meta/` snapshot and the `_journal.json` entry — **all three commit
together**. Never hand-author, renumber, or edit an applied migration. Keep `libs/shared-types`
in sync in the same commit series.

### 5.4 Auth is the deep change, and it has an invariant that must survive

Authorisation reads **identity-provider custom claims**, not the `users` table. That is a
project-wide hard rule, not an implementation detail.

Two specific things to carry across:

1. **`apps/api/src/lib/claims.ts` is called from inside the database transaction**, so that a
   claim-setting failure rolls the user row back. That atomicity _was_ gap #18 — a fixed defect.
   A naive Cognito port that writes the row, commits, then calls the identity provider
   **silently reintroduces it**, and no existing test will fail.
2. Cognito has no direct `setCustomUserClaims` equivalent. The realistic shapes are a
   **pre-token-generation Lambda** (the existing plan's Task 18 choice) or groups/custom
   attributes. Whichever you pick, the API's verifier at `apps/api/src/plugins/auth.ts:71`
   (`admin.auth().verifyIdToken`) becomes JWKS verification against the user pool, and
   `request.user.{role, brandEntityId, tenantId}` must end up populated identically —
   `requireBrandAccess` in that same file depends on it.

**Consider whether you need to do this at all** — see open decision §6.3.

### 5.5 `NEXT_PUBLIC_*` is inlined at build time

`apps/web` is Next.js 16. `NEXT_PUBLIC_*` values are baked into the bundle by `next build`, so
they must be **Docker build args**, not runtime env. This was gap #8 and is already solved in
`apps/web/Dockerfile`. Three of the four current vars
(`NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID}`) get replaced by Cognito equivalents;
`NEXT_PUBLIC_API_URL` stays. **Do not regress this into runtime reads** — it will appear to work
in `next dev` and fail only in the built image.

### 5.6 Never interpolate a JS `Date` into a raw drizzle `sql` fragment

House rule, and it has shipped **twice** — once in the keyset predicate, once in the `/stats`
counts. Postgres receives `Thu Jul 30 2026 15:41:17 GMT+0100 (British Summer Time)` and rejects
it at runtime. Every mocked test passed both times, because a mocked database never renders SQL.

Use typed operators embedded into the fragment:

```ts
sql`COUNT(*) FILTER (WHERE ${gte(signals.publishedAt, since)})`;
```

`apps/api/test/routes/keyset.test.ts` renders through the real `PgDialect` — that is the shape of
a test that actually catches it. Copy it for any new raw SQL.

### 5.7 Tenant scoping is manual, and moving cloud does not change that

There is no Postgres RLS. **Every query must filter on `tenant_id`**, and brand-scoped routes
must additionally check `request.user.brandEntityId`. A greenfield database is arguably the
moment to add RLS — flag it as a decision (§6.8), do not silently assume it.

### 5.8 Model IDs and region availability decay — verify live, every time

DEVRULES calls this the single most common source of confidently-wrong output in this repo, and
it has already burned this project: the shipped `gemini-2.0-flash-001` default was retired
2026-06-01, and `gemini-2.0-pro-001` never existed.

**Never write a Bedrock model ID from memory.** Confirm against
`aws bedrock list-foundation-models --region=<region>` or current vendor documentation at the
moment of use, and confirm the model is actually enabled in the account — Bedrock requires
explicit per-model access grants, which is a step that does not exist on Vertex and which the
existing plan does not call out.

### 5.9 Use Node 20

`.nvmrc` pins it; `engines` allows `>=20 <23`. On Node 24, `next build` fails with a null React
dispatcher on Next's internal `/_global-error` page — an error three layers from its cause. This
cost real time to diagnose (it was misdiagnosed as an upstream Next.js bug before being tracked
to the local runtime). `next dev` works fine on newer runtimes, which is how it stayed hidden.
CI and every Dockerfile are on Node 20.

### 5.10 There is no e2e harness

Playwright is not a dependency in any `package.json`. Browser verification is MCP-driven and
leaves no regression artefact. Adding `apps/web/e2e` is the standing fix. Until it exists, any
completion claim involving UI must describe the manual-equivalent interaction explicitly.

### 5.11 `report-worker` is a health-check skeleton

Reporting is Epic 12 and unbuilt. The existing plan already suggests dropping it rather than
paying for an idle task; on Fargate (no scale-to-zero) that cost is real and continuous. Confirm
with the owner, then leave it out of the AWS stack.

---

## 6. Open decisions — these must be settled before the implementation plan is finalised

The previous plan was written for a different decision, so several of its choices should be
re-opened rather than inherited. Do not start writing code against any of these until the owner
has ruled.

1. **Region.** The plan assumes `eu-west-2` (London) with data residency as a hard requirement.
   Confirm this still holds, and confirm every service in the design is actually available
   there — verify live, do not assume parity with the GCP `europe-west2` design.
2. **Compute.** The plan chose ECS Fargate. The GCP design's economics rested on Cloud Run
   scaling to zero (`docs/PLAN.md` costs it at "~$0, free tiers"). **Fargate does not scale to
   zero**, so five idle services become a standing monthly bill. For a system with no live users
   yet, App Runner, Lambda, or ECS with scheduled scale-down all deserve a look. This is the
   highest-value decision to revisit and it was made under the old constraint.
3. **Auth: Cognito, or keep Firebase Auth / Identity Platform?** Firebase Auth is reachable from
   anywhere — it is not an infrastructure dependency the way Cloud Run or Pub/Sub is. Keeping it
   deletes the single highest-risk phase (§5.4) and the plan's largest line item (7–10 days),
   at the cost of retaining one Google dependency and its billing relationship. If the driver
   for leaving GCP is cost, latency or consolidation, this trade may be worth taking; if it is
   "no Google services at all", it is not. **Ask the owner which it is** — the answer changes
   the plan's shape more than any other item here.
4. **Database.** RDS Postgres vs Aurora Serverless v2. Same scale-to-zero economics question as
   §6.2. Note `DB_SOCKET_PATH` exists only for the Cloud SQL proxy and simplifies away.
5. **LLM.** Bedrock model choice, and whether prompt behaviour is re-validated. The
   cross-cutover comparability problem is gone (§2), so this reduces to: does the current
   sentiment prompt in `libs/gemini` produce sane output on the chosen Claude model? That needs
   a real evaluation against real signals, not a smoke test.
6. **Keep or drop the `CLOUD_PROVIDER` abstraction.** With GCP abandoned, a factory with one
   live branch is dead code that must still be tested to clear the 80% gate. Options: (a) keep
   the interfaces, delete the GCS/Pub/Sub/Vertex implementations; (b) keep both for genuine
   portability; (c) drop the abstraction entirely. Recommend (a) — the interface has real design
   value, the unused implementation does not.
7. **`infra/` disposition.** Delete, or keep read-only as reference while `infra-aws/` is built?
   Recommend keeping until the AWS stack reaches parity, then deleting in one commit — the GCP
   modules are the clearest available specification of what each service needs.
8. **Postgres RLS.** Adopt it now on a greenfield database, or keep manual `tenant_id`
   filtering? Manual scoping has already produced one live intra-tenant hole (gap #5) and one
   near-miss (gap #12's missing tenant filter on `PATCH /admin/users/:id`). That is two defects
   of the same class in one register.
9. **`report-worker`.** Port, or omit until Epic 12? (§5.11 — recommend omit.)

---

## 7. What must not be regressed

Fifteen gaps were closed to get here, several of them security or correctness defects found by
running the system rather than by testing it. A re-platform is exactly the kind of change that
silently undoes them. Treat this as the regression checklist for the AWS work:

| #   | Property that must survive                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| 5   | Brand-scoped routes enforce `request.user.brandEntityId` via the `requireBrandAccess` preHandler. It is **opt-in per route** — nothing fails when a new one omits it, which is how `GET /brands/:id` kept the hole until 2026-08-07. Add it to every new `/brands/:id...` route. |
| 6   | Cursor pagination has a deterministic `ORDER BY` and a composite keyset predicate.                                          |
| 4   | Raw payloads are written to object storage on ingest and read back by scoring — not re-fetched from a URL.                  |
| 7   | Topic/queue names come from the environment, never from hard-coded constants outside local dev.                             |
| 9   | Worker failures are classified permanent vs transient so the DLQ actually fires. Do not swallow errors in the SQS consumer. |
| 18  | The user row and the identity-provider claim are written atomically. See §5.4, point 1.                                     |
| 12  | `PATCH /admin/users/:id` reads the target first and 404s for a foreign tenant.                                              |
| 10  | `dimension_scores` is written by the rollup; `libs/scoring` is pure and cloud-agnostic — it should need no changes at all.  |
| 8   | `NEXT_PUBLIC_*` supplied as Docker build args. See §5.5.                                                                    |
| 17  | Node 20 everywhere. See §5.9.                                                                                               |

**Note the empty-`items` class of bug too:** Fastify's `fast-json-stringify` strips any property
not declared in the response schema. `GET /brands/:id/signals` returned empty objects for
exactly this reason and no test caught it. Every new or changed route needs its response schema
checked against a real HTTP response, not a unit test.

---

## 8. How to verify anything

**The gate — required before any completion claim:**

```bash
corepack yarn lint && corepack yarn typecheck && corepack yarn test
```

`yarn test` enforces 80% coverage per project. For Terraform: `terraform fmt -check -recursive`
and `terraform validate` in the affected tree.

**Baseline, re-verified 2026-08-07:** lint green across 13 projects, typecheck green across 12,
and **297 tests green across 11 projects** — `api` 105, `source-adapters` 52, `scoring` 43,
`web` 23, `ingestion` 22, `sentiment-worker` 17, `config` 10, `storage` 9, `messaging` 9,
`gemini` 4, `report-worker` 3. (`api` was 101 until the `GET /brands/:id` brand-access fix
added four tests; the 2026-08-06 baseline at commit `b62d260` was 293.)

> **A green gate can be a hollow one — check the task count, not just the exit code.** Nx infers
> the `lint` and `test` targets from `@nx/eslint` / `@nx/vite`. If it computes its project graph
> while `node_modules` is incomplete — a fresh clone where something ran before
> `yarn install` finished — those plugins cannot load, and Nx **caches a graph with zero `lint`
> and `test` targets**. `yarn lint` then prints `No tasks were run` and **exits 0**. The whole
> gate passes having checked nothing.
>
> The tell is the summary line: it should say **13 projects** for lint, **12** for typecheck.
> The fix is `nx reset` (on Windows it reports `EPERM` on `.nx/workspace-data` while the daemon
> holds the directory, and still clears enough to work).

> **`yarn test` as scripted will look like it has hung.** It is
> `nx run-many -t test`, which defaults to running three vitest suites concurrently, each
> spawning its own worker pool and coverage instrumentation. On a cold cache that did not
> complete in **two separate 10-minute runs** here, producing no output at all — around 32 node
> processes contending. The identical work finishes in roughly two minutes with:
>
> ```bash
> corepack yarn nx run-many -t test --parallel=1 --output-style=stream
> ```
>
> Use that when you need a cold-cache result or per-project output. Plain `yarn test` is fine
> once the Nx cache is warm — it then returns in ~3s from cache. This is a local performance
> characteristic, not a failure; every project passes when actually run. Do not spend a session
> debugging it as though a test were deadlocked, and do not "fix" it by weakening the gate.
>
> **Update 2026-08-07: `--parallel=1` did not rescue it either.** On this machine that form ran
> **35+ minutes with no output and 57 node processes** before being killed. What does work,
> reliably and in well under a minute total, is driving vitest per project and skipping Nx
> orchestration entirely — `apps/api` alone is 105 tests in ~12s:
>
> ```bash
> cd apps/api && corepack yarn vitest run --coverage
> ```
>
> Do that when you need an attributable, trustworthy result. The tests themselves are fast; the
> orchestration is the problem.

> Note: bare `yarn` is not on `PATH` in this environment — it resolves through
> `corepack yarn` (Yarn 4.9.2, confirmed). Node on `PATH` here is v24; use Node 20 for anything
> that runs `next build` (§5.9).

**The local stack:**

```bash
corepack yarn dev        # Docker services + all apps; web :3000, api :8080
corepack yarn db:up      # Postgres only
corepack yarn db:seed
docker compose exec postgres psql -U project_signal_app -d project_signal
```

The Pub/Sub emulator image must be the `:emulators` tag — `cloud-sdk:slim` has no JRE and the
emulator silently never starts. If you replace Pub/Sub with SQS locally, ElasticMQ or LocalStack
is the equivalent; there is no committed setup for either yet.

**Two traps when checking a running service:** port 8080 has been found occupied by an unrelated
application on this machine (an "API is up" check hit the wrong app and was only caught because
a 403 body turned out to be an HTML SPA — always assert on the body shape, not the status code).
And `corepack yarn install` fails under `CI=1` after any `package.json` change, because that
implies `--immutable`.

**What cannot be verified locally today:** a real object-storage round trip (no GCS/S3 emulator
is committed), anything behind `AuthGate` in the web app, and every cloud primitive. This is why
§2 recommends the thin vertical slice.

---

## 9. Suggested first moves

1. **Get the owner's rulings on §6**, particularly §6.2 (compute) and §6.3 (Cognito vs Firebase
   Auth). Those two determine the plan's size and its riskiest phase. Everything else can be
   decided as you go; these cannot.
2. **Do a full analysis pass of your own** against the live code — do not inherit this document's
   findings unverified. DEVRULES' inviolable rule binds you too. The inventory in §4 was accurate
   on 2026-08-06 at commit `d57ff54`; check it still is.
3. **Rewrite the plan**, do not patch the old one. Its phase structure is organised around a
   constraint that no longer exists, and patching it will leave contradictions scattered through
   a document well over a thousand lines long. Mine it for the task-level detail — the Terraform module breakdowns and the Cognito
   task in particular are worth keeping — and supersede the rest. Re-derive the estimate.
4. **Re-base the docs in the same change as the code**, per CLAUDE.md: `ARCHITECTURE.md`
   (describes Cloud Run, Pub/Sub, Cloud SQL and Identity Platform throughout), `PLAN.md`
   (Epic status and the cost table), `SETUP.md` (15 sections of GCP-specific setup that need an
   AWS equivalent), and `KNOWN-GAPS.md` #16.
5. **Do not start the AWS build while §6 is unanswered.** The owner's standing rule is
   autonomous, uninterrupted execution once development is underway — which is precisely why the
   questions get asked _now_, upfront, rather than mid-flight.

---

## 10. Standing rules you will be held to

Summarised from `DEVRULES.md` — read the original, this is a pointer not a substitute.

- **Verify, never assume.** Every factual claim must name the file, command or query that
  produced it. This overrides everything else.
- **No fabricated columns, env vars, APIs or behaviours.** The Drizzle schema is the source of
  truth for the database; `libs/config/src/index.ts` for the environment.
- **Definition of done** is proven working end to end, to production-release standard, with the
  proof stated. Not "tests pass". Not "should work".
- **Zero technical debt.** A defect found is a defect fixed, not appended to a register.
- **Work autonomously** once underway; ask everything you need upfront.
- `commitlint` enforces a **closed scope list** in `commitlint.config.js` — new libs need their
  scope added in the same change. Current list includes `storage` and `scoring`; it does **not**
  include `llm` or anything AWS-flavoured yet.
