import React from 'react';

export interface KpiTrend {
  /** Arrow direction. */
  dir: 'up' | 'down';
  /** Trend value text, e.g. "12%" or "1". */
  value: string;
  /** Status tone for the pill colour. @default "neutral" */
  tone?: 'positive' | 'info' | 'warn' | 'critical' | 'teal' | 'neutral';
}

/**
 * @startingPoint section="Core" subtitle="KPI metric card with sparkline" viewport="700x200"
 */
export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Eyebrow label (uppercased). */
  label: React.ReactNode;
  /** The big metric figure. */
  value: React.ReactNode;
  /** Small unit/qualifier after the figure (e.g. "healthy", "past due"). */
  unit?: React.ReactNode;
  /** Optional trend pill. */
  trend?: KpiTrend;
  /** Accent colour for the top bar + sparkline (a mosaic hue). @default blue */
  accent?: string;
  /** Sparkline data — array of 0..1 values (1 = top). Omit for no sparkline. */
  spark?: number[];
}

/**
 * The dashboard KPI card — 3px accent bar, eyebrow + trend pill, a
 * big Poppins figure, and a sparkline that draws in. Accent +
 * sparkline + trend share one mosaic colour per metric.
 */
export function KpiCard(props: KpiCardProps): JSX.Element;
