import React from 'react';

/**
 * Page header — the standard top-of-page block: a Poppins title, a
 * one-line muted subtitle, and an optional right-aligned action.
 * Every route opens with one.
 */
export function PageHeader({ title, subtitle, action, style, ...rest }) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '16px',
        ...style,
      },
      ...rest,
    },
    React.createElement(
      'div',
      { style: { minWidth: 0 } },
      React.createElement('h2', {
        style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--fs-h1)', color: 'var(--tes-ink)', margin: 0, letterSpacing: 'var(--ls-tight)' },
      }, title),
      subtitle != null
        ? React.createElement('p', {
            style: { margin: '5px 0 0', fontSize: '14px', color: 'var(--text-muted)' },
          }, subtitle)
        : null
    ),
    action != null ? React.createElement('div', { style: { flex: 'none' } }, action) : null
  );
}
