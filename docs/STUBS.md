# Stubs and unfinished controls

**Purpose.** Every control that is visible in the product but not fully implemented, recorded
here rather than removed. A control removed unilaterally is a decision the person who owns the
product never got to make; a control left visible and undocumented is a trap. This file is the
third option.

**Rule:** nothing is deleted from the UI because it looks incomplete. It is stubbed, marked
here, and the owner decides.

**Written:** 2026-08-08, after the shell migration removed several working controls without
recording that it had done so.

---

## 1. Export button — stub, never implemented

**Where:** top bar, all views except Report.

**State:** rendered, **disabled**, with a tooltip saying so. It has never had a handler — not in
the current code and not in the prototype it came from. The original was enabled and did
nothing at all when clicked, which is worse than disabled.

**To finish:** decide what Export produces — CSV of signals, JSON of the current view's data, or
a PDF like the Report view. `GET /brands/:id/signals` already paginates, so a CSV export is the
smallest real implementation.

---

## 2. Dashboard hero style — restored, working

**Where:** Appearance popover → "Dashboard hero".

**State:** working. `Dashboard` accepts a `hero` prop and switches between the radial gauge and
bars. This was lost when the Tweaks panel was deleted and the Dashboard was left hardcoded to the
gauge; it is now a persisted preference.

---

## 3. Period label — reads mock data

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

## 4. Typeface pairing — restored, but conflicts with the design system

**Where:** Appearance popover → "Typeface".

**State:** working. Four pairings, overriding `--font-display` / `--font-body` at the root.

**The conflict:** the Aurora design system mandates Poppins + Open Sans as the house style,
specifically so every Tes product looks like one family. A user-facing typeface switcher works
against that. The prototype's other three pairings are retained because deleting a working
control was not this layer's decision to take.

**Owner decision needed:** keep it as a personalisation option, or remove it and hold the house
typeface. If it stays, "House (Poppins + Open Sans)" remains the default.

---

## 5. Animations toggle — restored, working

**Where:** Appearance popover → "Animations".

**State:** working. Sets `data-animate` on the root, which gates every `.ds-enter` entrance.

**Deliberately independent of `prefers-reduced-motion`.** That media query is honoured separately
in `tokens/animations.css` and a user turning animations back **on** does not override it — a
preference must not defeat an accessibility setting.

---

## 6. Views still on legacy markup

`Dashboard`, `Admin`, `Roadmap`, `Report`, `BrandManager`, `UserManager`, `DrillDown` and the
charts still use the legacy stylesheet. Its `:root` hardcodes dark values and contains no
`data-theme` rules, so **these surfaces render dark regardless of the chosen theme** — the black
tiles reported in light mode.

Tracked as Phase B of [`PLAN-frontend-agent-help.md`](PLAN-frontend-agent-help.md), with a grep
as the completion criterion.
