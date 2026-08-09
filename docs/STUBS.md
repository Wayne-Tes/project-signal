# Stubs and unfinished controls

**Purpose.** Every control that is visible in the product but not fully implemented, recorded
here rather than removed. A control removed unilaterally is a decision the person who owns the
product never got to make; a control left visible and undocumented is a trap. This file is the
third option.

**Rule:** nothing is deleted from the UI because it looks incomplete. It is stubbed, marked
here, and the owner decides.

**Written:** 2026-08-08, after the shell migration removed several working controls without
recording that it had done so. **Last reviewed:** 2026-08-09.

---

## Open

### 1. Export button — stub, never implemented

**Where:** top bar, all views except Report.

**State:** rendered, **disabled**, with a tooltip saying so. It has never had a handler — not in
the current code and not in the prototype it came from. The original was enabled and did
nothing at all when clicked, which is worse than disabled.

**To finish:** decide what Export produces — CSV of signals, JSON of the current view's data, or
a PDF like the Report view. `GET /brands/:id/signals` already paginates, so a CSV export is the
smallest real implementation.

---

### 2. Period label — reads mock data

**Where:** top bar, left of the role badge.

**State:** renders `PS_BRAND.period` from `apps/web/src/lib/data.ts` — the prototype's fictional
bank fixture. The value is a plausible-looking reporting window that **corresponds to nothing**.

**Why it is still here:** removing it silently is exactly the failure this file exists to record.
It is marked instead.

**To finish:** the API exposes no reporting window. Either derive it from the
`dimension_scores` date range already returned by `GET /brands/:id/dimension-scores`, or drop the
label deliberately. **It must not survive the deletion of `lib/data.ts`** (KNOWN-GAPS #13) — that
deletion is blocked on this decision.

---

### 3. Views still on legacy markup

`Dashboard`, `Admin`, `Roadmap`, `Report`, `BrandManager`, `UserManager`, `DrillDown` and the
charts still use the legacy class names in `app/globals.css` rather than design-system
components.

**This is no longer a visual defect.** The legacy palette was repointed onto design-system
semantic tokens on 2026-08-09, so these views theme correctly in both light and dark, and the
user's chosen highlight colour now reaches them. What remains is that they use bespoke classes
instead of `Card`, `DataTable` and the rest — a consistency and maintenance cost, not a bug the
user can see.

Covered by `apps/web/e2e/theme.spec.ts`, which asserts no surface paints dark in the light theme
on any view.

---

### 4. Sources modelled but not collecting

**Where:** Admin → Manage brand → Sources.

**State:** `trustpilot`, `news_api`, `x` and `survey` are accepted throughout — the type union,
the schema and the UI all handle them — but **no collector runs for them**. Configuring one
records intent and produces no signals, with no warning anywhere.

Documented for users in the help centre (`available-sources`), which states plainly which five
sources actually collect. That is honest, but the UI itself still offers all nine without
distinction.

**To finish:** either implement the adapters, or mark the non-collecting options in the Admin
select so the product does not silently accept a configuration it cannot honour.

---

## Closed

### ~~Dashboard hero style~~ — restored and working

Appearance → "Dashboard hero". `Dashboard` accepts a `hero` prop and switches between the radial
gauge and bars. Lost when the Tweaks panel was deleted; now a persisted preference.

### ~~Typeface pairing~~ — kept, by owner decision

Appearance → "Typeface". Four pairings, overriding `--font-display` / `--font-body` at the root.

It is in tension with the Aurora design system, which mandates Poppins + Open Sans as the house
style so every Tes product looks like one family. **The owner decided on 2026-08-09 to keep it as
a personalisation option**, with House as the default. Recorded as a decision rather than left as
an open question.

### ~~Animations toggle~~ — restored and working

Appearance → "Animations". Sets `data-animate` on the root, gating every `.ds-enter` entrance.

Deliberately independent of `prefers-reduced-motion`: that media query is honoured separately in
`tokens/animations.css`, and a user turning animations back **on** does not override it. A
preference must not defeat an accessibility setting.

### ~~Help system~~ — implemented 2026-08-09

`libs/help-content` (18 articles), the help centre panel, contextual per-view help, and a
first-run tour. Article integrity — dead cross-references, duplicate slugs, and the scoring
constants the prose quotes — is enforced by tests against `libs/scoring`.

### ~~In-product assistant~~ — implemented 2026-08-09

Read-only, tenant-scoped, with citations derived from what was actually fetched rather than from
what the model claims. See `apps/api/src/assistant/tools.ts` for why it re-enters the API's own
routes instead of querying the database.
