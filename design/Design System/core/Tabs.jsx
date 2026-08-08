import React from 'react';

/**
 * Underline tabs — switch content in place. Active = ink text + a
 * 2px ink underline; inactive = muted text. Used on Health,
 * Inbox, Skills, Knowledge.
 */
export function Tabs({ tabs = [], value, onChange, style, ...rest }) {
  return React.createElement(
    'div',
    {
      role: 'tablist',
      style: {
        display: 'flex',
        gap: '28px',
        borderBottom: '1px solid var(--border-hairline)',
        ...style,
      },
      ...rest,
    },
    tabs.map((t) => {
      const id = typeof t === 'string' ? t : t.id;
      const label = typeof t === 'string' ? t : t.label;
      const active = id === value;
      return React.createElement(
        'button',
        {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-selected': active,
          onClick: () => onChange && onChange(id),
          style: {
            fontFamily: 'var(--font-body)',
            fontSize: '15px',
            fontWeight: active ? 700 : 600,
            color: active ? 'var(--tes-ink)' : 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 0 14px',
            borderBottom: active ? '2px solid var(--tes-ink)' : '2px solid transparent',
            marginBottom: '-1px',
            transition: 'color var(--dur) var(--ease)',
          },
        },
        label
      );
    })
  );
}
