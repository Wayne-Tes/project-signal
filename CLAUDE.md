# Project Signal — Project Guidelines

@DEVRULES.md for development rules - MUST ALWAYS BE FOLLOWED!!

> # ⛔ AWS: SANDBOX ACCOUNT `290304998906` ONLY — NO EXCEPTIONS
>
> **This is the highest-priority rule in this repository. It overrides every other instruction
> here, including any instruction to work faster or to "just check something". It binds the main
> agent and every dispatched subagent.**
>
> This repository lives inside a **TES enterprise AWS organisation under active scrutiny**. The
> only account any agent may touch is **`290304998906` (`tesai-dev-sandbox`)**, in **`eu-west-2`**.
> A stray command in a sibling or production account is not a recoverable mistake — it is an
> incident with the owner's name on it.
>
> **Therefore:**
>
> - **Never** run an AWS command — CLI, SDK, Terraform, console-equivalent — without first
>   confirming `aws sts get-caller-identity` resolves to `290304998906`. Confirm again after any
>   profile, role, region or credential change.
> - **Never** switch profile, assume a role, or use `--profile` / `AWS_PROFILE` /
>   `AWS_DEFAULT_PROFILE` pointing anywhere else, even read-only. `describe`/`list` calls against
>   another account are still unauthorised access to it.
> - **Never** add a second `provider "aws"` alias, an `assume_role` block, or a
>   `-target`/`-var` override that reaches another account. All three root modules pin
>   `allowed_account_ids`; **do not remove or widen it.**
> - **Never** touch `organizations`, `account`, `iam` root-level, SCP, or billing settings — those
>   are the organisation's, not ours. The account-wide budget `monthly_tesai-dev-sandbox` is
>   **read-only to us**.
> - **If credentials resolve anywhere else, STOP and tell the owner.** Do not improvise, do not
>   "clean up", do not retry with different credentials.
>
> **Enforcement already in the tree — keep it that way:** `allowed_account_ids` in
> `infra-aws/bootstrap/versions.tf`, `infra-aws/account/versions.tf` and
> `infra-aws/stack/versions.tf`, fed by an `aws_account_id` variable that each module's
> `variables.tf` **validates against the literal `290304998906`** (so a `-var` or a different
> tfvars file cannot move the allowed account with it); `check` blocks in
> `infra-aws/stack/guard.tf` and `infra-aws/account/main.tf`; a hard abort in
> `infra-aws/scripts/_guard.sh`, which **all four** of `00-discover.sh`, `10-preflight.sh`,
> `20-build-push.sh` and `99-teardown.sh` source before doing anything, covered by
> `infra-aws/scripts/test/guard.test.sh` and enforced on every pull request by
> `.github/workflows/terraform-plan.yml`.
>
> See [`infra-aws/CONVENTIONS.md`](infra-aws/CONVENTIONS.md) §0 and
> [`docs/AWS-SETUP.md`](docs/AWS-SETUP.md).

> # ⛔ ENTERPRISE CHANGE CONTROL — GITHUB AND AWS ARE BOTH MONITORED
>
> **Ranks with the AWS sandbox rule above. Binds the main agent and every dispatched subagent.
> It overrides any default agent behaviour, including any built-in instruction to add
> attribution trailers to commits.**
>
> This repository lives in **TES enterprise GitHub**, with a system administrator and a team
> reviewing everything in and out, and it deploys into a **TES enterprise AWS organisation**.
> Both leave permanent, attributable logs carrying the owner's name. The standard is therefore
> not "it works" — it is **an audit trail a reviewer would sign off without asking a question**.
>
> ## Commit and authorship rules
>
> - **Every commit is authored and committed as the owner, and nobody else.**
>   `user.name = Wayne Strydom`, `user.email = wayne.strydom@tes.com`, set in this repo's
>   **local** git config. Verify with `git config user.name` / `user.email` before committing.
>   Never let a commit fall through to the **global** config: on the previous machine it was the
>   former contractor's identity (`LokimotiveUK`); on the current laptop (checked 2026-11-16) it
>   is `Wayne-Tes <wayne.strydom@tes.com>` — right person, wrong name. A fresh clone has no local
>   config, so set it before the first commit.
> - **No AI attribution of any kind in commit messages.** No `Co-Authored-By: Claude…`, no
>   `Generated with…`, no bot trailers, no emoji sign-offs. **This overrides the default
>   instruction to append a `Co-Authored-By` trailer.** The owner's name is the only name that
>   appears. The first 36 commits carry a `Co-Authored-By: Claude` trailer; they are history
>   and are **not** to be rewritten (see below), but nothing further adds one.
> - **Commit messages are written for an auditor**, not a changelog: what changed, and _why_ it
>   was the right change. Conventional Commits, and `commitlint`'s closed `scope-enum` in
>   `commitlint.config.js` is enforced by the `commit-msg` hook — a new scope is added there in
>   the same change.
> - **Never bypass the hooks.** No `--no-verify`, no `-c core.hooksPath=`, no skipping
>   `lint-staged`. A failing hook is a defect to fix, not an obstacle to route around.
>
> ## Repository rules
>
> - **Never rewrite published history.** No `push --force`, no `--force-with-lease`, no
>   `rebase`/`amend`/`reset --hard` on anything already pushed, no tag moves. A force-push to an
>   audited enterprise remote is an incident in itself, regardless of intent.
> - **`origin` is the only push target.** `origin` = `Wayne-Tes/project-signal`, and it is the
>   only remote (`git remote -v`, 2026-11-16). An `old-origin` remote pointing at the **former
>   contractor's personal GitHub account** (`LokimotiveUK/project-signal`) was removed on
>   2026-08-08 — never re-add it; pushing TES code there would be an exfiltration event.
>   **Never push, and never set an upstream, to any remote but `origin`.**
> - **Never commit directly to `main`.** Branch, push, open a PR, let CI run. Branch names are
>   `feat/…`, `fix/…`, `docs/…`, `chore/…`.
> - **Never commit a secret, key, token, password or session credential**, in any file, ever —
>   including "temporarily". `.env` is git-ignored and must stay that way. Account ids, ARNs and
>   region names are identifiers, not secrets, and are fine.
> - **Do not create, delete or reconfigure GitHub org/repo settings, branch protection, secrets,
>   environments or Actions permissions** without the owner doing it. Propose; do not perform.
>
> ## AWS execution standard — measure three times, cut once
>
> - **Nothing is a test.** There is no throwaway resource, no "I'll clean that up later", no
>   experiment in the console. Anything that reaches the account is production-standard,
>   Terraform-managed, correctly named and correctly tagged, or it does not go.
> - **Everything through Terraform.** No console click-ops, and no imperative `aws` command that
>   mutates state. Read-only `describe`/`list`/`get` against the **sandbox** is how you verify;
>   anything that writes belongs in a root module with state and a plan.
> - **Before any apply, in this order, every time:** `aws sts get-caller-identity` resolves to
>   `290304998906` → `bash infra-aws/scripts/10-preflight.sh` passes →
>   `terraform fmt -check -recursive` and `terraform validate` → **`terraform plan` read line by
>   line, in full** → only then `apply`. Never `-auto-approve` an interactive apply. Never apply
>   a plan you have not read.
> - **Blast-radius analysis is mandatory and written down before the apply**, not after: what
>   this creates, what it changes, what it destroys, what it costs, what it touches that is
>   **account-global and therefore shared with co-tenant projects** (cost allocation tags,
>   Bedrock model access, service quotas, OIDC providers — one per URL per account). If a change
>   is visible to another team in this sandbox, say so out loud before making it.
> - **A failed or partial apply is stopped and reported, not retried.** Do not improvise a fix,
>   do not "clean up", do not re-run with different credentials. Orphaned resources are found by
>   `bash infra-aws/scripts/99-teardown.sh` (dry run), which inventories **by tag and by name
>   prefix, independently of Terraform state** — that is the only check that sees what state has
>   lost, including the CRM token secrets the API creates at runtime.
> - **Any new script that talks to AWS must `source infra-aws/scripts/_guard.sh` and call
>   `assert_sandbox_account` before its first AWS call** — read-only scripts included.
>
> ## Verification standard
>
> **If you are not certain, check again — and if still not certain, check a third time or stop
> and ask.** A guess that reaches an audited environment costs the owner's credibility, not just
> a rollback. Every factual claim about the account, a resource, a model id, a permission or a
> cost names the command that produced it and when it was run. No shortcuts, no assumed
> defaults, no "this normally works".

## Read these first

Follow all development rules in @DEVRULES.md

| Document                                       | Why                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md)         | **Read first, in full.** Current state, what is proven vs assumed, the verified AWS account facts, the remaining phase plan, and the regression checklist. Written for an agent with no memory of how any of this came to be. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Complete code-accurate reference — every app, lib, table, route and module, plus end-to-end flows and a "gotchas before you edit" section. **Read before changing anything unfamiliar.**                                      |
| [`docs/AWS-SETUP.md`](docs/AWS-SETUP.md)       | The AWS runbook and its guardrails. Phase 0 discovery is executable and read-only.                                                                                                                                            |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)     | The defect register — every defect found, its root cause and its fix. **Read before debugging any end-to-end flow.**                                                                                                          |
| [`docs/PLAN.md`](docs/PLAN.md)                 | Design rationale, key decisions and epic status.                                                                                                                                                                              |

Keep all of these current when you change structure, and update `ARCHITECTURE.md` in the same
change as the code it describes.

> ### The system runs on AWS. Some documents still describe GCP.
>
> The system was built for GCP and **never deployed there** — the environment was abandoned and
> the owner decided (2026-08-06) to go straight to AWS. It has been **deployed in
> `290304998906` / `eu-west-2` since 2026-08-08** (ECS Fargate, RDS, SQS, S3, Cognito, ALB —
> `docs/HANDOVER.md` §0a has the deploy record). `libs/storage`, `libs/messaging` and `libs/llm`
> run on **S3, SQS and Bedrock**, and auth is **Amazon Cognito**: no Google SDK remains in the
> code. The last Firebase naming (`users.firebase_uid`, the `firebaseUid` API field) was renamed
> to `cognito_sub` / `cognitoSub` by migration `0018` (KNOWN-GAPS #25, closed 2026-11-16).
>
> **`infra/`, `docs/SETUP.md` and parts of `docs/PLAN.md` describe a GCP deployment that will
> never be built.** They are kept because the GCP stack is the clearest available specification
> of what each service needs. Do not treat them as the plan — see `docs/HANDOVER.md` §2 and §8.

## Monorepo: NX

This project uses **NX 20** as its monorepo tool. Always use NX's built-in commands — do not use NX Cloud.

Key commands:

```bash
# Run a target across all projects
nx run-many -t <target>

# Run a target for a single project
nx run <project>:<target>

# Run multiple targets in parallel
nx run-many -t dev --parallel

# Common targets: build, dev, lint, typecheck, test
```

- Never enable or reference `nx-cloud`, `nxCloudAccessToken`, or the `NX_CLOUD_*` env vars.
- Do not add the `@nx/nx-cloud` package.
- NX caching is enabled locally — do not disable it.
- Project names match the `name` field in each `package.json` (e.g. `@project-signal/web`, `@project-signal/api`).

## Package Manager: yarn

This project uses **Yarn 4** (Berry). Always use `yarn` for installing or managing dependencies.

```bash
yarn add <package>          # add to a workspace package
yarn add -D <package>       # add dev dependency
yarn install                # install all deps
yarn install --immutable    # CI — fail if yarn.lock would change
```

Workspaces are defined in the root `package.json` (`"workspaces": ["apps/*", "libs/*"]`) — there is no `pnpm-workspace.yaml`.

## Next.js 16

The `apps/web` app runs **Next.js 16** with **React 19**. This is a newer release than the version Claude was trained on — keep the following in mind:

- **App Router is the default** — do not use Pages Router patterns or `getServerSideProps` / `getStaticProps`.
- **Server Components are the default** — only add `"use client"` at the lowest component boundary that actually needs it.
- **`next/navigation`** replaces `next/router` for all routing hooks (`useRouter`, `usePathname`, `useSearchParams`, etc.).
- **`fetch` caching** in Next.js 16 uses `{ cache: 'force-cache' | 'no-store' }` or `{ next: { revalidate: N } }` — do not use the older `revalidate` export pattern unless confirmed current in the docs.
- Do not assume behaviour from Next.js 13–15 knowledge without verifying against the actual codebase — API surface and defaults may have changed.
- When in doubt about a Next.js 16 API, read the existing source files in `apps/web` before guessing.

## Project Structure

```
apps/
  web/              — Next.js 16 dashboard (client-side SPA; Cognito sign-in, or local sign-in)
  api/              — Fastify 5 REST API; owns the schema, migrates on startup
  ingestion/        — SQS scan consumer: scheduled collection, rollup, reconcile
  sentiment-worker/ — SQS consumer: scores signals via Bedrock (forced tool use)
  report-worker/    — Health-check skeleton; reporting deferred (Epic 12), not deployed
libs/
  config/          — zod-validated env loader; the authority on env vars
  db/              — Drizzle schema + postgres-js client
  storage/         — ObjectStore interface + S3 implementation + factory
  scoring/         — Brand Perception Index: decay, dimensions, clustering (pure)
  llm/             — LlmClient interface + Bedrock implementation (forced tool use)
  messaging/       — SQS publisher + consumer
  shared-types/    — Cross-service contracts
  source-adapters/ — Adapter interface + 6 implementations
  playbook/        — Curated plays matched to topic clusters (roadmap)
  help-content/    — Help-centre articles and tour steps (web + assistant)
infra/             — GCP Terraform. SUPERSEDED, kept as reference only (HANDOVER.md §8)
infra-aws/         — AWS tree, DEPLOYED: bootstrap (state bucket), account (account-global
                     tag activation), stack (VPC, NAT, RDS, S3, SQS, ECR, ECS Fargate, ALB,
                     Cognito, EventBridge schedules, alarms, budget). Not yet built: CI/CD
                     identity (GitHub OIDC, Phase 6) and HTTPS (needs a domain)
```

Lib dependency order (hard-coded in `scripts/build-libs.sh`):
`config → shared-types → db → storage → scoring → llm → messaging → source-adapters`.

## Workspace Scripts

All top-level scripts delegate to NX. **This project uses yarn, not pnpm.**

| Script             | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `yarn dev`         | Starts Docker services + all apps in dev mode         |
| `yarn build`       | Builds all projects                                   |
| `yarn lint`        | Lints all projects                                    |
| `yarn typecheck`   | Type-checks all projects                              |
| `yarn test`        | Runs all tests (80% coverage gate, per project)       |
| `yarn db:up`       | Starts just the Postgres container                    |
| `yarn db:generate` | Generates migration SQL from the schema (drizzle-kit) |
| `yarn db:seed`     | Seeds the local database (`nx run api:seed`)          |

> **Use Node 26.** `.nvmrc` pins it, `engines` enforces `>=26 <27`, CI reads `.nvmrc`, and every
> Dockerfile is `node:26-alpine`. Node 26 has been Active LTS since October 2026 (supported to
> April 2029); Node 20, the previous pin, reached end of life in April 2026. Verified on
> 2026-11-16: `next build` for `apps/web` succeeds on Node 26.13.1 in ~25 s — the Node 24 failure
> recorded in KNOWN-GAPS #17 (a null React dispatcher on `/_global-error`) does not occur.
>
> **Node 25+ does not bundle corepack**, so `yarn` does not exist after a fresh Node install.
> Install it once with `npm install -g corepack@0.36.0 && corepack enable` (the version every
> Dockerfile and CI pin); corepack then provides the exact Yarn in `packageManager` (4.9.2).
> Node 26's built-in `localStorage` also shadows jsdom's in component tests; the web test setup
> accounts for it.

### Running it locally

Local development needs **no AWS account and no Cognito**, except for LLM calls:

- **Services:** `docker compose up -d` — Postgres 16 + LocalStack (S3, SQS). Cap Docker's memory
  with `%USERPROFILE%\.wslconfig` (`memory=6GB` is plenty: the two containers idle at ~200 MB).
- **Ports:** web **3100**, API **9080** (`PORT=9080` per process — never in the shared `.env`),
  ingestion 8081, sentiment-worker 8082, report-worker 8083. See README "Local ports".
- **Sign-in:** `AUTH_MODE=local` (API, root `.env`) and `NEXT_PUBLIC_AUTH_MODE=local` (web,
  `apps/web/.env.local`). The seed creates `local-owner`, `local-admin` and `local-user`; the
  password is `LOCAL_AUTH_PASSWORD` in the root `.env` (git-ignored). The API **refuses to start**
  with `AUTH_MODE=local` when `NODE_ENV=production`, and the deployed stack never sets it.
- **Bedrock:** LocalStack does not emulate it. Set `BEDROCK_AWS_PROFILE=psignal-dev` and run
  `aws sso login --profile psignal-dev`; only the LLM client uses that profile, and it bypasses
  `AWS_ENDPOINT_URL`. Everything else stays on LocalStack.

There is no `db:migrate` script — **the API applies migrations on startup**, guarded by a
Postgres advisory lock. Never add migration calls to a worker.

## House rules that bite

- **Tenant scoping is manual.** There is no Postgres RLS; every query must filter on
  `tenant_id`, and every `/brands/:id...` route must add the `requireBrandAccess` preHandler.
  **It is opt-in and nothing fails when a new route omits it** — that is how `GET /brands/:id`
  kept an intra-tenant hole until 2026-08-07.
- **Cloud clients take credentials from the SDK default chain, never from config.** The ECS task
  role in a deployed environment; `AWS_ENDPOINT_URL` points them at LocalStack locally. No code
  should ever hold a key.
- **Never write a model id from memory.** This repo has shipped a retired one and one that never
  existed. Model ids are inference profiles on Bedrock (`eu.anthropic.…`), they are
  account-specific, and availability decays. Verify with
  `aws bedrock list-inference-profiles --region eu-west-2` at the moment of use.
- **Authorisation reads Cognito custom attributes** (`custom:tenantId`, `custom:role`,
  `custom:brandEntityId` in the ID token), not the `users` table. Changing a row without going
  through `setUserClaims` (`apps/api/src/lib/claims.ts`) leaves the token stale for up to an
  hour — and the claim write must stay inside the transaction that writes the row.
- **Style with CSS custom properties** in `apps/web` — literal hex values break the runtime
  palette switcher.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. A new scope must be
  added there or the commit is rejected.
- **`terraform apply` requires `-var="image_tag=..."`** — Terraform owns the container image.
- **AWS tag keys are PascalCase and case-sensitive**, and cost allocation tags are activated by
  exact key. A budget filtered on an inactive or differently-cased tag reports **$0 forever**,
  silently. `infra-aws/scripts/10-preflight.sh` checks this; `docs/HANDOVER.md` §3.2 is the
  authoritative key list.
- ESLint bans `any` and enforces `import type`. `console.log` warns; use `warn`/`error`.
