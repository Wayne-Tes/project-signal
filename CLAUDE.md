# Project Signal — Project Guidelines

## Read these first

| Document | Why |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Complete code-accurate reference — every app, lib, table, route and infra module, plus end-to-end flows and a "gotchas before you edit" section. **Read this before making changes anywhere unfamiliar.** |
| [`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md) | Pipeline links that are provisioned but not connected. **Read before debugging any end-to-end flow** — several things that look broken were never wired. |
| [`docs/PLAN.md`](docs/PLAN.md) | Design rationale, key decisions and epic status. |

Keep all three current when you change structure, and update `ARCHITECTURE.md` in the same
change as the code it describes.

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
  web/              — Next.js 16 dashboard (client-side SPA, Identity Platform auth)
  api/              — Fastify 5 REST API; owns the schema, migrates on startup
  ingestion/        — Scheduled source pull + dispatcher
  sentiment-worker/ — Pub/Sub consumer → Gemini Flash scoring
  report-worker/    — Health-check skeleton; reporting deferred
libs/
  config/          — zod-validated env loader
  db/              — Drizzle schema + postgres-js client
  gemini/          — Vertex AI client wrapper
  messaging/       — Pub/Sub client + topic constants
  shared-types/    — Cross-service contracts
  source-adapters/ — Adapter interface + 5 implementations
infra/             — Terraform: bootstrap / modules / stack / envs
```

Lib dependency order (hard-coded in `scripts/build-libs.sh`):
`config → shared-types → db → gemini → messaging → source-adapters`.

## Workspace Scripts

All top-level scripts delegate to NX. **This project uses yarn, not pnpm.**

| Script              | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `yarn dev`          | Starts Docker services + all apps in dev mode       |
| `yarn build`        | Builds all projects                                 |
| `yarn lint`         | Lints all projects                                  |
| `yarn typecheck`    | Type-checks all projects                            |
| `yarn test`         | Runs all tests (80% coverage gate, per project)     |
| `yarn db:up`        | Starts just the Postgres container                  |
| `yarn db:generate`  | Generates migration SQL from the schema (drizzle-kit) |

There is no `db:migrate` or `db:seed` script — **the API applies migrations on startup**,
guarded by a Postgres advisory lock. Never add migration calls to a worker.

## House rules that bite

- **Tenant scoping is manual.** There is no Postgres RLS; every query must filter on
  `tenant_id`. Brand-scoped routes should also check `request.user.brandEntityId`.
- **Authorisation reads Firebase custom claims**, not the `users` table. Changing a row
  without calling `setCustomUserClaims` leaves the token stale for up to an hour.
- **Style with CSS custom properties** in `apps/web` — literal hex values break the runtime
  palette switcher.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. A new scope must be
  added there or the commit is rejected.
- **`terraform apply` requires `-var="image_tag=..."`** — Terraform owns the container image.
- ESLint bans `any` and enforces `import type`. `console.log` warns; use `warn`/`error`.
