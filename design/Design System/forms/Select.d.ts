import React from 'react';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

/**
 * @startingPoint section="Forms" subtitle="Select with chevron" viewport="700x180"
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Label rendered above the control. */
  label?: React.ReactNode;
  /** Muted helper text below. */
  hint?: React.ReactNode;
  /** Error message (shown instead of hint), in critical magenta. */
  error?: React.ReactNode;
  /** Options as strings or {value,label}; alternatively pass <option> children. */
  options?: Array<string | SelectOption>;
}

/**
 * Labelled native select styled to match Input — chevron affordance,
 * blue focus ring. Use for inline Move/Priority/Owner and form selects.
 */
export function Select(props: SelectProps): JSX.Element;
