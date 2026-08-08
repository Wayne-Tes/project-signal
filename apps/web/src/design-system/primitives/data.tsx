'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Card } from './surfaces';
import type { TONE_VAR } from './surfaces';

/**
 * Data display — the components that render numbers.
 *
 * Every figure surface sets tabular figures via the `--fnum` token, so a value
 * ticking from 41 to 42 does not shift the layout. That is why these are
 * components rather than markup a page writes for itself.
 */

type Tone = keyof typeof TONE_VAR;

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendProps {
  direction: TrendDirection;
  /** Already-formatted, e.g. "12" or "3.4 pts". */
  value: string;
  /** What the change is measured against — "vs last week". */
  context?: string;
  /**
   * Whether "up" is good. For a damage or complaint metric it is not, and
   * colouring a rise green would actively mislead.
   */
  upIsGood?: boolean;
}

const GLYPH: Record<TrendDirection, string> = { up: '▲', down: '▼', flat: '—' };

export function Trend({ direction, value, context, upIsGood = true }: TrendProps) {
  const good = direction === 'flat' ? null : direction === 'up' ? upIsGood : !upIsGood;
  const cls = good === null ? 'flat' : good ? 'up' : 'down';

  return (
    <span className={`ds-trend ds-trend--${cls}`}>
      {/* The glyph carries the direction for anyone who cannot distinguish the
          colour; the text alternative spells it out for screen readers. */}
      <span aria-hidden="true">{GLYPH[direction]}</span>
      <span className="ds-visually-hidden">
        {direction === 'flat' ? 'no change' : direction === 'up' ? 'up' : 'down'}
      </span>
      {value}
      {context && <span className="ds-muted"> {context}</span>}
    </span>
  );
}

export interface KpiCardProps {
  label: string;
  /** Pre-formatted. The component never rounds — that is the caller's decision. */
  value: string;
  trend?: TrendProps;
  /** Secondary line, e.g. "16 of 30 accounts". */
  meta?: string;
  tone?: Tone;
  large?: boolean;
  stagger?: number;
}

export function KpiCard({ label, value, trend, meta, tone, large, stagger }: KpiCardProps) {
  return (
    <Card accent={tone} stagger={stagger}>
      <div className="ds-kpi__label">{label}</div>
      <div className={`ds-kpi__value${large ? 'ds-kpi__value--lg' : ''}`}>{value}</div>
      {(trend || meta) && (
        <div className="ds-kpi__meta">
          {trend && <Trend {...trend} />}
          {meta && <span>{meta}</span>}
        </div>
      )}
    </Card>
  );
}

export interface Column<Row> {
  key: string;
  header: string;
  /** Cell renderer. Returning a node keeps formatting out of the table. */
  render: (row: Row) => ReactNode;
  /** Right-align numeric columns. */
  numeric?: boolean;
  width?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Rendered in place of the table when there are no rows. */
  empty?: ReactNode;
  caption?: string;
}

/**
 * A generic table.
 *
 * Generic over the row type so columns are checked against the data rather than
 * indexing into `any`. The empty case is a first-class prop: a table that
 * renders a bare header row over nothing reads as broken.
 */
export function DataTable<Row>({ columns, rows, rowKey, empty, caption }: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <table className="ds-table">
      {caption && <caption className="ds-visually-hidden">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={{ width: c.width, textAlign: c.numeric ? 'right' : 'left' }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} style={{ textAlign: c.numeric ? 'right' : 'left' }}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'info' | 'warn' | 'critical' | 'teal';
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return (
    <span className={`ds-badge${tone === 'neutral' ? '' : ` ds-badge--${tone}`}`}>{children}</span>
  );
}

export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

export function Chip({ children, selected, onClick }: ChipProps) {
  return (
    <button type="button" className="ds-chip" aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- Layout helpers ------------------------------------------------ */

export function Stack({
  children,
  gap = 'var(--s-4)',
  className,
}: {
  children: ReactNode;
  gap?: string;
  className?: string;
}) {
  return (
    <div className={`ds-stack ${className ?? ''}`} style={{ '--ds-gap': gap } as CSSProperties}>
      {children}
    </div>
  );
}

export function Row({
  children,
  gap = 'var(--s-3)',
  className,
}: {
  children: ReactNode;
  gap?: string;
  className?: string;
}) {
  return (
    <div className={`ds-row ${className ?? ''}`} style={{ '--ds-gap': gap } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Auto-fitting grid. Callers set a minimum column WIDTH, not a count, so the
 * layout reflows without a media query per breakpoint.
 */
export function Grid({
  children,
  min = '240px',
  gap = 'var(--s-4)',
}: {
  children: ReactNode;
  min?: string;
  gap?: string;
}) {
  return (
    <div className="ds-grid" style={{ '--ds-min': min, '--ds-gap': gap } as CSSProperties}>
      {children}
    </div>
  );
}
