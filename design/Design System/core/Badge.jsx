import React from 'react';

/**
 * Badge / status pill — small tinted pill for status & severity.
 * Tones map to the status colour system; pass `mosaic` for a
 * categorical (non-semantic) hue instead.
 */
const TONES = {
  positive: { color: 'var(--status-positive)', bg: 'var(--status-positive-bg)' },
  info:     { color: 'var(--status-info)',     bg: 'var(--status-info-bg)' },
  warn:     { color: 'var(--status-warn)',     bg: 'var(--status-warn-bg)' },
  critical: { color: 'var(--status-critical)', bg: 'var(--status-critical-bg)' },
  neutral:  { color: 'var(--status-neutral)',  bg: 'var(--status-neutral-bg)' },
  teal:     { color: 'var(--status-teal)',     bg: 'var(--status-teal-bg)' },
};

/** Soften a hex to a light tint background. */
function tint(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},0.13)`;
}

export function Badge({ children, tone = 'neutral', mosaic, style, ...rest }) {
  const colors = mosaic
    ? { color: mosaic, bg: tint(mosaic) }
    : (TONES[tone] || TONES.neutral);

  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontFamily: 'var(--font-body)',
        fontSize: '11px',
        fontWeight: 700,
        lineHeight: 1.4,
        color: colors.color,
        background: colors.bg,
        padding: '3px 8px',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        ...style,
      },
      ...rest,
    },
    children
  );
}
