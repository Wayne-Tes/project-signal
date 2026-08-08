import React from 'react';

export type IconName =
  | 'home' | 'inbox' | 'health' | 'radar' | 'champion' | 'tasks' | 'triage'
  | 'playbooks' | 'ledger' | 'opportunities' | 'meetings' | 'skills' | 'chat'
  | 'reports' | 'jobs' | 'design' | 'search' | 'bell' | 'palette' | 'plus'
  | 'arrowUp' | 'sparkle' | 'chevronDown' | 'robot' | 'trendUp' | 'check'
  | 'archive' | 'snooze';

/** The icon path map — `{ name: string[] }`. */
export const ICON_PATHS: Record<IconName, string[]>;

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon name from the Lighthouse set. */
  name?: IconName;
  /** Pixel size (square). @default 19 */
  size?: number;
  /** Stroke colour. @default "currentColor" */
  stroke?: string;
  /** Stroke width. @default 1.8 */
  strokeWidth?: number;
  /** Override path data for a glyph not in the map. */
  extraPaths?: string[];
}

/**
 * The Lighthouse thin-line icon set (1.8px stroke, rounded — the
 * Lucide vocabulary). Pass to any icon-accepting component.
 */
export function Icon(props: IconProps): JSX.Element;
