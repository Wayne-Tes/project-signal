import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Primary / ghost / danger / subtle buttons" viewport="700x220"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  /** Control size. @default "md" */
  size?: 'md' | 'sm';
  /** Icon node rendered before the label (e.g. a 16px SVG). */
  iconLeft?: React.ReactNode;
  /** Icon node rendered after the label (e.g. a → glyph). */
  iconRight?: React.ReactNode;
}

/**
 * The Lighthouse button. Primary = navy; ghost = hairline white;
 * danger = magenta (destructive); subtle = link-blue text.
 */
export function Button(props: ButtonProps): JSX.Element;
