---
name: lighthouse-design
description: Use this skill to generate well-branded interfaces and assets for Lighthouse (by Tes) — the customer-success app on the "Aurora" redesign — for production or throwaway prototypes/mocks. Contains essential design guidelines, colours, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Where things are
- **`readme.md`** — the design guide: brand context, content fundamentals, visual foundations, iconography, and an index of everything. **Start here.**
- **`styles.css`** — the single CSS entry point. Link this one file; it `@import`s all tokens, the webfonts (Poppins + Open Sans), and motion keyframes.
- **`tokens/`** — colours, typography, spacing/radius/shadow, sidebar theme, animations.
- **`brand/`, `core/`, `forms/`** — React component primitives (`<Name>.jsx` + `.d.ts` + `.prompt.md`). Read the `.prompt.md` for usage.
- **`ui_kits/lighthouse/`** — a full interactive recreation of the app (shell + Home/Health/Inbox/Tasks). Best reference for composing screens.
- **`assets/`** — the mosaic brand mark.
- **`design_handoff_lighthouse_redesign/`** — the original contract + per-route recipes for the ~23 app routes.

## Non-negotiables
- British English; **no emoji** in product UI.
- White-led layout; colour is earned (blue = data/links, lime = positive/active, mosaic = categories only, magenta/orange = risk).
- Poppins extra-bold for headings + metric figures; Open Sans body.
- 14px card radius, hairline borders, soft navy shadows, 150ms `cubic-bezier(.2,.6,.2,1)` motion, fade-up entrances.
- Replace any heavy navy section bar with the light panel header. Reserve solid navy for one hero block per page.

## Using the components
In an HTML artifact: link `styles.css`, load `_ds_bundle.js`, then read components from `window.LighthouseDesignSystem_68eba0` (e.g. `const { Button, KpiCard, Card } = window.LighthouseDesignSystem_68eba0`). The UI kit's `index.html` is the canonical wiring example. In production, translate the tokens into your theme system and recreate the patterns with your component library.
