import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Filter chip toggle row" viewport="700x120"
 */
export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Active (selected) state — blue tint + blue text. @default false */
  active?: boolean;
  /** Optional icon node before the label. */
  iconLeft?: React.ReactNode;
}

/**
 * A toggle filter chip for filter rows (priority/source/owner/type).
 * Inactive = neutral fill; active = blue tint; hover gains a blue border.
 */
export function Chip(props: ChipProps): JSX.Element;
