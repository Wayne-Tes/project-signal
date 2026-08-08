# Implementation plan — front-end completion, help system, chat agent

**Written:** 2026-08-08
**Status:** plan only. Nothing in Phase 0 onward has been started.
**Audience:** the agent executing this end to end, autonomously, in a fresh session.

---

## 0. The defect that prompted this, and what it says about the process

**Symptom:** in light mode, tiles on Dashboard, Admin and Roadmap render black with light
text — the dark scheme, in a light shell.

**Root cause, verified:** the legacy stylesheet's `:root` hardcodes dark values
(`--surface: #14161c`, `--bg: #0b0c0f`, `--t1: #f4f3ef`) and contains **zero `data-theme`
rules**. Those tokens cannot respond to a theme. Views still consuming them therefore stay dark
whatever the shell does:

| View                              | Legacy token refs            |
| --------------------------------- | ---------------------------- |
| Dashboard                         | 18                           |
| Admin                             | 12                           |
| Roadmap                           | 3                            |
| Report                            | 0 (uses `.report-*` classes) |
| Trends, Competitors, Brand impact | 0 — migrated                 |

**Why it was reported as working.** The Playwright run visited **Brand impact**, which has zero
legacy references — the one view guaranteed to pass. Verification was performed on the happy
path and the result generalised to the whole app. Screenshotting the two views a reasonable
person would open first, Dashboard and Admin, would have caught it immediately.

**The rule this plan is built on:** a change is verified when the surfaces a user would actually
open have been looked at, in every theme the change can affect. Not when one representative
sample passes.

---

## 1. Sequencing, and why this order

Testing infrastructure comes **first**, not last. Every phase after Phase A is verified by it,
and the alternative — building three large features and verifying at the end — is how the defect
above happened at a larger scale.

```
Phase A  Playwright harness + visual verification    (nothing else is trustworthy without it)
Phase B  Finish the front-end migration              (fixes the live defect)
Phase C  Help system + knowledge base + tour         (agent depends on its content model)
Phase D  Chat agent with data + help retrieval       (largest; depends on B and C)
```

C precedes D deliberately: the agent must be able to answer "how do I use this?" from the help
corpus, so the corpus must exist and have a stable shape before the retrieval layer is written.

---

## 2. Phase A — Playwright harness

**Deliverable:** `apps/web/e2e/`, the standing fix `DEVRULES.md` has flagged since before AWS.

- `@playwright/test` as a devDependency of `apps/web`; chromium only.
- `e2e/fixtures/auth.ts` — signs in against Cognito with a seeded test user and reuses
  `storageState`, so each spec does not repeat the login.
- `e2e/visual.spec.ts` — for **every route** × **light and dark** × **light and navy sidebar**,
  assert:
  - no console errors and no page errors,
  - **no element renders a dark surface while `data-theme="light"`** (the check that would have
    caught this defect — sample computed `background-color` on cards and assert luminance is
    consistent with the active theme),
  - a screenshot is written to `e2e/__screenshots__/`.
- `e2e/a11y.spec.ts` — `@axe-core/playwright` on each route; fail on serious/critical.
- Test users are created and **deleted** by the fixture. Never leave accounts in the pool.

**Gate:** the suite runs in CI against a locally built web container, not the deployed
environment, so a broken change fails before it is deployed rather than after.

**Definition of done:** the suite fails on the current `main` (proving it detects the live
defect), and passes at the end of Phase B.

---

## 3. Phase B — finish the front-end migration

Order: **Dashboard → Admin → Roadmap → Report → BrandManager → UserManager → DrillDown →
charts**, most-broken first.

For each: rebuild on design-system primitives, remove every legacy token reference, screenshot in
all four theme combinations, fix what the screenshots show.

Then, and only then:

- Delete the legacy block from `app/globals.css` and the `.report-*` / `.heel` / `.rail` rules.
- `grep -r 'var(--\(bg\|surface\|t1\|t2\|t3\|line\|mint\|peri\|coral\)' apps/web/src` must return
  **nothing**. That grep is the completion criterion, not a judgement call.
- `apps/web/src/lib/data.ts` (588 lines of mock data for a fictional bank) is deleted once
  Roadmap and Report no longer import it — closing KNOWN-GAPS #13 and Epic 6's exit criterion.

**Charts** need their own attention: they take colours as props from `scoreColor()`. Re-point
that at the mosaic tokens so series colours are categorical brand hues rather than the old
accent palette.

---

## 4. Phase C — help system, knowledge base and tutorial

Modelled on `Market-competitor-analysis`: `packages/shared/src/help/content.ts` plus
`apps/web/src/onboarding/`.

**Content model** — copy the shape, it is well judged:

```ts
interface HelpTopic {
  id: string; // kebab-case, unique
  title: string; // sentence case, British English
  category: string; // groups the Help page sidebar
  keywords: string[]; // client-side search
  body: string; // clean markdown: headings, bold, lists. No HTML.
}
```

Authored against **verified behaviour** of this codebase — every topic states what the product
actually does. A help corpus describing intended behaviour is worse than none, because the agent
will repeat it confidently.

**Surfaces:**

- `libs/help` — the corpus, framework-free so both the API and the web app import it.
- `GET /help/topics`, `GET /help/topics/:id` on the API — the same corpus the agent retrieves
  from, so answers and the Help page can never diverge.
- A **Help** route in the web app: category sidebar, keyword search, markdown rendering.
- `HelpLauncher` — a persistent affordance in the top bar.

**Tutorial wizard** (from `onboarding/`): `TourProvider` + `TourTooltip` driving step definitions
that anchor to `data-tour` attributes, a first-run checklist, and `persistence.ts` recording
completion per user. Track which tours a user has completed **server-side** on the user record —
localStorage alone means a new device restarts the tour.

**Testing:** unit tests over search/registry/persistence; Playwright asserting the first-run tour
appears once, can be dismissed, and does not reappear.

---

## 5. Phase D — the integrated chat agent

The largest phase. Deliberately last.

**Capability** (from the reference implementations): reachable from anywhere in the platform,
with retrieval over **both** the platform's own data and the help corpus, citing its sources, and
able to work through a question with the user across turns — following data through, reasoning,
and producing an output such as a report.

**Architecture:**

- **Tool-based retrieval, not prompt-stuffing.** The agent gets a fixed set of tools that map to
  existing API routes — `list_brands`, `get_brand_score`, `get_brand_impact`, `get_signals`,
  `search_help` — and Bedrock's forced tool use selects among them. `libs/llm` already does
  forced tool use; extend it with a multi-tool loop rather than replacing it.
- **Every tool call is tenant-scoped from `request.user`, never from a model argument.** This is
  the single most important rule in the phase: a model that can name a `tenantId` is a model that
  can be talked into naming somebody else's. The tenant comes from the verified token, and the
  tool signature must make it impossible to pass one.
- **Citations are structural.** Each tool result carries its provenance (route, entity id, help
  topic id) and the response renders them as links. A citation the model composes in prose is a
  claim, not a reference.
- **Streaming** over SSE, with the assistant's turn persisted so a conversation survives a
  reload.
- Conversation history in Postgres — new tables, generated migrations, tenant-scoped like
  everything else.

**Cost and safety:** every agent turn is a Bedrock call. Add per-tenant rate limiting before this
ships, not after. `SCORER_MODEL` stays Haiku; the agent gets its own model variable so the two
can diverge without one silently re-pointing the other.

**⛔ Blocked on OWNER-ACTIONS item 1.** Anthropic models are still unavailable in the account —
every invocation fails on the use case form. Phase D can be **written and unit-tested** against a
mocked `LlmClient`, but it cannot be verified end to end until that form is submitted. Do not
report Phase D complete on mocked tests alone.

---

## 6. Testing, at every phase

| Layer       | Tool                   | Applies to                                                                     |
| ----------- | ---------------------- | ------------------------------------------------------------------------------ |
| Unit        | Vitest, 80% gate       | help search, tour persistence, agent tool schemas, citation assembly           |
| Integration | Vitest + real Postgres | agent tool handlers against seeded data, asserting **tenant scoping holds**    |
| Browser     | Playwright             | every route × 4 theme combinations, a11y, tour flow, a full agent conversation |

**Non-negotiable:** a phase is not done until its Playwright specs pass **and the screenshots
have been looked at**. Passing assertions prove the page did not error; they do not prove it
looks right.

---

## 7. Owner actions this depends on

1. **The Anthropic use case form** (OWNER-ACTIONS item 1) — blocks Phase D verification entirely.
2. Nothing else. Phases A–C are unblocked.

---

## 8. Honest scope note

This is four phases, one of which (D) is a substantial backend feature with new tables, a new
retrieval layer and a new security surface. It is **not** a single-session task, and any agent
that reports all four complete in one pass should be disbelieved and checked.

Execute in order. Commit at each phase boundary with the gate green. If a phase cannot be
finished, stop at a working state and say so — a half-migrated view that typechecks but renders
wrong is precisely the failure this plan exists to prevent.
