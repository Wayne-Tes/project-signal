# Development Rules — Project Signal

> Adapted for this repository from the cross-project original. Every path, command and tool
> named below was verified against this codebase on 2026-08-06. Where the original referenced
> another project's layout, the Project Signal equivalent has replaced it — see
> [Repository facts](#repository-facts-verified) for the mapping.

## INVIOLABLE OPERATING RULE — verify, never assume

**Paramount rule. Overrides everything else in this file and every other instruction except a direct, explicit overriding instruction from the user. Binds the main agent and every dispatched subagent.**

Wherever applicable, unless otherwise directed by the user, the agent is to work autonomously if given a task requiring multiple phases and the user expresses the desire for the agent to work uninterrupted. The agent (you) must not pause to give updates, reports, ask questions or seek user opinion once development is underway. If the user wants to ask you something they will use the `/btw` command or interrupt the flow. If you need information BEFORE starting the work, ask the user so you have everything you need upfront to accommodate an autonomous workflow. Use a mature spec-driven development approach for this, with full testing at each gate or phase. A zero technical debt policy will be enforced at all times: you find something wrong and you fix it, no deferring till later.

Before any statement, recommendation, tool call that depends on a fact, or question to the user: VERIFY by reading the actual codebase, config file, env file, git log, running grep, querying the running local stack — whatever it takes. NEVER guess, synthesize, infer, or recall from prior session memory without re-checking. This applies to "obvious" things too: syntax, file paths, dependency versions, env-var names, default values, schema columns, branch state, deploy state.

- If you're about to assert a fact, the message must include the verification step that produced it. "I read `<file>:<line>`, it says X" — not "I think X" or "X is probably the case."
- If you're about to ask the user a question, first check whether the answer is already in the repo, env files, git history, the planning docs (`docs/`), or recent conversation. If it is, use it. If not, ask one specific question — never a list of speculative options.
- This is a real, production-critical system the owner will run and depend on, then heavily modify. Bad work from confident guessing is worse than slow work from verified facts. The cost of an unverified claim, in this context, is the user's trust and time.

**Model IDs, SDK versions and cloud service availability decay.** They are the single most common source of confidently-wrong output in this repo — the shipped `gemini-2.0-flash-001` default was retired on 2026-06-01 and `gemini-2.0-pro-001` never existed. Never write a model ID, region availability claim, or API surface from memory. Verify against vendor documentation or the live API (`gcloud ai models list --region=<region>`, `aws bedrock list-foundation-models --region=<region>`) at the moment of use.

### PRODUCTION-CRITICAL DEVELOPMENT — grounded, regression-safe, zero fabrication

**Strengthens (does not replace) the inviolable rule above. Applies to ALL development, not just assertions.**

This is a production-critical, end-to-end system. Every piece of development work — schema, migrations, queries, types, routing, UI wiring, tests — MUST be grounded on investigation and confirmation of the actual code, database schema, env, and runtime behaviour.

**ABSOLUTELY NO fabricated, guessed, assumed, or synthesised data, values, columns, APIs, table names, env vars, or behaviours are permitted in development, ever.**

- Confirm every table / column / type against the **Drizzle schema** in `libs/db/src/schema/*.ts`, which is the source of truth, and against the generated SQL in `apps/api/migrations/*.sql`. When in doubt, query the live local database: `docker compose exec postgres psql -U project_signal_app -d project_signal`. Never invent or assume a column, type, or env var.
- **Env-var names come from the zod schema in `libs/config/src/index.ts`** — that is the authority, not `.env.example`, and not memory. `.env.example` and `apps/web/.env.example` are documentation of it and can drift; if they disagree, the schema wins and the example file is the bug.
- **Migrations are generated, never hand-written.** Change `libs/db/src/schema/*.ts`, then run `yarn db:generate` (→ `nx run api:generate`, drizzle-kit). This produces both the `NNNN_name.sql` file and its `meta/` snapshot plus a `_journal.json` entry — all of which must be committed together. Never hand-author a migration file, never renumber one, and never edit a migration that has been applied anywhere.
- **The API applies migrations on startup**, guarded by a Postgres advisory lock. There is no `db:migrate` script and never should be. Never add migration calls to a worker.
- Keep `libs/shared-types` in sync with any schema change **in the same commit series**.
- **NEVER apply SQL directly to a deployed database** (Cloud SQL today, RDS after the AWS migration) without explicit user confirmation.
- Perform **full regression analysis** for every change: enumerate all call sites, dependents, and flows the change touches, and verify none break. `libs/*` changes fan out to every app — check all five.
- Wire to **real services only** — no ad-hoc stubs, placeholders, or one-off synthesised fixtures standing in for real behaviour in shipped code. Sanctioned exceptions, which are documented test infrastructure rather than fabrication:
  - `vi.mock` of cloud SDKs inside unit tests (the established pattern across `libs/*/test/`).
  - The Pub/Sub emulator and Postgres container in `docker-compose.yml` for local development.
  - **`apps/web/src/lib/data.ts` is NOT a sanctioned exception.** It is 588 lines of generated mock data for a fictional bank. Four of the six analytical views now read the live API; it still renders in **Roadmap and Report**, and is still imported for constants by `App.tsx`, `charts.tsx`, `DrillDown.tsx` and `primitives.tsx`. Pre-existing debt tracked as KNOWN-GAPS #13, deferred by owner decision until AWS is running. **No new code may depend on it.**
- Verify **end-to-end against the running app**, across every surface the change affects, not just unit tests. Tests passing ≠ done.

## DEFINITION OF DONE — nothing is "complete" until proven working to production-release standard

**Paramount, alongside the inviolable rule above. Binds YOU and EVERY agent/subagent you dispatch, on every task, from now on. It overrides any urge — yours or a subagent's — to report completion early.**

A task is NOT done when the code is written, when it compiles, or when a unit test goes green. It is done ONLY when it has been rigorously proven to work, end-to-end, to the standard of code shipping to live users. Declaring "done" on anything less is a failure of the job, not a step toward it.

- **No premature completion. EVER.** Never stumble over the first passing check — or the first thing you happen to find — and declare victory. A surface-level unit test is NOT acceptable evidence of done. Exercise the real behaviour, the edge cases, the failure paths, and every surface the change touches. If you have not actually tried to break it, you are not done.
- **Production-release standard for ALL work.** Every change is held to the bar of going live: correct, regression-safe (enumerate and re-verify all call sites/dependents), wired to real data and services, and verified against the running app — never "should work" or "the suite is green, so it's done."
- **The full gate must pass, not just the tests you wrote.** Before any completion claim:
  ```bash
  yarn lint && yarn typecheck && yarn test
  ```
  `yarn test` enforces an 80% coverage gate per project. For Terraform changes, additionally: `terraform fmt -check -recursive` and `terraform validate` in the affected tree.
- **Front-end / UX / UI / user-facing work MUST be driven like a real user.** For any feature with a UI or an interactive flow, exercise it in a real browser. Start the stack with `yarn dev` (Docker services + all apps; the Next.js dashboard serves on `:3000`, the API on `:8080`), then drive it with the **Playwright MCP tools** or the **claude-in-chrome MCP tools** — confirm the MCP is actually connected before relying on it. PHYSICALLY interact with it — click, type, drag, navigate, submit, reload — and confirm it behaves exactly as a user would expect across the real flow. A green Vitest test does NOT substitute for actually using the feature; component tests are necessary, not sufficient.
  > **Known limitation:** this repo has **no committed e2e harness** — Playwright is not a dependency in any `package.json`, verified 2026-08-06. Browser verification is therefore MCP-driven and leaves no regression artefact behind. Adding `apps/web/e2e` is the standing fix; until it exists, browser verification is manual-equivalent and must be described explicitly in the completion claim.
- **Console-driven fix loop until clean.** If anything misbehaves, is uncertain, or looks off: open the **browser console** (plus the network panel and the relevant server logs — the Next.js dev server output and `docker compose logs postgres localstack`), read the ACTUAL errors, fix the root cause, and RE-TEST through the browser. Repeat until the issues are driven to zero and the console is clean. Never report an issue away, suppress it, or hand back a known-broken state.
- **The completion claim must carry its proof.** When you state a task is complete, say HOW you proved it — the exact commands run and their output, the exact interactions you performed, what you observed, and that the console/network were clean — mirroring the inviolable rule's "include the verification step." "It should work" / "tests pass, so it's done" is rejected.

Only once the feature demonstrably works as expected — through real interaction, with a clean console, to production-release standard — may the word "complete" be used.

## PROJECT-SPECIFIC HARD RULES

These are Project Signal invariants. Breaking one produces a security hole or a silent data fault, not a test failure.

- **⛔ AWS: sandbox account `290304998906` ONLY.** This repository sits inside a **TES enterprise
  AWS organisation under active scrutiny**. `tesai-dev-sandbox` / `eu-west-2` is the only account
  and region any agent, script or human may touch. **This ranks with the inviolable rule above
  and is not subject to the autonomy rule** — an agent that finds itself pointed elsewhere stops
  and reports rather than proceeding.
  - Confirm `aws sts get-caller-identity` before every session and after any credential, profile
    or role change. **Read-only counts**: a `describe`/`list` against another account in this
    organisation is still unauthorised access to it.
  - Never add a provider alias, `assume_role`, or profile reaching another account. Never remove
    or widen `allowed_account_ids` in `infra-aws/*/versions.tf`.
  - Never touch Organizations, SCPs, root-level IAM or billing. The account-wide budget
    `monthly_tesai-dev-sandbox` is **read-only to us**.
  - Enforced by `infra-aws/scripts/_guard.sh`, sourced by every script that calls AWS; its
    wrong-account and no-credential aborts are both tested. **Any new script must source it.**
  - If credentials resolve anywhere else: **stop, change nothing, tell the owner.**

- **Tenant scoping is manual.** There is no Postgres RLS. Every query MUST filter on `tenant_id`. Brand-scoped routes MUST additionally check `request.user.brandEntityId`. Note that `apps/api/src/routes/signals.ts` currently does _not_ — that is KNOWN-GAPS #5, an open intra-tenant isolation hole. Do not copy that pattern.
- **Authorisation reads identity-provider custom claims, not the `users` table.** Changing a row without also updating the claim leaves the token stale for up to an hour. Any role change must go through the claim-setting path.
- **Never interpolate a JS `Date` into a raw drizzle `sql` fragment.** It bypasses the
  timestamptz serialiser and Postgres receives `Thu Jul 30 2026 15:41:17 GMT+0100 (British
Summer Time)`, which it rejects at runtime. Use the typed operators (`gte`, `lt`, …) and embed
  _those_ into the fragment: ``sql`COUNT(*) FILTER (WHERE ${gte(signals.publishedAt, since)})` ``.
  This has been shipped twice — once in the keyset predicate, once in the stats counts — and
  both times every mocked test passed, because a mocked database never renders the SQL. See
  `apps/api/test/routes/keyset.test.ts` for the shape of a test that does catch it.
- **Style `apps/web` with CSS custom properties.** Literal hex values break the runtime palette switcher.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. A new scope must be added there in the same change, or the commit is rejected by the `commit-msg` hook.
- **Terraform owns the container image.** `terraform apply` requires `-var="image_tag=..."` — there is no default, deliberately, so a local apply cannot silently roll images back.
- **Never enable Nx Cloud.** No `nx-cloud`, no `nxCloudAccessToken`, no `NX_CLOUD_*`, no `@nx/nx-cloud` package.
- **This project uses Yarn 4, not npm and not pnpm.** There is no `pnpm-workspace.yaml`.
- **ESLint bans `any` and enforces `import type`.** `console.log` warns — use `warn`/`error`.

## Repository facts (verified)

Verified 2026-08-06 by reading the files named. Re-verify rather than trusting this table if it looks stale.

| Concern                | Project Signal reality                                             | Verified in                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Schema source of truth | Drizzle TS schema                                                  | `libs/db/src/schema/*.ts`            |
| Migrations             | drizzle-kit generated, `NNNN_name.sql` + `meta/` + `_journal.json` | `apps/api/migrations/`               |
| Migration application  | API on startup, advisory-locked                                    | `apps/api/src/migrate.ts`            |
| Env-var authority      | zod schema                                                         | `libs/config/src/index.ts`           |
| Shared types           | `libs/shared-types`                                                | `package.json` workspaces            |
| Local services         | `postgres`, `localstack` (S3 + SQS)                                | `docker-compose.yml`                 |
| Planning docs          | `docs/`                                                            | repo root                            |
| Web framework          | Next.js 16 + React 19 (App Router)                                 | `apps/web/package.json`              |
| Test runner            | Vitest 2, 80% coverage gate                                        | `package.json`, `*/vitest.config.ts` |
| E2E harness            | **none — Playwright is not a dependency**                          | no match in any `package.json`       |
| Package manager        | Yarn 4.9.2                                                         | `package.json` `packageManager`      |

## Standing conflicts to resolve

Recorded here rather than silently ignored, because each is a live tension between this file and the repo as it stands. The zero-technical-debt rule means these are decisions to make, not items to defer indefinitely.

1. ~~**Zero technical debt vs. `docs/KNOWN-GAPS.md`.**~~ **Resolved 2026-08-06 by the owner: KNOWN-GAPS is the backlog and is burned down before new work.** It is not a sanctioned exception to the zero-debt rule; a newly discovered defect is fixed on the spot rather than appended to the register. Two gaps are closed by architectural decision rather than by a change (#3, Cloud Tasks), because paying down debt on a platform being left is waste, not rigour.

   **Amended 2026-08-07 by the owner.** The original wording blocked *all* new work — including the AWS migration — while any item remained open, which was unworkable: **#16 is the AWS work itself**, **#12's UI is blocked _on_ AWS**, and **#13's Roadmap is unspecified product work** that cannot be burned down without a product decision. #19 was closed first at the owner's direction; #13 and #12 are deferred until AWS is running. So the rule now reads: **burn down what is actionable and unblocked; #16 proceeds regardless.**
2. **Autonomous, uninterrupted execution vs. plan review checkpoints.** `docs/superpowers/plans/2026-08-06-aws-migration.md` prescribes review between tasks. This file forbids pausing once development is underway. For that plan, the autonomous rule wins unless the user says otherwise: run phases end-to-end, gate on the full `lint && typecheck && test` suite at each phase boundary, and report only at phase boundaries.
3. **Wire to real services only vs. two dashboard views on mock data.** Four of six views now read the live API; `apps/web/src/lib/data.ts` survives for **Roadmap and Report** only. Deferred by owner decision (2026-08-07) until AWS is running. KNOWN-GAPS #13; Epic 6's exit criterion is the file's deletion.
