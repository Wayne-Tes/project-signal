'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Surfaces — the containers everything else sits in.
 *
 * Every component here is a thin wrapper over a `ds-` class. That is
 * deliberate: styling lives in styles.css where a theme can reach it, and the
 * component's job is only to compose the right classes and enforce the API.
 * A page should never need an inline `style` for anything these express.
 */

type Tone = 'default' | 'accent' | 'positive' | 'info' | 'warn' | 'critical' | 'teal';

/** Maps a semantic tone onto its token pair. Extend here, never at a call site. */
export const TONE_VAR: Record<Tone, { fg: string; bg: string }> = {
  default: { fg: 'var(--accent)', bg: 'var(--accent-tint)' },
  accent: { fg: 'var(--accent)', bg: 'var(--accent-tint)' },
  positive: { fg: 'var(--status-positive)', bg: 'var(--status-positive-bg)' },
  info: { fg: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  warn: { fg: 'var(--status-warn)', bg: 'var(--status-warn-bg)' },
  critical: { fg: 'var(--status-critical)', bg: 'var(--status-critical-bg)' },
  teal: { fg: 'var(--status-teal)', bg: 'var(--status-teal-bg)' },
};

export interface CardProps {
  children: ReactNode;
  /** Draws the 3px top accent bar in the given tone. */
  accent?: Tone;
  /** The solid-navy signature block. One per page, at most. */
  dark?: boolean;
  /** Removes padding — for cards wrapping a full-bleed table or chart. */
  flush?: boolean;
  onClick?: () => void;
  /** Entrance stagger in ms. Cards in a list pass their index * 40. */
  stagger?: number;
  className?: string;
  style?: CSSProperties;
}

export function Card({
  children,
  accent,
  dark,
  flush,
  onClick,
  stagger,
  className,
  style,
}: CardProps) {
  const classes = [
    'ds-card',
    'ds-enter',
    accent ? 'ds-card--accented' : '',
    dark ? 'ds-card--dark' : '',
    flush ? 'ds-card--flush' : '',
    onClick ? 'ds-card--interactive' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const vars = {
    ...(accent ? { '--ds-accent-bar': TONE_VAR[accent].fg } : {}),
    ...(stagger ? { '--ds-stagger': `${stagger}ms` } : {}),
    ...style,
  } as CSSProperties;

  // An interactive card is a real button: keyboard-reachable and announced as
  // activatable. A div with onClick is neither.
  if (onClick) {
    return (
      <button type="button" className={classes} style={vars} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <div className={classes} style={vars}>
      {children}
    </div>
  );
}

export interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  /** A Lucide icon node, rendered in the 40px tinted tile. */
  icon?: ReactNode;
  tone?: Tone;
  /** Right-aligned actions — filters, a "view all" link. */
  actions?: ReactNode;
}

/**
 * The light panel header that replaces the old heavy navy section bar.
 * A mosaic-tinted icon tile plus title/subtitle.
 */
export function PanelHeader({
  title,
  subtitle,
  icon,
  tone = 'default',
  actions,
}: PanelHeaderProps) {
  const { fg, bg } = TONE_VAR[tone];
  return (
    <div className="ds-panel-header">
      {icon && (
        <span
          className="ds-panel-header__tile"
          style={{ '--ds-tile-bg': bg, '--ds-tile-fg': fg } as CSSProperties}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <h3 className="ds-panel-header__title">{title}</h3>
        {subtitle && <p className="ds-panel-header__subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

/** Opens every route. Sentence case, never Title Case. */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="ds-page-header ds-enter">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
        <h1 className="ds-page-header__title">{title}</h1>
        {subtitle && <p className="ds-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ds-row">{actions}</div>}
    </header>
  );
}

export interface EmptyStateProps {
  title: string;
  /** Say what is actually true. No cheerful filler. */
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, body, icon, action }: EmptyStateProps) {
  return (
    <div className="ds-empty">
      {icon && (
        <span className="ds-empty__tile" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3 className="ds-empty__title">{title}</h3>
      {body && <p className="ds-empty__body">{body}</p>}
      {action}
    </div>
  );
}
