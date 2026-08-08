import React from 'react';

/**
 * Data table — the admin list surface (Users, Connectors, Knowledge,
 * API keys…). Uppercase header row, hairline-separated body rows,
 * hover wash. Pass `columns` and `rows`; a column can render a cell
 * via `render(row)`.
 */
export function DataTable({ columns = [], rows = [], style, ...rest }) {
  return React.createElement(
    'div',
    { style: { width: '100%', overflowX: 'auto', ...style }, ...rest },
    React.createElement(
      'table',
      { style: { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)' } },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          columns.map((c, i) => React.createElement('th', {
            key: c.key || i,
            style: {
              textAlign: c.align || 'left',
              fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: 'var(--ls-eyebrow)',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              padding: '0 16px 12px', borderBottom: '1px solid var(--border-hairline)', whiteSpace: 'nowrap',
            },
          }, c.header))
        )
      ),
      React.createElement(
        'tbody',
        null,
        rows.map((row, ri) => React.createElement(Row, { key: row.id != null ? row.id : ri, row, columns }))
      )
    )
  );
}

function Row({ row, columns }) {
  const [hover, setHover] = React.useState(false);
  return React.createElement(
    'tr',
    {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: { background: hover ? 'var(--tes-n-50)' : 'transparent', transition: 'background var(--dur) var(--ease)' },
    },
    columns.map((c, ci) => React.createElement('td', {
      key: c.key || ci,
      style: {
        textAlign: c.align || 'left',
        fontSize: '14px', color: 'var(--text-body)',
        padding: '14px 16px', borderBottom: '1px solid var(--border-hairline)',
        fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-body)',
        whiteSpace: c.wrap ? 'normal' : 'nowrap',
      },
    }, c.render ? c.render(row) : row[c.key]))
  );
}
