import React from 'react';

/**
 * Lighthouse brand mark — a 3×3 grid of rounded mosaic squares.
 * Used in the sidebar lockup and the assistant avatar. Recreated
 * from the Tes brand; swap for the official vector when available.
 */
const MOSAIC = [
  '#6B4E9E', '#2B7DC4', '#3FB6A8',
  '#C9275E', '#9FCB3B', '#E8843C',
  '#3E4A9E', '#5FB573', '#F2C13D',
];

export function MosaicMark({ size = 32, gap, radius, style, ...rest }) {
  const s = size;
  const g = gap != null ? gap : Math.round(s * 0.085);   /* gap between tiles */
  const tile = (s - 2 * g) / 3;
  const rx = radius != null ? radius : tile * 0.28;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells.push(
        React.createElement('rect', {
          key: r * 3 + c,
          x: c * (tile + g),
          y: r * (tile + g),
          width: tile,
          height: tile,
          rx,
          fill: MOSAIC[r * 3 + c],
        })
      );
    }
  }
  return React.createElement(
    'svg',
    {
      width: s,
      height: s,
      viewBox: `0 0 ${s} ${s}`,
      style: { flex: 'none', display: 'block', ...style },
      'aria-label': 'Lighthouse',
      role: 'img',
      ...rest,
    },
    cells
  );
}
