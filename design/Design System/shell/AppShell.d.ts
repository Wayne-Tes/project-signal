import React from 'react';
import { NavConfig } from './Sidebar';

/**
 * @startingPoint section="Shell" subtitle="Full app shell — sidebar + top bar + FAB" viewport="1440x900"
 */
export interface AppShellProps {
  /** Active route id (drives sidebar highlight + top-bar title). */
  active?: string;
  /** Called with the clicked nav id. */
  onNav?: (id: string) => void;
  /** Route content, rendered in the scrolling main column. */
  children?: React.ReactNode;
  /** Navigation config. @default LIGHTHOUSE_NAV */
  nav?: NavConfig;
  /** Top-bar title override (defaults to `active`). */
  pageTitle?: React.ReactNode;
  /** User shown in sidebar + top bar. */
  user?: { name: string; scope: string; initial: string };
  /** Notification bell count. @default 2 */
  notifications?: number | null;
  /** Persist Appearance choice to localStorage. @default true */
  persistAppearance?: boolean;
  /** Called when the assistant FAB is clicked. */
  onAssistant?: () => void;
}

/**
 * The complete Lighthouse chrome: light/navy sidebar (lime active
 * accent) + glassy sticky top bar (with the persisted Appearance
 * popover) + assistant FAB. Drop your route content in as children.
 */
export function AppShell(props: AppShellProps): JSX.Element;
