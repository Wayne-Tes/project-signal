'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_APPEARANCE,
  persistAppearance,
  readAppearance,
  resolveTheme,
  systemTheme,
  type AccentKey,
  type Appearance,
  type SidebarTheme,
  FONT_PAIR_STACK,
  type FontPair,
  type HeroStyle,
  type SurfaceTheme,
  type ThemeChoice,
} from './personalisation';

/**
 * AppearanceProvider — owns the three personalisation axes and stamps them onto
 * `<html>`, which is the selector every token file keys off.
 *
 * Modelled on Project-Cadence's ThemeProvider. Two things it does that a naive
 * implementation gets wrong:
 *
 *   1. It distinguishes the user's CHOICE from the painted THEME, so "follow the
 *      system" survives as a state rather than collapsing into whichever theme
 *      the OS happened to be on at first load.
 *   2. It keeps listening to `prefers-color-scheme` while the choice is
 *      `system`, so the app follows the OS switching to dark at sunset without
 *      a reload.
 *
 * The attributes land on `<html>` rather than on a wrapper div because the
 * `data-theme` selectors need to reach `body` — and because a boot script in
 * layout.tsx sets them BEFORE first paint to avoid a flash of the wrong theme.
 */

interface AppearanceContextValue extends Appearance {
  /** The theme actually painted — `theme` resolved through the OS preference. */
  resolvedTheme: SurfaceTheme;
  setTheme: (choice: ThemeChoice) => void;
  setSidebar: (theme: SidebarTheme) => void;
  setAccent: (accent: AccentKey) => void;
  setHero: (hero: HeroStyle) => void;
  setFontPair: (pair: FontPair) => void;
  setAnimate: (on: boolean) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  // Server-render with defaults. Reading localStorage here would break SSR, and
  // the boot script has already painted the correct theme, so the brief
  // mismatch is never visible.
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [system, setSystem] = useState<SurfaceTheme>('light');

  // Hydrate from storage once mounted.
  useEffect(() => {
    setAppearance(readAppearance());
    setSystem(systemTheme());
  }, []);

  // Track the OS preference for as long as the choice is `system`. The listener
  // is always attached — cheap, and it means flipping back to `system` picks up
  // the current value immediately rather than the value at mount.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: SurfaceTheme =
    appearance.theme === 'system' ? system : resolveTheme(appearance.theme);

  // The single side effect: stamp <html>. The token files do everything else.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    root.setAttribute('data-sidebar', appearance.sidebar);
    root.style.setProperty('--accent', `var(--accent-${appearance.accent})`);
    root.style.setProperty('--accent-tint', `var(--accent-${appearance.accent}-tint)`);

    // The font pairing overrides the design system's typography tokens at the
    // root, so legacy views reading var(--font-display) follow it too.
    const stack = FONT_PAIR_STACK[appearance.fontPair];
    root.style.setProperty('--font-display', stack.display);
    root.style.setProperty('--font-body', stack.body);

    // Gates every `.ds-enter` entrance animation. Distinct from
    // prefers-reduced-motion, which the stylesheet honours independently — this
    // is a preference, that is an accessibility requirement, and a user turning
    // animations back on must not override the OS setting.
    root.setAttribute('data-animate', appearance.animate ? 'on' : 'off');
  }, [
    resolvedTheme,
    appearance.sidebar,
    appearance.accent,
    appearance.fontPair,
    appearance.animate,
  ]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((prev) => ({ ...prev, ...patch }));
    persistAppearance(patch);
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...appearance,
      resolvedTheme,
      setTheme: (theme) => update({ theme }),
      setSidebar: (sidebar) => update({ sidebar }),
      setAccent: (accent) => update({ accent }),
      setHero: (hero) => update({ hero }),
      setFontPair: (fontPair) => update({ fontPair }),
      setAnimate: (animate) => update({ animate }),
    }),
    [appearance, resolvedTheme, update],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within an AppearanceProvider');
  return ctx;
}
