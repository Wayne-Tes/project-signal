import React from 'react';

/**
 * @startingPoint section="Forms" subtitle="Text input & textarea" viewport="700x220"
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement> {
  /** Label rendered above the field. */
  label?: React.ReactNode;
  /** Muted helper text below the field. */
  hint?: React.ReactNode;
  /** Error message (shown instead of hint) — renders the field + text in critical magenta. */
  error?: React.ReactNode;
  /** Render a multi-line field. @default "input" */
  as?: 'input' | 'textarea';
}

/**
 * Labelled text input / textarea — hairline border, blue focus ring,
 * inline magenta error. The Lighthouse form field primitive.
 */
export function Input(props: InputProps): JSX.Element;
