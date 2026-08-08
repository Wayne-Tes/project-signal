import React from 'react';

/**
 * Icon — the Lighthouse thin-line icon set (1.8px stroke, rounded,
 * the Lucide vocabulary). `<Icon name="health" />`. Pass any path
 * set via `extraPaths` for one-off glyphs not in the map.
 */
export const ICON_PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9.5 21v-7h5v7'],
  inbox: ['M3 12h5l2 3h4l2-3h5', 'M5 5h14l2 7v7H3v-7z'],
  health: ['M3 12h4l2.5 7 4-15 2.5 8h5'],
  radar: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 12 21 5'],
  champion: ['M7 4h10v3a5 5 0 0 1-10 0z', 'M7 5H4v1.5a3 3 0 0 0 3 3', 'M17 5h3v1.5a3 3 0 0 1-3 3', 'M9.5 16h5', 'M11 12.5h2v3.5h-2z', 'M8 20h8'],
  tasks: ['M4 4h16v16H4z', 'M8 12l3 3 5-6'],
  triage: ['M12 3 2.5 20h19z', 'M12 9.5v5', 'M12 17.5v.3'],
  playbooks: ['M12 6c-2-1.4-5-1.4-8-1v12c3-.4 6-.4 8 1', 'M12 6c2-1.4 5-1.4 8-1v12c-3-.4-6-.4-8 1', 'M12 6v13'],
  ledger: ['M3 17l6-6 4 4 8-8', 'M17 7h4v4'],
  opportunities: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3'],
  meetings: ['M4 6h16v15H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  skills: ['M2 9l10-4 10 4-10 4z', 'M6 11v4.5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5V11', 'M22 9v5'],
  chat: ['M4 5h16v11H9l-4 4v-4H4z'],
  reports: ['M4 20V4', 'M4 20h16', 'M8 20v-6', 'M13 20v-10', 'M18 20v-4'],
  jobs: ['M4 7h16v13H4z', 'M9 7V5h6v2'],
  design: ['M12 3a9 9 0 1 0 0 18 2 2 0 0 0 0-4h2a4 4 0 0 0 4-4 6 6 0 0 0-6-6z', 'M7.5 12h.01', 'M10 8h.01', 'M14 8h.01'],
  search: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4-4'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6', 'M10 19a2 2 0 0 0 4 0'],
  palette: ['M12 3a9 9 0 1 0 0 18 2 2 0 0 0 0-4h2a4 4 0 0 0 4-4 6 6 0 0 0-6-6z', 'M7.5 12.5h.01', 'M10 8h.01', 'M14.5 8.5h.01'],
  plus: ['M12 5v14M5 12h14'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  sparkle: ['M12 3l1.6 4.8L18 9.4l-4.4 1.6L12 16l-1.6-5L6 9.4l4.4-1.6z', 'M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z'],
  chevronDown: ['M8 9l4 4 4-4'],
  robot: ['M4 8h16v11H4z', 'M12 8V5M9 13h.01M15 13h.01'],
  trendUp: ['M3 16l5-5 4 4 8-9', 'M16 6h5v5'],
  check: ['M5 12l5 5 9-10'],
  archive: ['M3 5h18v4H3z', 'M5 9v11h14V9', 'M10 13h4'],
  snooze: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2'],
};

export function Icon({ name, size = 19, stroke = 'currentColor', strokeWidth = 1.8, extraPaths, style, ...rest }) {
  const paths = extraPaths || ICON_PATHS[name] || [];
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flex: 'none', ...style }, 'aria-hidden': true, ...rest },
    paths.map((d, i) => React.createElement('path', { key: i, d }))
  );
}
