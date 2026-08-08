import React from 'react';

/**
 * Filter chip — a toggle pill used in filter rows (Tasks, Triage,
 * Sector radar, Opportunities). Inactive = neutral fill; active =
 * blue tint + blue text.
 */
export function Chip({ children, active = false, iconLeft, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);

  return React.createElement(
    'button',
    {
      type: 'button',
      onClick,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
        fontWeight: 600,
        lineHeight: 1,
        padding: '7px 14px',
        borderRadius: 'var(--radius-pill)',
        cursor: 'pointer',
        transition: 'background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease)',
        color: active ? 'var(--tes-blue)' : 'var(--text-muted)',
        background: active ? 'var(--tes-blue-100)' : 'var(--tes-n-100)',
        border: active
          ? '1px solid var(--tes-blue)'
          : (hover ? '1px solid var(--tes-blue)' : '1px solid transparent'),
        ...style,
      },
      ...rest,
    },
    iconLeft,
    children
  );
}
