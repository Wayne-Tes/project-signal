/**
 * personalisation.ts — Appearance state for the app shell.
 *
 * Modelled directly on Project-Lighthouse's `shell/personalisation.ts`, so the
 * two products behave identically for a user who moves between them. Three
 * independent preferences:
 *
 *   - surface theme  "light" | "dark"   -> `data-theme`   on the shell root
 *   - sidebar theme  "light" | "navy"   -> `data-sidebar` on the shell root
 *   - accent         one of five keys   -> rewrites `--accent` / `--accent-tint`
 *
 * WHY THE ACCENT IS A KEY, NOT A COLOUR. Persisting `#9FCB3B` would put a raw
 * hex in localStorage and in any future database column, so re-tuning the
 * palette would need a data migration and old sessions would keep the old
 * colour forever. Storing `lime` means the key resolves to a token at apply
 * time and the palette stays editable in one CSS file.
 *
 * WHY localStorage. There is no server-side preference store in this product
 * yet. Lighthouse treats the user account as the source of truth and
 * localStorage as a fast-paint cache; the read/write functions below are
 * deliberately shaped so that adding `GET/PUT /users/me/preferences` later is a
 * new call site, not a rewrite. Until then, preferences are per-browser and
 * that is an honest limitation rather than a hidden one.
 */

/** The theme actually painted. Only ever `light` or `dark`. */
export type SurfaceTheme = 'light' | 'dark';

/**
 * What the USER chose, which is not the same thing.
 *
 * `system` means "follow the operating system and keep following it". Modelled
 * on Project-Cadence's ThemeProvider: an explicit choice always beats the OS,
 * and with no explicit choice we track `prefers-color-scheme` live rather than
 * sampling it once at boot. Collapsing the two into a single boolean loses the
 * ability to ever go back to following the OS.
 */
export type ThemeChoice = SurfaceTheme | 'system';

export type SidebarTheme = 'light' | 'navy';
export type AccentKey = 'lime' | 'blue' | 'teal' | 'orange' | 'purple';

/** Dashboard hero presentation. Restored from the prototype Tweaks panel. */
export type HeroStyle = 'gauge' | 'bars';

/**
 * Typeface pairing. RETAINED FROM THE PROTOTYPE and in tension with the design
 * system, which mandates Poppins + Open Sans as the house style. Kept because
 * removing a working control unasked is not a decision this layer gets to make;
 * flagged in docs/STUBS.md for the owner to settle.
 */
export type FontPair = 'house' | 'grotesk' | 'plex' | 'sora';

export const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
export const SIDEBAR_THEMES: SidebarTheme[] = ['light', 'navy'];
export const ACCENT_KEYS: AccentKey[] = ['lime', 'blue', 'teal', 'orange', 'purple'];
export const HERO_STYLES: HeroStyle[] = ['gauge', 'bars'];
export const FONT_PAIRS: FontPair[] = ['house', 'grotesk', 'plex', 'sora'];

/** Follow the OS until told otherwise; lime and a light sidebar per Aurora. */
export const DEFAULT_THEME: ThemeChoice = 'system';
export const DEFAULT_SIDEBAR: SidebarTheme = 'light';
export const DEFAULT_ACCENT: AccentKey = 'lime';
export const DEFAULT_HERO: HeroStyle = 'gauge';
export const DEFAULT_FONT_PAIR: FontPair = 'house';
/** Entrance animations on by default, as the prototype had them. */
export const DEFAULT_ANIMATE = true;

/** The OS preference right now. SSR-safe: assumes light where unknowable. */
export function systemTheme(): SurfaceTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Collapses a choice into the theme to paint. */
export function resolveTheme(choice: ThemeChoice): SurfaceTheme {
  return choice === 'system' ? systemTheme() : choice;
}

const LS_THEME = 'ps_theme';
const LS_SIDEBAR = 'ps_sidebar';
const LS_ACCENT = 'ps_accent';
const LS_HERO = 'ps_hero';
const LS_FONT = 'ps_font';
const LS_ANIMATE = 'ps_animate';

/** British English labels — no emoji, sentence case. */
export const THEME_LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export const SIDEBAR_LABEL: Record<SidebarTheme, string> = {
  light: 'Light',
  navy: 'Navy',
};

export const HERO_LABEL: Record<HeroStyle, string> = {
  gauge: 'Radial gauge',
  bars: 'Bars',
};

export const FONT_PAIR_LABEL: Record<FontPair, string> = {
  house: 'House (Poppins + Open Sans)',
  grotesk: 'Space Grotesk + Plex',
  plex: 'Plex everywhere',
  sora: 'Sora + Plex',
};

/** The families each pairing writes onto --font-display / --font-body. */
export const FONT_PAIR_STACK: Record<FontPair, { display: string; body: string }> = {
  house: {
    display: "'Poppins', 'Segoe UI', sans-serif",
    body: "'Open Sans', system-ui, sans-serif",
  },
  grotesk: {
    display: "'Space Grotesk', sans-serif",
    body: "'IBM Plex Sans', system-ui, sans-serif",
  },
  plex: { display: "'IBM Plex Sans', sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" },
  sora: { display: "'Sora', sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" },
};

export const ACCENT_LABEL: Record<AccentKey, string> = {
  lime: 'Lime',
  blue: 'Blue',
  teal: 'Teal',
  orange: 'Orange',
  purple: 'Purple',
};

export interface Appearance {
  /** What the user chose — may be `system`. Paint `resolveTheme(theme)`. */
  theme: ThemeChoice;
  sidebar: SidebarTheme;
  accent: AccentKey;
  /** Dashboard hero presentation. Restored from the prototype Tweaks panel. */
  hero: HeroStyle;
  /** Typeface pairing — see the note on FontPair. */
  fontPair: FontPair;
  /** Entrance animations. Off also suppresses the remount that replays them. */
  animate: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  sidebar: DEFAULT_SIDEBAR,
  accent: DEFAULT_ACCENT,
  hero: DEFAULT_HERO,
  fontPair: DEFAULT_FONT_PAIR,
  animate: DEFAULT_ANIMATE,
};

/** The solid accent token for a key — drives swatches and the active nav bar. */
export function accentVar(key: AccentKey): string {
  return `var(--accent-${key})`;
}

/** The soft tint token for a key — drives the active-nav background wash. */
export function accentTintVar(key: AccentKey): string {
  return `var(--accent-${key}-tint)`;
}

function isTheme(v: unknown): v is ThemeChoice {
  return v === 'light' || v === 'dark' || v === 'system';
}

function isSidebar(v: unknown): v is SidebarTheme {
  return v === 'light' || v === 'navy';
}

function isAccent(v: unknown): v is AccentKey {
  return typeof v === 'string' && (ACCENT_KEYS as string[]).includes(v);
}

/**
 * Reads persisted appearance, falling back to defaults.
 *
 * Safe to call during SSR and in jsdom: `localStorage` is absent on the server
 * and can throw in private-browsing modes, so every access is guarded. Each
 * value is validated rather than cast — a stale or hand-edited key must fall
 * back to the default instead of writing an unknown string onto `data-theme`,
 * which would silently produce an unstyled shell.
 */
export function readAppearance(): Appearance {
  const next: Appearance = { ...DEFAULT_APPEARANCE };
  if (typeof window === 'undefined') return next;

  try {
    const theme = window.localStorage.getItem(LS_THEME);
    if (isTheme(theme)) next.theme = theme;

    const sidebar = window.localStorage.getItem(LS_SIDEBAR);
    if (isSidebar(sidebar)) next.sidebar = sidebar;

    const accent = window.localStorage.getItem(LS_ACCENT);
    if (isAccent(accent)) next.accent = accent;

    const hero = window.localStorage.getItem(LS_HERO);
    if (hero === 'gauge' || hero === 'bars') next.hero = hero;

    const font = window.localStorage.getItem(LS_FONT);
    if ((FONT_PAIRS as string[]).includes(font ?? '')) next.fontPair = font as FontPair;

    // Stored as '0'/'1' rather than JSON: a boolean is the one value where a
    // parse failure silently yields `false`, which would disable animations for
    // anyone with a corrupt key rather than falling back to the default.
    const animate = window.localStorage.getItem(LS_ANIMATE);
    if (animate === '0') next.animate = false;
    if (animate === '1') next.animate = true;
  } catch {
    // localStorage unavailable — defaults stand.
  }
  return next;
}

/** Persists one preference. Never throws: a failed write must not break the UI. */
export function persistAppearance(patch: Partial<Appearance>): void {
  if (typeof window === 'undefined') return;
  try {
    if (patch.theme) window.localStorage.setItem(LS_THEME, patch.theme);
    if (patch.sidebar) window.localStorage.setItem(LS_SIDEBAR, patch.sidebar);
    if (patch.accent) window.localStorage.setItem(LS_ACCENT, patch.accent);
    if (patch.hero) window.localStorage.setItem(LS_HERO, patch.hero);
    if (patch.fontPair) window.localStorage.setItem(LS_FONT, patch.fontPair);
    // Explicit undefined check — `if (patch.animate)` would never persist false.
    if (patch.animate !== undefined)
      window.localStorage.setItem(LS_ANIMATE, patch.animate ? '1' : '0');
  } catch {
    // Preference is still applied for this session; only persistence is lost.
  }
}

/**
 * The inline style that carries the chosen accent onto the shell root.
 *
 * Returned as a style object rather than written to `document.documentElement`
 * so the shell stays a pure React component — testable, SSR-safe, and with no
 * global side effect that a second mounted shell could fight over.
 */
export function accentStyle(accent: AccentKey): Record<string, string> {
  return {
    '--accent': accentVar(accent),
    '--accent-tint': accentTintVar(accent),
  };
}

/**
 * Script executed before first paint to apply the stored theme.
 *
 * Without this the server renders the default light shell and the client
 * corrects it on mount, which a dark-theme user sees as a white flash on every
 * navigation. Kept as a string so `layout.tsx` can inline it; it is inert,
 * reads only our own keys, and writes nothing.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('${LS_THEME}');
var sys=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
d.setAttribute('data-theme',(t==='light'||t==='dark')?t:sys);
var s=localStorage.getItem('${LS_SIDEBAR}');if(s==='light'||s==='navy')d.setAttribute('data-sidebar',s);
var a=localStorage.getItem('${LS_ACCENT}');
if(a&&['lime','blue','teal','orange','purple'].indexOf(a)>-1){
d.style.setProperty('--accent','var(--accent-'+a+')');
d.style.setProperty('--accent-tint','var(--accent-'+a+'-tint)');}
}catch(e){}})();`;
