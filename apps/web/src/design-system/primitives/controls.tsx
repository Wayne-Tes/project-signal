'use client';

import { forwardRef } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/**
 * Controls — buttons, form fields and the two selection widgets the Appearance
 * popover is built from.
 *
 * The segmented control and swatch picker are here rather than in the shell
 * because they are general-purpose: any future settings surface should reuse
 * them rather than fork a second copy, which is how two controls that look
 * alike start behaving differently.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Renders a square 40px button. `children` becomes the accessible label. */
  iconOnly?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Refs are forwarded because callers legitimately need the element: returning
 * focus to a trigger after closing a popover, for instance. Without this the
 * host has to reach for a cast, which is a smell that the primitive is
 * under-specified rather than that the caller is doing something exotic.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', iconOnly, icon, children, type = 'button', ...rest },
  ref,
) {
  const classes = [
    'ds-btn',
    `ds-btn--${variant}`,
    size === 'sm' ? 'ds-btn--sm' : '',
    iconOnly ? 'ds-btn--icon' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon}
      {/* An icon-only button still needs an accessible name — the visible glyph
          is aria-hidden, so `children` becomes screen-reader-only text. */}
      {iconOnly ? <span className="ds-visually-hidden">{children}</span> : children}
    </button>
  );
});

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** Label + control + hint/error, wired so the message is announced. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <span className="ds-hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ds-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function Input(props: InputProps) {
  return <input className="ds-input" {...props} />;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export function Select(props: SelectProps) {
  return <select className="ds-select" {...props} />;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** Announced group name, e.g. "Sidebar". */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A segmented single-choice control.
 *
 * Built on `radiogroup`/`radio` roles rather than buttons so a screen reader
 * announces "2 of 3" and arrow keys behave as expected — a row of buttons
 * looks identical and communicates none of that.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="ds-stack" style={{ '--ds-gap': 'var(--s-2)' } as CSSProperties}>
      <span className="ds-eyebrow">{label}</span>
      <div className="ds-segmented" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className="ds-segmented__option"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface SwatchOption<T extends string> {
  value: T;
  label: string;
  /** A CSS colour or `var(--token)`. */
  colour: string;
}

export interface SwatchPickerProps<T extends string> {
  label: string;
  options: SwatchOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Colour swatch picker.
 *
 * Each swatch carries its colour NAME as the accessible label. A swatch
 * identified only by its colour is unusable to anyone who cannot see it, and
 * "selected" is carried by aria-checked rather than by the ring alone.
 */
export function SwatchPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: SwatchPickerProps<T>) {
  return (
    <div className="ds-stack" style={{ '--ds-gap': 'var(--s-2)' } as CSSProperties}>
      <span className="ds-eyebrow">{label}</span>
      <div className="ds-swatches" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            aria-label={opt.label}
            title={opt.label}
            className="ds-swatch"
            style={{ '--ds-swatch': opt.colour } as CSSProperties}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}
