import React from 'react';

export interface NavEntry {
  /** Stable id, also the default label and the active key. */
  id: string;
  /** Icon name from the Icon set. */
  icon: string;
  /** Optional label override (defaults to id). */
  label?: React.ReactNode;
  /** Optional count badge. */
  badge?: string;
  /** Badge background colour. */
  badgeColor?: string;
}

export interface NavConfig {
  workspace?: NavEntry[];
  admin?: NavEntry[];
}

/** The default Lighthouse navigation (workspace + admin groups). */
export const LIGHTHOUSE_NAV: NavConfig;

export interface SidebarProps {
  /** Navigation config. @default LIGHTHOUSE_NAV */
  nav?: NavConfig;
  /** Active route id. */
  active?: string;
  /** Called with the clicked entry id. */
  onNav?: (id: string) => void;
  /** Navy theme variant. @default false (light) */
  navy?: boolean;
  /** Active-accent colour (lime by default). */
  accent?: string;
  /** User row data. */
  user?: { name: string; scope: string; initial: string };
  /** Brand title / subtitle. */
  brand?: React.ReactNode;
  brandSub?: React.ReactNode;
}

/**
 * The app sidebar — mosaic brand lockup, grouped nav with the lime
 * active accent, and the user row. Usually used via AppShell.
 */
export function Sidebar(props: SidebarProps): JSX.Element;
