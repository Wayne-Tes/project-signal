import React from 'react';

/**
 * Text input — label above, hairline border, blue focus ring,
 * inline error in critical magenta. Pass `as="textarea"` for a
 * multi-line field.
 */
export function Input({
  label,
  hint,
  error,
  as = 'input',
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useMemo(() => id || 'lh-in-' + Math.random().toString(36).slice(2, 7), [id]);
  const Tag = as === 'textarea' ? 'textarea' : 'input';

  const field = React.createElement(Tag, {
    id: autoId,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--fs-body)',
      color: 'var(--tes-ink)',
      background: '#fff',
      border: '1px solid ' + (error ? 'var(--status-critical)' : (focus ? 'var(--tes-blue)' : 'var(--border-input)')),
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      outline: 'none',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      transition: 'border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
      resize: as === 'textarea' ? 'vertical' : undefined,
      minHeight: as === 'textarea' ? '88px' : undefined,
      ...style,
    },
    ...rest,
  });

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    label != null
      ? React.createElement('label', {
          htmlFor: autoId,
          style: { fontSize: '13px', fontWeight: 600, color: 'var(--text-body)' },
        }, label)
      : null,
    field,
    error != null
      ? React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--status-critical)' } }, error)
      : (hint != null
          ? React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--text-muted)' } }, hint)
          : null)
  );
}
