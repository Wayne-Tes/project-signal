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

Credentials are **never committed**. The e2e user is created per environment.

```bash
# Against a local dev server
yarn dev                                    # in another terminal
E2E_EMAIL=... E2E_PASSWORD=... yarn workspace @project-signal/web e2e

# Against a deployed environment
E2E_BASE_URL=http://<alb-dns> E2E_EMAIL=... E2E_PASSWORD=... \
  yarn workspace @project-signal/web e2e
```

On a machine without Playwright browsers installed (this includes the Windows dev host), use the
container runner, which pins the browser build to the package version:

```bash
E2E_BASE_URL=... E2E_EMAIL=... E2E_PASSWORD=... bash apps/web/e2e/run-docker.sh
```

`E2E_BASE_URL` defaults to `http://localhost:3000` and the config starts `yarn dev` itself when
pointed at localhost. It deliberately does **not** default to a deployed URL: a suite that
silently drives a shared environment is one careless flag away from writing to it.

## What is covered

| Spec             | Guards                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| `theme.spec.ts`  | The black-tiles regression — light theme paints light surfaces on every view, dark theme survives, and switching repaints without a reload |
| `shell.spec.ts`  | Every control removed by the shell migration and restored (`docs/STUBS.md`), the accent reaching the active nav item, sidebar collapse, and a clean console across all seven views |
| `help.spec.ts`   | The help centre, its search, and the first-run tutorial wizard                |
| `chat.spec.ts`   | The assistant dock: asking a question, receiving a grounded answer, and citations that resolve to real records |
| `feeds.spec.ts` | Several feeds of one source type at once (the silent-overwrite regression), Reddit as a type, per-feed rename and remove, and the drill-down stacked numbered steps |
| `products.spec.ts` | Brand and product management: an Edit control a person can actually see, the create → rename → delete round trip against a real database, and the delete refusal that protects collected signals |
| `drilldown.spec.ts` | The disconnect between a dimension's signal count and its evidence — every dimension the index counts must lead somewhere, drilled into the **best-scoring** one first because that is the only one the defect showed on |

## Conventions

- **Assert on computed values, not on class names.** A class name assertion passes while the
  rule behind it is broken; that is exactly how the black tiles survived.
- **Luminance, not exact hex.** `helpers.ts` compares relative luminance so a palette re-tune
  does not force a test rewrite. Tests that need rewriting on every design tweak get deleted.
- **Drive real controls.** `presetAppearance` writes localStorage only where the preference must
  exist *before* first paint; everything else clicks the actual UI.
- **A new test must be seen red.** A regression test written after the fix, that has never
  failed, asserts nothing. Break the fix, watch it fail, then restore it.
