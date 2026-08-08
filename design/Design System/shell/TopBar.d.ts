import React from 'react';

export interface TopBarProps {
  /** Page title shown at the left. */
  title?: React.ReactNode;
  /** Navy sidebar state (drives the Appearance toggle). @default false */
  navy?: boolean;
  /** Current accent colour. */
  accent?: string;
  /** Called with 'light' | 'navy' from the Appearance toggle. */
  onSidebar?: (v: 'light' | 'navy') => void;
  /** Called with a hex when an accent swatch is chosen. */
  onAccent?: (c: string) => void;
  /** Accent swatches offered. */
  accentOptions?: string[];
  /** Notification count (bell badge); null hides it. */
  notifications?: number | null;
  /** User pill data. */
  user?: { name: string; scope: string; initial: string };
}

/**
 * The glassy sticky top bar — title, ⌘K search, Appearance popover
 * (sidebar Light/Navy + accent), notification bell, user/scope pill.
 * Usually used via AppShell, which owns the appearance state.
 */
export function TopBar(props: TopBarProps): JSX.Element;
