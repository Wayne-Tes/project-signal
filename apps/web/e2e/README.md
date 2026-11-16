# End-to-end tests

The repository's browser harness. It exists because `DEVRULES.md` requires front-end work to be
driven like a real user and recorded that there was **no committed e2e harness**, so every visual
verification was manual and left no regression artefact behind.

That gap had a cost. The light theme painted black cards on eight views; the entire unit suite
passed, because the components, the tokens and `resolveTheme` were all individually correct. The
only wrong thing was the colour actually painted — which nothing rendered and read back. These
tests render the app and assert on **computed styles**, which is the only way that class of defect
is caught automatically.

## Running

Two targets, two sign-in modes. Credentials are **never committed**.

**Local (the default).** The web app on `:3100` and the API on `:9080`, both running on the host,
signing in with the API's local-development sign-in (`AUTH_MODE=local` in the root `.env`,
`NEXT_PUBLIC_AUTH_MODE=local` in `apps/web/.env.local`). The seeded test accounts are
`local-owner`, `local-admin` and `local-user`; their shared password is `LOCAL_AUTH_PASSWORD` in the
root `.env` (git-ignored).

```bash
# Browsers are not installed on the Windows dev host; the container runner pins them.
E2E_USERNAME=local-owner E2E_PASSWORD=<LOCAL_AUTH_PASSWORD> bash apps/web/e2e/run-docker.sh
```

Inside the container, `localhost:3100` and `localhost:9080` are forwarded to the host
(`e2e/port-forward.mjs`), because the bundle calls the API at the `localhost` URL inlined at build
time. Override the ports with `E2E_FORWARD_PORTS="3100 9080"`.

**Deployed (Cognito).** A dedicated e2e user in the pool, never a personal account:

```bash
E2E_BASE_URL=http://<alb-dns> E2E_EMAIL=... E2E_PASSWORD=... bash apps/web/e2e/run-docker.sh
```

`E2E_BASE_URL` defaults to `http://localhost:3100`, matching `next dev --port 3100`. It
deliberately does **not** default to a deployed URL: a suite that silently drives a shared
environment is one careless flag away from writing to it. `E2E_AUTH_MODE=local|cognito` forces the
mode; otherwise `E2E_USERNAME` implies local and `E2E_EMAIL` implies Cognito.

## What is covered

| Spec                        | Guards                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme.spec.ts`             | The black-tiles regression — light theme paints light surfaces on every view, dark theme survives, and switching repaints without a reload                                              |
| `theme-persistence.spec.ts` | Appearance choices survive a reload and apply before first paint                                                                                                                        |
| `shell.spec.ts`             | Every control removed by the shell migration and restored (`docs/STUBS.md`), the accent reaching the active nav item, sidebar collapse, and a clean console across the views            |
| `help.spec.ts`              | The help centre, its search, and the first-run tutorial wizard                                                                                                                          |
| `chat.spec.ts`              | The assistant dock: asking a question, receiving a grounded answer, and citations that resolve to real records (needs Bedrock)                                                          |
| `workspace.spec.ts`         | The Documentation and Assistant pages: contents, search, article tables, saved conversations                                                                                            |
| `feeds.spec.ts`             | Several feeds of one source type at once (the silent-overwrite regression), Reddit as a type, per-feed rename and remove, and the drill-down stacked numbered steps                     |
| `products.spec.ts`          | Brand and product management: a visible Edit control, the create → rename → delete round trip against a real database, and the delete refusal that protects collected signals           |
| `drilldown.spec.ts`         | Every dimension the index counts must lead to evidence, drilled into the **best-scoring** one first because that is the only one the defect showed on                                   |
| `roadmap.spec.ts`           | The plan: headline, ceilings stated as ceilings, plays with honest evidence notes, the explicit "Read the signals" control, and citations that open without also opening the drill-down |
| `whats-changed.spec.ts`     | Collected vs published bases, signed deltas that never print a fabricated `+0`                                                                                                          |
| `voice-of-customer.spec.ts` | The CRM channel's own view, kept out of the index, and its time windows                                                                                                                 |
| `users.spec.ts`             | The role model: `owner` is never offered, the brand pin defaults to none, refusals are shown                                                                                            |
| `views.spec.ts`             | Trends, Brand impact, Competitors and the Weekly report: no error, no fabricated zero, no heading inside a button, no invented trend arrow; the brand switcher and its persistence      |
| `territory.spec.ts`         | The territory lens reaching Competitors and the drill-down's dimension signals, read from the actual requests                                                                           |
| `link-safety.spec.ts`       | No rendered `href` is anything but http(s) — over the shell and the drill-down's scraped source links                                                                                   |
| `local-auth.spec.ts`        | Local sign-in: labelled as local, refuses a wrong password, survives a reload, signs out, and a rejected session returns to sign-in (skipped against Cognito)                           |

Specs that need data they cannot create (a scored brand, a second territory, a cited play)
`test.skip` with the reason. A skip is reported, never counted as a pass — read the summary.

## Conventions

- **Assert on computed values, not on class names.** A class name assertion passes while the
  rule behind it is broken; that is exactly how the black tiles survived.
- **Luminance, not exact hex.** `helpers.ts` compares relative luminance so a palette re-tune
  does not force a test rewrite. Tests that need rewriting on every design tweak get deleted.
- **Drive real controls.** `presetAppearance` writes localStorage only where the preference must
  exist _before_ first paint; everything else clicks the actual UI.
- **A new test must be seen red.** A regression test written after the fix, that has never
  failed, asserts nothing. Break the fix, watch it fail, then restore it.
