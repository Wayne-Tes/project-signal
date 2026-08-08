import React from 'react';

/**
 * Empty state — a centred soft icon tile (gentle float), a Poppins
 * title, a muted one-liner and an optional primary action. Keep the
 * copy honest ("No meetings in your scope").
 */
export function EmptyState({ icon, title, description, action, style, ...rest }) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px',
        gap: '18px',
        ...style,
      },
      ...rest,
    },
    React.createElement(
      'div',
      {
        style: {
          width: '88px',
          height: '88px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg,var(--tes-blue-100),#fff)',
          border: '1px solid var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--tes-blue)',
          boxShadow: 'var(--shadow-sm)',
          animation: 'lh-floaty 4s ease-in-out infinite',
        },
      },
      icon
    ),
    React.createElement(
      'div',
      null,
      React.createElement('h2', {
        style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '24px', color: 'var(--tes-ink)', margin: 0, letterSpacing: 'var(--ls-tight)' },
      }, title),
      description != null
        ? React.createElement('p', {
            style: { margin: '10px 0 0', fontSize: '14.5px', color: 'var(--text-muted)', maxWidth: '380px', lineHeight: 1.5 },
          }, description)
        : null
    ),
    action != null ? action : null
  );
}
