import React from 'react';

/**
 * Card — the base white surface. Hairline border, soft shadow,
 * 14px radius. Set `interactive` for the hover lift used on
 * clickable cards. Set `accent` for a 3px top accent bar.
 */
export function Card({
  children,
  interactive = false,
  accent,
  padding = '20px',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);

  return React.createElement(
    'div',
    {
      onMouseEnter: interactive ? () => setHover(true) : undefined,
      onMouseLeave: interactive ? () => setHover(false) : undefined,
      style: {
        position: 'relative',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        padding,
        overflow: accent ? 'hidden' : undefined,
        transform: hover ? 'translateY(-3px)' : 'none',
        transition: 'transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
        ...style,
      },
      ...rest,
    },
    accent
      ? React.createElement('div', {
          key: '__accent',
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: accent,
          },
        })
      : null,
    children
  );
}
