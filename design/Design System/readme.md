# Lighthouse Design System

The brand and product design system for **Lighthouse (by Tes)** — a customer-success command centre for the Tes education platform. Lighthouse unifies CRM, account health, behaviour-data signals (from Tes products such as Class Charts) and AI playbooks so customer-success teams can spot at-risk schools early and act before renewal.

This is the **"Aurora" redesign** of the product: white-led, airy, data-rich and AI-first, built on the existing Tes brand (Poppins + Open Sans, navy/slate chrome, blue-for-data, lime-for-positive, the eight-colour brand mosaic). The old app was flat, grey and dated; the redesign keeps the brand but makes the product feel like one confident, modern system.

> **British English throughout** ("behaviour", "personalise", "whilst"). **No emoji** in product UI.

## Sources this system was built from
A design-handoff package and two approved prototypes from a previous project (read-only; stored here in case the reader has access):
- `design_handoff_lighthouse_redesign/` — `README.md`, `DESIGN_SYSTEM.md` (the visual contract), `APPLYING_THE_REDESIGN.md` (page-by-page recipes for all ~23 routes), `tokens/tokens.css`, and `reference/` (the approved Home + Health prototypes, plus the original Tes Design System token CSS).
- The editable prototypes `Lighthouse Home.dc.html` and `Lighthouse Health.dc.html`.
- These were derived from Tes.com and Tes Class Charts product surfaces. The brand mosaic mark was **recreated from screenshots** — swap for the official Tes vector when available.

No live Figma or repository URL was provided; everything here is reconstructed from the handoff and prototypes.

---

## CONTENT FUNDAMENTALS — how Lighthouse writes

- **Voice:** calm, expert, action-oriented — a knowledgeable colleague, not a marketer. It surfaces signals and proposes the next move ("Shall I open a retention playbook for Riverside?").
- **Person:** addresses the user as **you** ("Here's what's moving across your portfolio"); the assistant refers to itself as **Lighthouse**, occasionally "I" when proposing an action. Possessive framing is common: "Your dashboard", "Your day", "in your scope".
- **Casing:** **Sentence case** for headings, buttons and labels ("Add metric", "Request erasure", "Band distribution") — never Title Case. **UPPERCASE** is reserved for small eyebrow labels and kanban column headers ("CRITICAL ACCOUNTS", "TO DO (18)"), letter-spaced.
- **British English:** "behaviour", "personalise", "whilst", "licence", DD/MM/YYYY dates ("19/06/2026"), "£" for money.
- **Numbers carry meaning, honestly.** Figures are specific ("16 of 30 accounts", "health score of 38 (▼12)", "7,173 requests"). Fractions render as figure + lighter denominator ("16/30"). Never invent precision.
- **Honest empty states.** Say what's true: "No meetings in your scope", "Transitions appear after the second daily compute — no history yet." No cheerful fluff.
- **Tone of the assistant:** concise, grounded in the data it cites, always offering a concrete next step. It never over-promises or uses exclamation marks.
- **No emoji, ever**, in product UI. Personality comes from weight contrast, the mosaic mark and the lime accent.
- **Specimen copy:** greeting "Good evening, Admin"; subtitle "Here's what's moving across your portfolio. Ask anything, or jump into a signal below."; composer placeholder "Ask Lighthouse… (@ to mention an account)".

---

## VISUAL FOUNDATIONS

**Overall vibe.** White-led and airy. App background is a faint wash (`--app-bg` `#f7f8fa`); content sits in white cards with hairline borders and soft shadows. Colour is *earned*, never decorative. Confidence comes from big Poppins extra-bold headings and metric figures against quiet body text.

**Colour.**
- Chrome is navy/slate: ink `#222633` (headings), navy `#2A2F3D` (primary buttons, dark caps), slate `#424A60`.
- Two accents do the semantic work: **blue `#2B7DC4`** = data, links, info; **lime `#9FCB3B` / lime-deep `#84AB28`** = positive, reward, active.
- The **eight-colour mosaic** (`#6B4E9E #3E4A9E #2B7DC4 #3FB6A8 #5FB573 #E8843C #C9275E #F2C13D`) is categorical/decorative only — KPI accent bars, category chips, avatars, the brand mark. Never use a mosaic hue as a status.
- **Status map:** positive = lime-deep, info = blue, warn = orange `#B5611F`, critical = magenta `#C9275E`, neutral = grey, teal = `#247f76`. **Health bands:** healthy green, attention orange, critical magenta, unscored grey. Always pair colour with a word/glyph — never colour alone.

**Type.** Display = **Poppins** (extra-bold 800 for hero/section/metric, 700 for panels/top-bar) — stands in for the licensed Museo Sans. Body = **Open Sans** 400/600/700. Mono (`ui-monospace`) for IDs/keys. Scale: hero 52 · h1 26 · h2 20 · h3 16 · stat 42 (lg 64) · lead 17 · body 14 · sm 13 · eyebrow 11.5 (uppercase, `.05em`). Personality = weight contrast, tight tracking (`-0.02em`) on big display.

**Spacing & layout.** 4px base scale. App shell = fixed **252px sidebar** + scrolling main with a **68px sticky top bar**; content `max-width:1240px`, padding `40px 36px 72px`. Generous internal card padding (18–20px).

**Backgrounds.** Flat colour only — the `#f7f8fa` wash and white cards. **No gradient page backgrounds.** The one sanctioned gradient is the **mosaic gradient border** on the "Ask Lighthouse" composer (`linear-gradient(120deg, …six mosaic hues)`), and subtle avatar/icon-tile gradients. No textures, patterns, or hero imagery.

**Corner radii.** sm 6 (chips/controls) · md 10 (buttons/inputs) · lg **14** (cards/panels — the redesign default) · xl 18 (composer/large surfaces) · pill. KPI cards use 15px.

**Cards.** White, 1px hairline border (`--tes-n-200`), `--radius-lg`, `--shadow-xs`. Optional 3px top **accent bar** in a mosaic/band hue (KPI + band cards). Section panels replace the old navy bars with a **light panel header**: a mosaic-tinted 40px icon tile + title/subtitle. A solid **navy dark-cap** card is a Tes signature reserved for one hero block per page.

**Shadows.** Soft, low-contrast navy: xs `0 1px 2px /.06`, sm, md `0 4px 14px /.10`, lg `0 12px 32px /.14`. Focus ring `0 0 0 3px rgba(43,125,196,.35)`.

**Borders.** Hairlines everywhere (`--tes-n-200`); inputs `--tes-n-300`. Dividers between table/list rows are hairline; row hover = `--tes-n-50` wash.

**Motion.** Subtle and fast. Transitions `150ms cubic-bezier(.2,.6,.2,1)`. Cards **fade-up** on load (`opacity 0→1`, `translateY 12px→0`) with staggered `.04s` delays. Sparklines **draw in** via `stroke-dashoffset` (~1.2s). Caret blink while the assistant streams; gentle float on empty-state tiles; `ringpulse` on the live status dot. **No bounces, parallax, or infinite spinners** (loaders excepted). Respect `prefers-reduced-motion` (handled in `tokens/animations.css`).

**Hover / press.** Cards lift `translateY(-3px)` + deeper shadow. Buttons brighten/darken + lift 1px. Chips gain a blue border. Links blue → darker blue. Inputs focus to a blue border + ring. Selected chips/tabs use blue tint / ink underline.

**Transparency & blur.** Used sparingly: the top bar is `rgba(255,255,255,.82)` + `backdrop-filter: blur(14px)`. Tints (status/category backgrounds) are flat light colours, not alpha stacks, except the sidebar active-accent tint.

**Imagery vibe.** Effectively none — the system is illustration- and photo-free. Identity is the mosaic + colour + type. Avatars are gradient initials tiles; the brand/assistant identity is the mosaic mark.

---

## ICONOGRAPHY

- **Style:** thin **line icons, 1.8px stroke, rounded** caps/joins — the [Lucide](https://lucide.dev) vocabulary. Nav glyphs render at 19px; panel-header tiles at ~20px; inline affordances use `→` and `▾` text glyphs.
- **In this system** the icons are hand-authored inline SVG paths matching the Lucide weight, collected in `ui_kits/lighthouse/icons.jsx` as `<Icon name=… />` (home, inbox, health, radar, champion, tasks, triage, playbooks, ledger, opportunities, meetings, skills, chat, reports, jobs, design, search, bell, palette, plus, arrowUp, sparkle, chevronDown, robot, trendUp, check, archive, snooze). Components that take an icon (Button, PanelHeader, EmptyState) accept any SVG node, so you can pass an `<Icon>` or a real Lucide import.
- **Substitution note:** Lucide stands in for the codebase's icon set. If the Lighthouse codebase ships its own icon font/sprite, prefer it — pass its glyphs into the icon-accepting components. You can also link Lucide from CDN in a consuming project.
- **No emoji.** **No icon fonts** are bundled. Unicode arrows/chevrons (`→ ▲ ▼ ▾`) are used as lightweight inline affordances and inside trend pills.
- **Brand mark:** the 3×3 mosaic (`MosaicMark` component / `assets/mosaic-mark.svg`) — used in the sidebar lockup and the assistant avatar. Not an "icon"; don't recolour it.

---

## Index — what's in this project

**Foundations**
- `styles.css` — the single entry point consumers link. Imports everything below.
- `tokens/colors.css` · `typography.css` · `spacing.css` · `sidebar.css` · `animations.css` · `fonts.css` — all design tokens + the webfont import + motion keyframes.
- `guidelines/*.html` — foundation specimen cards (Colors, Type, Spacing) shown in the Design System tab.

**Components** (`window.LighthouseDesignSystem_68eba0.<Name>`; each has `.jsx` + `.d.ts` + `.prompt.md` + a card)
- `brand/` — **MosaicMark** (logo).
- `core/` — **Button, Badge, Chip, Tabs, Card, PanelHeader, KpiCard, Avatar, EmptyState, Icon, PageHeader, DataTable**.
- `forms/` — **Input, Select**.
- `shell/` — **AppShell** (the whole chrome), **Sidebar**, **TopBar**, **Fab** + `LIGHTHOUSE_NAV`. These are the decoupled *page components*: `AppShell` gives any project the full Lighthouse shell (light/navy sidebar, glassy top bar, persisted Appearance, FAB) in one tag.
- `patterns/` — **Composer** (the "Ask Lighthouse" hero).

**UI kit**
- `ui_kits/lighthouse/` — interactive recreation of the app (Shell + Home, Health, Inbox, Tasks). Open `index.html`. See its `README.md`.

**Assets**
- `assets/mosaic-mark.svg` — the brand mark for non-React contexts.

**Reference (read-only, from the handoff)**
- `design_handoff_lighthouse_redesign/` — the original contract + per-route recipes. Consult `APPLYING_THE_REDESIGN.md` to build any route not yet in the UI kit.

**Skill**
- `SKILL.md` — makes this system usable as a downloadable Agent Skill.

### Building a new route
Wrap it in the **AppShell** (`shell/AppShell.jsx` — sidebar + top bar + FAB + persisted Appearance, all in one tag), open with a **PageHeader**, put content in white **Card**s / **PanelHeader** panels, use **KpiCard** for metrics, **DataTable** for admin lists, **Badge/Chip** for status & filters, **Tabs** for view-switching, the **Input/Select** form controls, **Composer** for the assistant, **Icon** for glyphs, and **EmptyState** for empties. Follow the per-route recipe in `design_handoff_lighthouse_redesign/APPLYING_THE_REDESIGN.md`.

```jsx
const { AppShell, PageHeader, Card, Button } = window.LighthouseDesignSystem_68eba0;
const [route, setRoute] = React.useState('Home');
<AppShell active={route} onNav={setRoute}>
  <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 36px 72px' }}>
    <PageHeader title="Tasks" subtitle="Customer-success work across your accounts." />
    {/* …Cards, KpiCards, tables… */}
  </div>
</AppShell>
```
