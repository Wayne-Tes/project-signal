import React from 'react';

/**
 * Avatar — a rounded-square gradient tile with initials. The default
 * gradient is the Tes blue→purple lockup; pass `gradient` for a
 * mosaic pairing (e.g. risk = magenta→orange).
 */
export function Avatar({
  name,
  initial,
  size = 38,
  gradient = 'linear-gradient(135deg,#2B7DC4,#6B4E9E)',
  radius,
  style,
  ...rest
}) {
  const letter = (initial || (name ? name.trim()[0] : '?') || '?').toUpperCase();
  const r = radius != null ? radius : Math.round(size * 0.26);
  return React.createElement(
    'div',
    {
      title: name,
      style: {
        width: size,
        height: size,
        borderRadius: r,
        background: gradient,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-body)',
        fontWeight: 700,
        fontSize: Math.round(size * 0.38),
        flex: 'none',
        ...style,
      },
      ...rest,
    },
    letter
  );
}
