import React from 'react';

/**
 * Panel header — the light section header that replaces the old
 * navy bars. A mosaic-tinted icon tile + title/subtitle, with an
 * optional right-aligned action. Place at the top of a white card.
 */
const TINTS = {
  blue:    { bg: 'var(--tes-blue-100)',  fg: 'var(--tes-blue)' },
  lime:    { bg: 'var(--tes-lime-100)',  fg: 'var(--tes-lime-deep)' },
  purple:  { bg: '#f3eefa',              fg: 'var(--tes-mosaic-purple)' },
  teal:    { bg: 'var(--status-teal-bg)',fg: 'var(--status-teal)' },
  orange:  { bg: 'var(--status-warn-bg)',fg: 'var(--status-warn)' },
  magenta: { bg: 'var(--status-critical-bg)', fg: 'var(--status-critical)' },
  neutral: { bg: 'var(--tes-n-100)',     fg: 'var(--tes-n-600)' },
};

export function PanelHeader({ icon, tone = 'blue', title, subtitle, action, style, ...rest }) {
  const t = TINTS[tone] || TINTS.blue;
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '13px',
        padding: '18px 22px',
        borderBottom: '1px solid var(--tes-n-100)',
        ...style,
      },
      ...rest,
    },
    React.createElement(
      'div',
      {
        style: {
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-md)',
          background: t.bg,
          color: t.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        },
      },
      icon
    ),
    React.createElement(
      'div',
      { style: { flex: '1 1 auto', minWidth: 0 } },
      React.createElement(
        'div',
        {
          style: {
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'var(--fs-h3)',
            color: 'var(--tes-ink)',
          },
        },
        title
      ),
      subtitle != null
        ? React.createElement(
            'div',
            { style: { fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '1px' } },
            subtitle
          )
        : null
    ),
    action != null ? React.createElement('div', { style: { flex: 'none' } }, action) : null
  );
}
