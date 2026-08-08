'use client';

import { Segmented, SwatchPicker } from '../primitives/controls';
import { useAppearance } from '../AppearanceProvider';
import {
  ACCENT_KEYS,
  ACCENT_LABEL,
  SIDEBAR_LABEL,
  SIDEBAR_THEMES,
  THEME_CHOICES,
  THEME_LABEL,
  accentVar,
  type AccentKey,
  type SidebarTheme,
  type ThemeChoice,
} from '../personalisation';

/**
 * AppearanceControls — the three personalisation choices, in one component.
 *
 * Deliberately separate from the popover that hosts it. A settings page will
 * want exactly these controls, and the moment there are two implementations
 * they drift: one grows an option the other lacks, and a user finds the same
 * setting behaving differently in two places. This is the single source.
 *
 * Reads and writes the AppearanceProvider directly rather than taking value and
 * onChange props — the state is genuinely global, and threading it through
 * every host would be ceremony.
 */
export function AppearanceControls() {
  const { theme, sidebar, accent, setTheme, setSidebar, setAccent } = useAppearance();

  return (
    <div className="ds-stack" style={{ '--ds-gap': 'var(--s-5)' } as React.CSSProperties}>
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
    </div>
  );
}
