import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Status & severity pills" viewport="700x160"
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic status tone. @default "neutral" */
  tone?: 'positive' | 'info' | 'warn' | 'critical' | 'neutral' | 'teal';
  /** A categorical mosaic hex (e.g. "#6B4E9E") — overrides `tone` with that hue + a light tint. */
  mosaic?: string;
}

/**
 * Status / severity pill. positive=Won/sent/active, info=Open/scope,
 * warn=watch/medium, critical=high/failed, neutral=standard. Use
 * `mosaic` for category chips (event types, sources).
 */
export function Badge(props: BadgeProps): JSX.Element;
