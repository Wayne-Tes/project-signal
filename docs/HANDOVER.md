# Handover — read this first

**Written:** 2026-08-07
**Audience:** the next agent, in a fresh repository, with no memory of how any of this came to be.
**Status:** authoritative on current state. Where this disagrees with any other document, this wins.

You are picking up a system that is **code-complete on AWS libraries, verified end to end
locally, and not yet deployed anywhere.** This document tells you what exists, what is proven,
what is assumed, and what to do next. Read it in full before writing code.

Then read, in order: [`../DEVRULES.md`](../DEVRULES.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`KNOWN-GAPS.md`](KNOWN-GAPS.md),
[`AWS-SETUP.md`](AWS-SETUP.md).

---

## 0. If you are reading this in a newly created repository

This codebase was developed in a personal GitHub repo and moved into an enterprise one by
export. Several things are therefore **stale by construction** and must be fixed before CI can
work. None of them are subtle, but all of them fail confusingly if missed:

| What | Where | Why it breaks |
| ---- | ----- | ------------- |
| Git remote / repo name | `.git/config` | Everything below keys off it |
| `github_repository` | `infra/bootstrap/variables.tf` | Currently `LokimotiveUK/project-signal`. The GCP WIF provider pins tokens to that exact string. GCP is abandoned, so this only matters if you keep `infra/` at all — see §8 |
| GitHub OIDC trust policy | not yet written (Phase 6) | The IAM role's trust policy will name `repo:<org>/<repo>:*`. Get the new path right first time |
| Branch protection / environments | GitHub settings | `ci.yml` runs on `main` and `staging`; `deploy-staging.yml` triggers on a **`staging` branch that does not exist** — see §9 |
| Commit history | — | If the export dropped history, the reasoning behind changes lives *only* in these docs. Treat them as the record |

**Everything verified below was verified in AWS account `290304998906` (`tesai-dev-sandbox`).
If the enterprise account is a different one, every account-specific fact in §3 is unverified
again** — model availability, IAM permissions, quotas, the lot. Re-run the discovery script
(§3.5). It is read-only and takes two minutes. Do not carry these values forward on faith; that
is precisely the failure mode DEVRULES exists to prevent.

---

## 1. What this system is

An **agency-managed, multi-tenant brand-intelligence SaaS**. It ingests public brand signals
(Google/App Store/Play reviews, YouTube comments, RSS), scores each with an LLM for sentiment
across five fixed dimensions — **trust, quality, service, value, experience** — and surfaces a
composite Brand Perception Index, an "Achilles Heel" weakness ranking, and competitor
benchmarking.

One `tenant` per customer. A tenant owns `brand_entities` (its own brands, plus competitors it
tracks). Users are `owner` / `admin` / `user`, with `user` optionally pinned to one brand.

**Isolation is enforced in application code, not by the database.** There is no Postgres RLS.
Every query filters `tenant_id`; brand-scoped routes additionally carry the `requireBrandAccess`
preHandler. This has produced two real security defects already (see §7) and is the single most
important invariant to preserve.

---

## 2. The decision history, briefly

You need this because half the repo still describes GCP and you will otherwise assume that is
current.

1. The system was built for **GCP** — Cloud Run, Cloud SQL, Pub/Sub, GCS, Vertex AI, Identity
   Platform — by a contractor. Terraform for all of it exists in `infra/`.
2. That environment was **abandoned at handover** and every reference to it stripped. No GCP
   project was ever created by this team. **The system has never run in any cloud.**
3. **2026-08-06, owner decision:** do not stand up GCP at all. Go straight to AWS. A migration
   plan written before that decision survives at
   `docs/superpowers/plans/2026-08-06-aws-migration.md`, marked superseded — mine it for
   task-level detail, do not execute it.
4. **2026-08-07 (this session):** AWS discovery completed against a live account, and the three
   cloud-coupled libraries ported. That is where you are joining.

**Consequence to internalise:** `infra/`, and parts of `PLAN.md` and `SETUP.md`, accurately
describe a deployment that will never be built. They are kept because the GCP stack is the
clearest available specification of what each service needs. Do not treat them as the plan.

---

## 3. AWS: what was verified, and how

All of this was executed live on **2026-08-07** via CloudShell. Commands and outputs are
reproducible; the discovery script in §3.5 re-runs them.

### 3.1 Account and identity

```
Account   290304998906  (alias: tesai-dev-sandbox)
Principal arn:aws:sts::290304998906:assumed-role/AWSReservedSSO_TesAiDevSandboxAdmin_.../Wayne.Strydom@tes.com
Region    eu-west-2 (London)
```

Access is via **IAM Identity Center (SSO)**, so the working credential is a temporary session
role. Two consequences: sessions expire (CloudShell refreshes automatically), and **this role
cannot be reused for CI** — GitHub Actions needs its own IAM role.

### 3.2 The account is shared — this shapes the design

`tesai-dev-sandbox` hosts several projects. The owner has full control inside it but **cannot
create accounts outside it.** So the design goal is not "make it work", it is **"make it
separable later"**. Concretely:

- Every resource named `psignal-<env>-*`. Nothing generic, nothing that could collide.
- **Our own VPC.** There is no default VPC in `eu-west-2` (verified: `describe-vpcs` returns
  nothing), so there is no CIDR to collide with and no shared default to land in by accident.
- Mandatory tags on everything, applied as Terraform defaults so a resource *cannot* be created
  without them: `Project`, `Owner`, `CostCentre`, `Environment`, `ManagedBy=terraform`,
  `Expires`.
- **Activate those as cost allocation tags in Billing.** Without that, spend is not attributable
  and Fargate's continuous billing becomes an argument nobody can settle.
- IAM roles scoped by resource tag, so a bug in this system cannot reach another project's data.

Done properly, lifting Project Signal into a dedicated account later is a `terraform apply`
against a new account id, not a rewrite. **That is the highest-value property to protect and it
costs nothing now.**

**Two shared-account risks tagging does not solve.** Say them out loud rather than discovering
them: **service quotas are account-wide** (Fargate task limits, Bedrock TPM, VPC count — another
project's load test can throttle us and vice versa), and **Bedrock model access is account-wide**
(enabling a model is additive and harmless, but it is a change others see — do it deliberately,
not silently).

### 3.3 Existing state in the account

| Fact | Value | Why it matters |
| ---- | ----- | -------------- |
| VPCs in `eu-west-2` | **none**, not even a default | We create our own, no collisions. Region caps at 5 |
| OIDC providers | **`gitlab.com` only** | GitHub's does not exist — we can create it. **An account allows only one provider per URL**, so if one appears later, reference it rather than creating a duplicate |
| Budgets | `monthly_tesai-dev-sandbox` (account-wide) | Do not touch it. Add a **tag-filtered** budget for this project alongside |
| Spend at time of survey | ~$44 month-to-date, ~$182 forecast, both rising | Not compute (there are no VPCs) — most likely Bedrock. **Our Fargate tasks would be the first persistent compute spend in the account** |

The presence of a `gitlab.com` OIDC provider suggests the department's CI standard is GitLab
while this repo is on GitHub. **Owner has confirmed: stay on GitHub.** Phase 6 therefore creates
GitHub's OIDC provider in the account.

### 3.4 Bedrock — verified working, and the ID is not obvious

```
$ aws bedrock-runtime converse --region eu-west-2 \
    --model-id eu.anthropic.claude-haiku-4-5-20251001-v1:0 \
    --messages '[{"role":"user","content":[{"text":"Reply with exactly: OK"}]}]'
→ "OK"   16 tokens   752 ms
```

**Three properties of that model id are load-bearing.** Get any of them wrong and it fails in a
way the error does not explain:

1. **It is an inference profile, not a model id.** The bare
   `anthropic.claude-haiku-4-5-20251001-v1:0` is rejected with *"Invocation of model ID … with
   on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference
   profile."* Newer models are profile-only.
2. **`eu.` scopes routing to the EU.** Verified via `get-inference-profile`: it routes to
   `eu-west-2, eu-west-1, eu-west-3, eu-central-1, eu-north-1, eu-south-1, eu-south-2`.
   `global.` profiles also exist for the same models and route anywhere. **Note this is EU, not
   UK** — worth confirming against your residency requirement, though what crosses a border is
   public review text, not personal data. Storage, database and queues stay in `eu-west-2`
   regardless; the profile governs inference only.
3. **Model availability decays and is account-specific.** This project has already shipped a
   retired model id (`gemini-2.0-flash-001`) and one that never existed
   (`gemini-2.0-pro-001`). **Never write a model id from memory.** Re-run
   `aws bedrock list-inference-profiles` in the target account.

`REPORTER_MODEL` is deliberately left on Haiku rather than upgraded to something stronger:
nothing reads it until Epic 12, and shipping an unverified default is exactly how the two bad
Gemini ids got in.

### 3.5 IAM — role creation is permitted

Probed for real, because the IAM policy simulator does not reliably account for
Service Control Policies:

```
aws iam create-role --role-name psignal-probe-delete-me --tags ... \
  --assume-role-policy-document '{"...":"Effect":"Deny"...}'   → succeeded
aws iam delete-role --role-name psignal-probe-delete-me        → succeeded
```

Role creation and tagging both work; no SCP blocks them. **CI can therefore use GitHub OIDC →
IAM role with no long-lived keys** — the direct equivalent of the Workload Identity Federation
design the GCP side used.

**To re-verify all of the above in a different account**, run
[`infra-aws/scripts/00-discover.sh`](../infra-aws/scripts/00-discover.sh). It is read-only apart
from one explicitly fenced, self-cleaning IAM probe behind `--test-iam`.

---

## 4. What the code looks like now

### 4.1 The three library ports are done

| Library | Was | Is | Notes |
| ------- | --- | -- | ----- |
| `libs/storage` | GCS | **S3** (`@aws-sdk/client-s3`) | Was already split types/impl/factory, so this was one file plus a factory line |
| `libs/messaging` | Pub/Sub | **SQS** (`@aws-sdk/client-sqs`) | Publish side only — see §5 |
| `libs/gemini` → **`libs/llm`** | Vertex AI | **Bedrock** (`@aws-sdk/client-bedrock-runtime`) | Renamed by use case, not provider |

**There is deliberately no `CLOUD_PROVIDER` switch.** GCP was never provisioned and is
abandoned, so a factory with one live branch would be dead code that still had to clear the 80%
coverage gate. The *interfaces* were kept — they are what made each swap a single-file change —
and the GCP implementations were deleted, not parked.

**All three take `AWS_ENDPOINT_URL` when set**, which points them at LocalStack, and nothing
otherwise, so the SDK's default chain resolves the real endpoint. Credentials and region always
come from that chain — the ECS task role in a deployed environment. **No code holds a key.**

### 4.2 The scoring rewrite is a correctness change, not a port

The Gemini scorer asked for "ONLY valid JSON", stripped ` ```json ` fences, and called
`JSON.parse`. When a model wrapped its answer in a sentence, that raised `PermanentScoringError`
— **which acks the message.** The signal was dropped permanently and silently.

The Bedrock client uses **forced tool use**: the model is given exactly one tool whose input
schema *is* the shape we want, with `toolChoice` forcing it, so the provider returns a parsed
object. The fence-stripper and the `JSON.parse` are gone. **That failure class no longer
exists** — it is not handled, it is absent.

If you change `libs/llm`, preserve that property. Reintroducing prose-then-parse reintroduces
silent data loss.

### 4.3 Config is the authority on environment

`libs/config/src/index.ts` is the single source of truth for env vars — **not** `.env.example`,
which is documentation of it and is allowed to drift. Notable current state:

- `GOOGLE_CLOUD_PROJECT` is now **optional**. It was required, which meant *every app in the
  monorepo refused to boot without it*, including the four that never touched GCP. That would
  have been the first thing to stop an AWS container, with an error naming the variable but not
  the reason. It is still read by `firebase-admin` in `apps/api`; delete the line in the same
  change that removes the last firebase import.
- `ITEM_QUEUE_URL` / `REPORT_QUEUE_URL` have **no defaults and throw when unset**. An SQS URL
  embeds the account id and region, so no constant could stand in for one. This is the AWS form
  of the fix for gap #7, where publishing to a hardcoded topic that existed in no environment
  failed silently.
- `SCORER_MODEL` / `REPORTER_MODEL` default to the verified inference profile (§3.4).
- `DB_SOCKET_PATH` still exists and is Cloud-SQL-proxy-only. **It simplifies away on RDS** —
  delete it when the database lands.

### 4.4 Auth is still Firebase — the only remaining Google dependency

Five files: `apps/api/src/plugins/auth.ts`, `apps/api/src/lib/claims.ts`,
`apps/api/scripts/bootstrap-owner.ts`, `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/auth.tsx`.

This is Phase 5 and it is the deepest change in the plan. **The invariant that must survive:**
`setUserClaims()` is called **inside the database transaction** that writes the `users` row, so
a claims failure rolls the row back. That atomicity was a fixed defect (gap #18). A Cognito port
that writes the row, commits, then calls the identity provider **silently reintroduces it, and
no existing test will fail.**

Authorisation reads **identity-provider custom claims, not the `users` table**. Whatever
replaces Firebase must populate `request.user.{role, tenantId, brandEntityId}` identically —
`requireRole` and `requireBrandAccess` both depend on it.

---

## 5. What is proven, and what is not

Be precise about this, because the distinction is where projects lie to themselves.

### Proven end to end, against real services (2026-08-07, local, LocalStack + Postgres)

| Step | Evidence |
| ---- | -------- |
| Ingest 52 items from the live BBC RSS feed | `{"signalsCreated":52,"signalsPublished":52}` |
| Raw payloads → S3 | 52 objects, correct `tenant/brand/source/externalId` key layout |
| Read back out of S3 | Real article text recovered |
| Publish → SQS | 52 messages, body is a bare signal UUID |
| DB rows | 52, all carrying `s3://…` refs |
| Dedup | Identical re-run created **0** |
| Reconcile sweep | Found all 52 unscored, re-published |
| Rollup | `{"brands":4,"rows":0}` — correct, nothing scored yet |
| Logs | Zero error-level lines, no 5xx |

**This mattered.** There was never a GCS emulator, so `libs/storage`'s write path had only ever
met a mock and gap #4 was closed on faith. The reconcile sweep had never run against a real
queue. Both work.

### NOT proven — do not claim otherwise

- **Nothing has run in any cloud.** Not one line.
- **Scoring has never executed against a real model.** Local LocalStack does not emulate
  Bedrock. The `converse` smoke test proves the *account and model* work; it does not prove
  `libs/llm` + `scorer.ts` produce a usable `sentiment_results` row. **That is the single most
  valuable thing for you to prove first.**
- **The SQS consumer does not exist.** `libs/messaging` covers the **publish** side only.
  `apps/sentiment-worker` still serves an HTTP route at `POST /pubsub/item` shaped like a
  Pub/Sub push envelope. Push→pull is a real model change, not a driver swap, and it is Phase 4.
- **Everything behind `AuthGate` has never been seen rendered.** That includes 63 of the 79 CSS
  token conversions done this session. A browser pass is a required checkpoint once sign-in
  works, not an optional follow-up.
- **No Terraform for AWS exists** beyond the discovery script.

---

## 6. The remaining plan

Locked decisions (owner, 2026-08-06/07): **ECS Fargate** compute, **Cognito** auth, **RDS
Postgres single instance**, **`eu-west-2`**, **GitHub** CI.

| Phase | Work | Needs the account? |
| ----- | ---- | ------------------ |
| ~~0~~ | ~~Discovery~~ | ✅ **done** — §3 |
| ~~B~~ | ~~Port libraries behind interfaces~~ | ✅ **done** — §4.1 |
| **1** | **Guardrails: tag defaults, name prefix, tag-filtered budget, teardown script** | Yes — **do this first, before anything billable** |
| 2 | Foundation: VPC, RDS, S3, ECR, Secrets Manager | Yes |
| 3 | **Thin vertical slice** — one brand, one RSS feed, one signal, ingest → score → read | Yes |
| 4 | Full stack: Fargate services, SQS + DLQs, EventBridge Scheduler, **the SQS consumer** | Yes |
| 5 | Cognito, then the browser pass over views nobody has ever seen | Yes |
| 6 | CI/CD: GitHub OIDC → IAM role | Yes |
| 7 | Delete `infra/` and the last Google dependencies | No |

**Phase 3 is deliberately early and you should resist the urge to defer it.** The superseded
plan put the first true end-to-end run at Phase 5 of 7. That is indefensible when nothing has
ever executed in a cloud: the first real run is the highest-information moment in the whole
project, and everything built before it rests on assumptions.

**Fix gap #3 during Phase 4.** `/ingest/dispatch` fans out in-process via `Promise.allSettled`.
SQS was supposed to dissolve that gap — it only does if the dispatcher actually enqueues per
`(brand × source)`. Two properties outlive the choice of queue: a dispatch across many brands
runs inside one HTTP request and can exceed the platform timeout, and a failed source is counted
in `failed` and dropped rather than retried.

**Cost reality:** Fargate does not scale to zero. The GCP costing (~$13–15/mo) rested entirely
on Cloud Run doing so. Five idle services bill continuously, in an account whose spend is
already visible to others. The budget alarm in Phase 1 is not ceremony.

---

## 7. What must not be regressed

Fifteen defects were closed to reach this point, several found by running the system rather than
testing it. A re-platform is exactly the change that silently undoes them.

| Property | Note |
| -------- | ---- |
| Brand-scoped routes enforce `brandEntityId` | Via `requireBrandAccess`. **It is opt-in per route and nothing fails when a new route omits it** — that is how `GET /brands/:id` kept the hole until 2026-08-07. Add it to every new `/brands/:id...` route |
| User row and identity-provider claim are atomic | §4.4. The Cognito trap |
| `PATCH /admin/users/:id` reads the target first and 404s for a foreign tenant | Not confirming a row's existence is deliberate |
| Cursor pagination has deterministic `ORDER BY` + composite keyset | `(published_at, id)`; neither is a stable sort key alone |
| Raw payloads written to object storage **before** the row insert | So `raw_storage_ref` can never point at a missing object |
| Queue/topic names come from the environment, never a constant | Gap #7 |
| Worker failures classified permanent vs transient | So the DLQ can fire. **Do not swallow errors in the SQS consumer** |
| `dimension_scores` written by the rollup; `libs/scoring` stays pure | It needs no AWS changes at all |
| `NEXT_PUBLIC_*` supplied as Docker **build args** | Inlined by `next build`; a runtime env var can never reach the client |
| Node 20 everywhere | On Node 24, `next build` fails with a null React dispatcher three layers from the cause |

Two traps that are not defects but have each cost real time:

- **Never interpolate a JS `Date` into a raw drizzle `sql` fragment.** It bypasses the
  timestamptz serialiser and Postgres rejects the value at runtime. Shipped twice; every mocked
  test passed both times because a mocked database never renders SQL. Copy
  `apps/api/test/routes/keyset.test.ts`, which renders through the real `PgDialect`.
- **Fastify strips undeclared response fields.** `fast-json-stringify` silently removes any
  property the response schema does not declare. `GET /brands/:id/signals` returned
  `items: [{}, {}]` for exactly this reason and no unit test caught it.

---

## 8. Repository disposition

- **`infra/`** — the GCP Terraform. Keep read-only until `infra-aws/` reaches parity, then
  delete in one commit. It is the clearest available specification of what each service needs
  and re-deriving it from prose would be wasteful. It will never be applied.
- **`docs/superpowers/plans/2026-08-06-aws-migration.md`** — superseded, marked as such. Mine
  the Terraform module breakdowns and the Cognito task; do not execute the phase order.
- **`docs/SETUP.md`** — GCP setup, superseded, banner at the top. Kept for the same reason as
  `infra/`.
- **`apps/web/src/lib/data.ts`** — 588 lines of mock data for a fictional bank, still rendering
  in the Roadmap and Report views. Deferred by owner decision until AWS is running. **No new
  code may depend on it.**

---

## 9. How to verify anything

**The gate, required before any completion claim:**

```bash
corepack yarn lint && corepack yarn typecheck && corepack yarn test
```

**Baseline, verified 2026-08-07:** lint green across **13 projects**, typecheck across **12**,
**309 tests across 11 projects** — api 105, source-adapters 52, scoring 43, web 23, ingestion 22,
sentiment-worker 15, storage 13, messaging 12, config 11, llm 10, report-worker 3.
(`@project-signal/db` has only a `build` target, hence 13/12/11.)

> ### ⚠️ A green gate can be a hollow one — check the task count, not the exit code
>
> Nx infers `lint` and `test` targets from `@nx/eslint` / `@nx/vite`. If it computes its project
> graph while `node_modules` is incomplete — a fresh clone where something ran before
> `yarn install` finished — those plugins cannot load and **Nx caches a graph with zero `lint`
> and `test` targets.** `yarn lint` then prints `No tasks were run` and **exits 0**. The entire
> gate passes having checked nothing.
>
> The tell is the summary line: **13 projects** for lint, **12** for typecheck. The fix is
> `nx reset` (on Windows it reports `EPERM` on `.nx/workspace-data` while the daemon holds the
> directory, and still clears enough to work).

> ### ⚠️ `nx run-many -t test` is unreliable here
>
> Documented as finishing in ~2 minutes with `--parallel=1`. On this machine it ran **35+
> minutes with no output and 57 node processes** before being killed. What works, reliably and
> in well under a minute total, is driving vitest per project and skipping Nx orchestration:
>
> ```bash
> cd apps/api && corepack yarn vitest run --coverage    # 105 tests, ~12s
> ```
>
> The tests are fast; the orchestration is the problem. Do not "fix" this by weakening the gate.

**The local stack** — this is how the end-to-end run in §5 was performed:

```bash
docker compose up -d                 # Postgres 16 (:5432) + LocalStack (:4566, s3+sqs)
cp .env.example .env
corepack yarn nx run api:dev         # MIGRATIONS APPLY ON API STARTUP — boot this before seeding
corepack yarn db:seed
corepack yarn nx run ingestion:dev
curl -X POST localhost:8081/ingest -H 'Content-Type: application/json' \
     -d '{"sourceConfigId":"<the rss one>"}'
```

`scripts/localstack-init.sh` creates the bucket, both queues and both DLQs on boot, with
`maxReceiveCount: 5` matching the intended deployed redrive policy — so the local stack fails
the same way the real one will.

**Three environment traps that have each burned time here:**

- **`yarn` is not on `PATH`** in this environment; it resolves through `corepack yarn` (Yarn
  4.9.2). Node on `PATH` may be v24 — fine for tests, **fatal for `next build`** (gap #17). Build
  the web app in Docker (`node:20-alpine`) if your host Node is newer.
- **Port 5432 and 8080 have both been found occupied** by unrelated applications on a developer
  machine. Always assert on the **body shape** of a health check, not the status code — an
  "API is up" check once hit a different app entirely and was only caught because a 403 body
  turned out to be an HTML SPA.
- **`corepack yarn install` fails under `CI=1`** after any `package.json` change, because that
  implies `--immutable`.

---

## 10. Open questions for the owner

Not blocking Phase 1, but needed before the resources they govern are created:

1. **Cost centre code** to tag with, and whether `Environment` should be `dev` or `sandbox`.
   These go into Terraform defaults so no resource can be created without them.
2. **Is the enterprise AWS account the same as `290304998906`?** If not, re-run discovery (§3.5)
   before designing anything.
3. **EU-wide inference acceptable?** §3.4 — the `eu.` profile routes across seven EU regions,
   not London alone. The data crossing a border is public review text.
4. **`report-worker`:** it is a health-check skeleton and Epic 12 is unbuilt. On Fargate it
   would be a permanently-running task doing nothing. **Recommend omitting it from the AWS stack**
   until Epic 12, adding it back as a one-file change.
5. **Postgres RLS.** A greenfield database is the moment to decide. Manual `tenant_id` scoping
   has already produced one live intra-tenant hole and one near-miss — two defects of the same
   class in one register.

---

## 11. Standing rules you will be held to

Summarised from [`DEVRULES.md`](../DEVRULES.md) — read the original; this is a pointer.

- **Verify, never assume.** Every factual claim names the file, command or query that produced
  it. This overrides everything else in this repo, including this document.
- **No fabricated columns, env vars, APIs or behaviours.** The Drizzle schema in
  `libs/db/src/schema/*.ts` is the source of truth for the database; `libs/config/src/index.ts`
  for the environment.
- **Model ids and cloud service availability decay.** They are the single most common source of
  confidently-wrong output in this repo. Verify against the live API at the moment of use.
- **Definition of done** is proven working end to end, to production-release standard, with the
  proof stated. Not "tests pass". Not "should work".
- **Zero technical debt.** A defect found is a defect fixed, not appended to a register.
- **Work autonomously** once underway; ask everything you need upfront.
- **Migrations are generated, never hand-written.** Edit `libs/db/src/schema/*.ts`, run
  `corepack yarn db:generate`; the `.sql`, the `meta/` snapshot and the `_journal.json` entry all
  commit together. Never edit an applied migration.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. It currently includes
  `llm` and `storage`; a new lib needs its scope added in the same change or the commit is
  rejected by the hook.
