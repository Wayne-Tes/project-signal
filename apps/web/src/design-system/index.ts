/**
 * Project Signal design system — public surface.
 *
 * Application code imports from `@/design-system` and nothing deeper. That is
 * the boundary that makes this a library rather than a folder: internals can be
 * split, renamed or re-implemented without touching a single page, and a page
 * cannot reach past the API into a stylesheet or a token file.
 *
 * The tokens and component styles are CSS and are imported once, by
 * `app/globals.css`. They are not re-exported here — a component that needs a
 * style should get it from a class in styles.css, not from JavaScript.
 *
 * Adapted from the Lighthouse "Aurora" design system in
 * `design/Design System/`, which is the shared house style across
 * Project-Lighthouse, Project-Cadence and Market-competitor-analysis. Where
 * this deviates — the dark theme, which Aurora does not define — the reasoning
 * is recorded at the point of deviation in `tokens/colors.css`.
 */

// ---------- Appearance / theming ----------
export { AppearanceProvider, useAppearance } from './AppearanceProvider';
export {
  ACCENT_KEYS,
  ACCENT_LABEL,
  APPEARANCE_BOOT_SCRIPT,
  DEFAULT_ACCENT,
  DEFAULT_APPEARANCE,
  DEFAULT_SIDEBAR,
  DEFAULT_THEME,
  SIDEBAR_LABEL,
  SIDEBAR_THEMES,
  THEME_CHOICES,
  THEME_LABEL,
  accentStyle,
  accentTintVar,
  accentVar,
  readAppearance,
  resolveTheme,
  systemTheme,
  type AccentKey,
  type Appearance,
  type SidebarTheme,
  type SurfaceTheme,
  type ThemeChoice,
} from './personalisation';

// ---------- Shell ----------
export { AppShell, type AppShellProps, type NavGroup, type NavItem } from './shell/AppShell';
export { AppearanceControls } from './shell/AppearanceControls';

// ---------- Surfaces ----------
export {
  Card,
  EmptyState,
  PageHeader,
  PanelHeader,
  TONE_VAR,
  type CardProps,
  type EmptyStateProps,
  type PageHeaderProps,
  type PanelHeaderProps,
} from './primitives/surfaces';

// ---------- Controls ----------
export {
  Button,
  Field,
  Input,
  Segmented,
  Select,
  SwatchPicker,
  type ButtonProps,
  type FieldProps,
  type InputProps,
  type SegmentedProps,
  type SelectProps,
  type SwatchPickerProps,
} from './primitives/controls';

// ---------- Data display + layout ----------
export {
  Badge,
  Chip,
  DataTable,
  Grid,
  KpiCard,
  Row,
  Stack,
  Trend,
  type BadgeProps,
  type ChipProps,
  type Column,
  type DataTableProps,
  type KpiCardProps,
  type TrendDirection,
  type TrendProps,
} from './primitives/data';
