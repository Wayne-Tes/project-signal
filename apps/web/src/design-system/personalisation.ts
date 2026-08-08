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

export const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
export const SIDEBAR_THEMES: SidebarTheme[] = ['light', 'navy'];
export const ACCENT_KEYS: AccentKey[] = ['lime', 'blue', 'teal', 'orange', 'purple'];

/** Follow the OS until told otherwise; lime and a light sidebar per Aurora. */
export const DEFAULT_THEME: ThemeChoice = 'system';
export const DEFAULT_SIDEBAR: SidebarTheme = 'light';
export const DEFAULT_ACCENT: AccentKey = 'lime';

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
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  sidebar: DEFAULT_SIDEBAR,
  accent: DEFAULT_ACCENT,
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
