import React from 'react';

/**
 * Select — a labelled native select styled to match Input, with a
 * blue focus ring and a chevron affordance.
 */
export function Select({ label, hint, error, id, children, options, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useMemo(() => id || 'lh-sel-' + Math.random().toString(36).slice(2, 7), [id]);

  const opts = options
    ? options.map((o) => {
        const value = typeof o === 'string' ? o : o.value;
        const lbl = typeof o === 'string' ? o : o.label;
        return React.createElement('option', { key: value, value }, lbl);
      })
    : children;

  const field = React.createElement(
    'div',
    { style: { position: 'relative' } },
    React.createElement(
      'select',
      {
        id: autoId,
        onFocus: () => setFocus(true),
        onBlur: () => setFocus(false),
        style: {
          width: '100%',
          appearance: 'none',
          WebkitAppearance: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--fs-body)',
          color: 'var(--tes-ink)',
          background: '#fff',
          border: '1px solid ' + (error ? 'var(--status-critical)' : (focus ? 'var(--tes-blue)' : 'var(--border-input)')),
          borderRadius: 'var(--radius-md)',
          padding: '10px 34px 10px 12px',
          outline: 'none',
          cursor: 'pointer',
          boxShadow: focus ? 'var(--shadow-focus)' : 'none',
          transition: 'border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
          ...style,
        },
        ...rest,
      },
      opts
    ),
    React.createElement(
      'svg',
      {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'var(--tes-n-500)', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' },
      },
      React.createElement('path', { d: 'M8 9l4 4 4-4' })
    )
  );

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    label != null
      ? React.createElement('label', { htmlFor: autoId, style: { fontSize: '13px', fontWeight: 600, color: 'var(--text-body)' } }, label)
      : null,
    field,
    error != null
      ? React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--status-critical)' } }, error)
      : (hint != null ? React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--text-muted)' } }, hint) : null)
  );
}
