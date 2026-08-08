import React from 'react';
import { Icon } from '../core/Icon.jsx';

/**
 * Fab — the persistent assistant floating action button, bottom-right.
 * Opens the Lighthouse assistant; present on every route.
 */
export function Fab({ icon = 'robot', onClick, title = 'Ask Lighthouse', style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    onClick, title,
    onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: {
      position: 'fixed', bottom: '26px', right: '26px', width: '54px', height: '54px',
      borderRadius: '999px', border: 'none', background: hover ? 'var(--tes-ink)' : 'var(--tes-navy)',
      boxShadow: 'var(--shadow-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', zIndex: 30, transition: 'background var(--dur) var(--ease)', ...style,
    },
    ...rest,
  }, React.createElement(Icon, { name: icon, size: 24, stroke: '#fff' }));
}
