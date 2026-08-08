import React from 'react';

export interface DataColumn {
  /** Property key on the row (also the cell value when no `render`). */
  key?: string;
  /** Header label. */
  header?: React.ReactNode;
  /** Cell alignment. @default "left" */
  align?: 'left' | 'right' | 'center';
  /** Render the cell in monospace (IDs / keys). */
  mono?: boolean;
  /** Allow the cell to wrap. @default false (nowrap) */
  wrap?: boolean;
  /** Custom cell renderer — receives the row. */
  render?: (row: any) => React.ReactNode;
}

export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column definitions. */
  columns: DataColumn[];
  /** Row objects (use an `id` for stable keys). */
  rows: any[];
}

/**
 * The admin data table — uppercase header, hairline rows, hover wash.
 * Used on Users, Connectors, Knowledge, API keys, Coverage, Governance.
 */
export function DataTable(props: DataTableProps): JSX.Element;
