import React from 'react';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Poppins page title (sentence case). */
  title?: React.ReactNode;
  /** One-line muted subtitle. */
  subtitle?: React.ReactNode;
  /** Optional right-aligned action (usually a primary Button). */
  action?: React.ReactNode;
}

/**
 * The standard top-of-page header — Poppins title + muted subtitle +
 * optional action. Every Lighthouse route opens with one.
 */
export function PageHeader(props: PageHeaderProps): JSX.Element;
