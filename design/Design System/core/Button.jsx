import React from 'react';

/**
 * Button — the Lighthouse action primitive.
 * Variants: primary (navy), ghost (hairline white), danger (magenta),
 * subtle (link-blue text). Sizes: md (default), sm.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  type = 'button',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);

  const pad = size === 'sm' ? '7px 12px' : '10px 16px';
  const fs = size === 'sm' ? '13px' : '14px';

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: fs,
    lineHeight: 1,
    padding: variant === 'subtle' ? '0' : pad,
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease), color var(--dur) var(--ease)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--tes-ink)' : 'var(--tes-navy)',
      color: '#fff',
      border: '1px solid transparent',
      transform: hover && !disabled ? 'translateY(-1px)' : 'none',
    },
    ghost: {
      background: hover && !disabled ? 'var(--tes-n-100)' : '#fff',
      color: 'var(--tes-ink)',
      border: '1px solid var(--tes-n-300)',
      borderColor: hover && !disabled ? 'var(--tes-n-400)' : 'var(--tes-n-300)',
    },
    danger: {
      background: hover && !disabled ? '#a81f4d' : 'var(--status-critical)',
      color: '#fff',
      border: '1px solid transparent',
      transform: hover && !disabled ? 'translateY(-1px)' : 'none',
    },
    subtle: {
      background: 'transparent',
      color: hover && !disabled ? 'var(--tes-blue-600)' : 'var(--tes-blue)',
      border: 'none',
    },
  };

  return React.createElement(
    'button',
    {
      type,
      disabled,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: { ...base, ...variants[variant], ...style },
      ...rest,
    },
    iconLeft,
    children != null ? React.createElement('span', null, children) : null,
    iconRight
  );
}
