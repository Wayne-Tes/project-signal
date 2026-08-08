import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Empty / not-yet state" viewport="700x320"
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon node shown in the soft tile (≈36px line icon). */
  icon?: React.ReactNode;
  /** Poppins 800 title — honest, specific. */
  title?: React.ReactNode;
  /** Muted one-line explanation. */
  description?: React.ReactNode;
  /** Optional primary action (a Button). */
  action?: React.ReactNode;
}

/**
 * The empty / not-yet state — a floating icon tile, title, muted
 * line and optional action. Canonical example: "No meetings in your
 * scope". Reuse the tile silhouette for loading skeletons.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element;
