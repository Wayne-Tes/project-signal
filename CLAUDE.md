# Project Signal — Project Guidelines

## Read these first

Follow all development rules in @DEVRULES.md

| Document                                       | Why                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md)         | **Read first, in full.** Current state, what is proven vs assumed, the verified AWS account facts, the remaining phase plan, and the regression checklist. Written for an agent with no memory of how any of this came to be. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Complete code-accurate reference — every app, lib, table, route and module, plus end-to-end flows and a "gotchas before you edit" section. **Read before changing anything unfamiliar.**                     |
| [`docs/AWS-SETUP.md`](docs/AWS-SETUP.md)       | The AWS runbook and its guardrails. Phase 0 discovery is executable and read-only.                                                                                                                          |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)     | The defect register. 17 of 19 closed; **read before debugging any end-to-end flow.**                                                                                                                        |
| [`docs/PLAN.md`](docs/PLAN.md)                 | Design rationale, key decisions and epic status.                                                                                                                                                            |

Keep all of these current when you change structure, and update `ARCHITECTURE.md` in the same
change as the code it describes.

> ### The destination is AWS. Some documents still describe GCP.
>
> The system was built for GCP and **never deployed there** — the environment was abandoned and
> the owner decided (2026-08-06) to go straight to AWS. `libs/storage`, `libs/messaging` and
> `libs/llm` now run on **S3, SQS and Bedrock**; auth is the only Google dependency left.
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
  web/              — Next.js 16 dashboard (client-side SPA, Firebase auth until Cognito)
  api/              — Fastify 5 REST API; owns the schema, migrates on startup
  ingestion/        — Scheduled source pull + dispatcher
  sentiment-worker/ — scores signals via Bedrock (HTTP route today; SQS consumer is Phase 4)
  report-worker/    — Health-check skeleton; reporting deferred
libs/
  config/          — zod-validated env loader; the authority on env vars
  db/              — Drizzle schema + postgres-js client
  storage/         — ObjectStore interface + S3 implementation + factory
  scoring/         — Brand Perception Index: decay, dimensions, clustering (pure)
  llm/             — LlmClient interface + Bedrock implementation (forced tool use)
  messaging/       — MessagePublisher interface + SQS implementation
  shared-types/    — Cross-service contracts
  source-adapters/ — Adapter interface + 5 implementations
infra/             — GCP Terraform. SUPERSEDED, kept as reference only (HANDOVER.md §8)
infra-aws/         — AWS tree. Phase 0 discovery script only so far
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

> **Use Node 20.** `.nvmrc` pins it and `engines` enforces `>=20 <23`. On Node 24 `next build`
> fails with a null React dispatcher on Next's internal `/_global-error` page — a confusing
> error three layers from the cause. CI and every Dockerfile are on Node 20. `next dev` works
> on newer runtimes, which is how this stayed hidden.

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
- **Authorisation reads Firebase custom claims**, not the `users` table. Changing a row
  without calling `setCustomUserClaims` leaves the token stale for up to an hour.
- **Style with CSS custom properties** in `apps/web` — literal hex values break the runtime
  palette switcher.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. A new scope must be
  added there or the commit is rejected.
- **`terraform apply` requires `-var="image_tag=..."`** — Terraform owns the container image.
- ESLint bans `any` and enforces `import type`. `console.log` warns; use `warn`/`error`.
