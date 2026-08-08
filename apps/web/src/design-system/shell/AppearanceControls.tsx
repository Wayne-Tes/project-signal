'use client';

import type { CSSProperties } from 'react';
import { Segmented, SwatchPicker } from '../primitives/controls';
import { useAppearance } from '../AppearanceProvider';
import {
  ACCENT_KEYS,
  ACCENT_LABEL,
  FONT_PAIRS,
  FONT_PAIR_LABEL,
  HERO_LABEL,
  HERO_STYLES,
  SIDEBAR_LABEL,
  SIDEBAR_THEMES,
  THEME_CHOICES,
  THEME_LABEL,
  accentVar,
  type AccentKey,
  type FontPair,
  type HeroStyle,
  type SidebarTheme,
  type ThemeChoice,
} from '../personalisation';

/**
 * AppearanceControls — every personalisation choice, in one component.
 *
 * Deliberately separate from the popover that hosts it. A settings page will
 * want exactly these controls, and the moment there are two implementations they
 * drift: one grows an option the other lacks, and a user finds the same setting
 * behaving differently in two places. This is the single source.
 *
 * Hero style, typeface pairing and animations are RESTORED from the prototype
 * Tweaks panel, which was deleted during the shell migration. Removing working
 * controls was not a decision that layer should have taken; they live here now
 * because this is the settings surface, not because a second panel was needed.
 */
export function AppearanceControls() {
  const {
    theme,
    sidebar,
    accent,
    hero,
    fontPair,
    animate,
    setTheme,
    setSidebar,
    setAccent,
    setHero,
    setFontPair,
    setAnimate,
  } = useAppearance();

  return (
    <div className="ds-stack" style={{ '--ds-gap': 'var(--s-5)' } as CSSProperties}>
      <Segmented<ThemeChoice>
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={THEME_CHOICES.map((t) => ({ value: t, label: THEME_LABEL[t] }))}
      />

      <Segmented<SidebarTheme>
        label="Sidebar"
        value={sidebar}
        onChange={setSidebar}
        options={SIDEBAR_THEMES.map((s) => ({ value: s, label: SIDEBAR_LABEL[s] }))}
      />

      <SwatchPicker<AccentKey>
        label="Highlight"
        value={accent}
        onChange={setAccent}
        options={ACCENT_KEYS.map((a) => ({
          value: a,
          label: ACCENT_LABEL[a],
          colour: accentVar(a),
        }))}
      />

      <Segmented<HeroStyle>
        label="Dashboard hero"
        value={hero}
        onChange={setHero}
        options={HERO_STYLES.map((h) => ({ value: h, label: HERO_LABEL[h] }))}
      />

      {/* Retained from the prototype and in tension with the design system's
          house typeface — see docs/STUBS.md. Kept rather than silently dropped. */}
      <Segmented<FontPair>
        label="Typeface"
        value={fontPair}
        onChange={setFontPair}
        options={FONT_PAIRS.map((f) => ({ value: f, label: FONT_PAIR_LABEL[f] }))}
      />

      <Segmented<'on' | 'off'>
        label="Animations"
        value={animate ? 'on' : 'off'}
        onChange={(v) => setAnimate(v === 'on')}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </div>
  );
}
