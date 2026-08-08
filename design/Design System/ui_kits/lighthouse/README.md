# Lighthouse — UI kit

A high-fidelity, click-through recreation of the **Lighthouse (by Tes)** customer-success app on the "Aurora" redesign. Open `index.html`.

## What's here
| File | What it is |
|---|---|
| `index.html` | The interactive app — routes between built screens; unbuilt routes show an honest placeholder. **Built entirely from the design system** (`AppShell` + screens). |
| `HomeScreen.jsx` | Hero greeting + the DS **Composer** + KPI bento + portfolio donut / at-risk list / your-day tasks. |
| `HealthScreen.jsx` | Overview/Analytics tabs, band stat cards, band-distribution panel, top-movers + entity lookup. |
| `InboxScreen.jsx` | Signal inbox — per-account digest cards with severity-graded lines + citation chips. |
| `TasksScreen.jsx` | Kanban with stat tiles, priority filter chips, and inline **Move** selects. |

## How it's wired
- The kit is built **entirely from the design system**. `index.html` wraps everything in the DS **`AppShell`** (`window.LighthouseDesignSystem_68eba0.AppShell`) and screens compose the DS primitives (Button, Badge, Card, KpiCard, PanelHeader, Tabs, Avatar, MosaicMark, Input, Select, DataTable, Composer, Icon). Nothing is re-implemented locally — the shell, sidebar, top bar, FAB, icon set and composer all live in the design system now.
- Load order in `index.html`: React → ReactDOM → Babel → `_ds_bundle.js` → (alias `window.LHIcon = DS.Icon`) → screens → app. Each screen file is an IIFE that assigns its component to `window`.
- Interactions are cosmetic/stateful only (no backend): the composer streams canned answers, tasks toggle/move, the lookup returns a fixed result, Appearance persists.

## What's intentionally omitted
Sector radar, Champion watch, Triage, Playbooks, Impact ledger, Opportunities, Meetings, Skills, Chat, Reports and the Admin routes are present in the nav but render a placeholder — their recipes live in the design guide (`../../readme.md` → "Applying the redesign"). Build them from the same primitives when needed.
