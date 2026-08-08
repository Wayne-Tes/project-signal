import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Badge } from '../core/Badge.jsx';

function IconButton({ children, onClick, title, badge }) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    onClick, title, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: { position: 'relative', width: '40px', height: '40px', borderRadius: 'var(--radius-md)', border: '1px solid var(--tes-n-200)', background: hover ? 'var(--tes-n-100)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background .14s', flex: 'none' },
  }, children, badge != null ? React.createElement('span', {
    style: { position: 'absolute', top: '-5px', right: '-5px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '999px', background: '#C9275E', color: '#fff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' },
  }, badge) : null);
}

/**
 * TopBar — the glassy sticky top bar: page title, ⌘K search, the
 * Appearance popover (sidebar Light/Navy + accent), notification bell
 * and the user/scope pill. Appearance handlers are controlled by the
 * shell so the choice applies app-wide.
 */
export function TopBar({ title, navy = false, accent = '#9FCB3B', onSidebar, onAccent, accentOptions = ['#9FCB3B', '#2B7DC4', '#3FB6A8', '#E8843C', '#6B4E9E'], notifications = 2, user = { name: 'dev-admin', scope: 'all scope', initial: 'D' } }) {
  const [appr, setAppr] = React.useState(false);
  const segBtn = (on) => ({ flex: 1, textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 700, padding: '7px 0', borderRadius: '8px', cursor: 'pointer', border: 'none', background: on ? '#fff' : 'transparent', color: on ? 'var(--tes-ink)' : 'var(--tes-n-500)', boxShadow: on ? 'var(--shadow-xs)' : 'none' });

  return React.createElement('header', { style: { position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: '18px', padding: '0 36px', height: 'var(--topbar-h)', background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--tes-n-200)', flex: 'none' } },
    React.createElement('h1', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '20px', color: 'var(--tes-ink)', margin: 0, letterSpacing: '-.01em' } }, title),
    React.createElement('div', { style: { flex: '1 1 auto' } }),
    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '9px', background: 'var(--tes-n-100)', border: '1px solid transparent', borderRadius: 'var(--radius-md)', padding: '8px 12px', width: '280px' } },
      React.createElement(Icon, { name: 'search', size: 17, stroke: 'var(--tes-n-500)', strokeWidth: 1.9 }),
      React.createElement('input', { placeholder: 'Search accounts, tasks…', style: { border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--tes-ink)', flex: '1 1 auto', minWidth: 0 } }),
      React.createElement('kbd', { style: { fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, color: 'var(--tes-n-500)', background: '#fff', border: '1px solid var(--tes-n-200)', borderRadius: '5px', padding: '1px 6px' } }, '⌘K')
    ),
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement(IconButton, { title: 'Appearance', onClick: () => setAppr(v => !v) }, React.createElement(Icon, { name: 'palette', stroke: 'var(--tes-slate)' })),
      appr ? React.createElement('div', { style: { position: 'absolute', top: '48px', right: 0, width: '236px', background: '#fff', border: '1px solid var(--tes-n-200)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '16px', zIndex: 40 } },
        React.createElement('div', { style: { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--tes-n-500)', marginBottom: '11px' } }, 'Appearance'),
        React.createElement('div', { style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--tes-n-600)', marginBottom: '7px' } }, 'Sidebar'),
        React.createElement('div', { style: { display: 'flex', gap: '4px', background: 'var(--tes-n-100)', borderRadius: '10px', padding: '3px', marginBottom: '16px' } },
          React.createElement('button', { onClick: () => onSidebar && onSidebar('light'), style: segBtn(!navy) }, 'Light'),
          React.createElement('button', { onClick: () => onSidebar && onSidebar('navy'), style: segBtn(navy) }, 'Navy')
        ),
        React.createElement('div', { style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--tes-n-600)', marginBottom: '9px' } }, 'Accent colour'),
        React.createElement('div', { style: { display: 'flex', gap: '11px' } },
          accentOptions.map(c => React.createElement('button', { key: c, onClick: () => onAccent && onAccent(c), style: { width: '26px', height: '26px', borderRadius: '999px', background: c, cursor: 'pointer', border: '2px solid #fff', boxShadow: accent.toLowerCase() === c.toLowerCase() ? ('0 0 0 2px ' + c) : '0 0 0 1px var(--tes-n-300)' } }))
        )
      ) : null
    ),
    React.createElement(IconButton, { badge: notifications != null ? String(notifications) : null }, React.createElement(Icon, { name: 'bell', stroke: 'var(--tes-slate)' })),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px 5px 5px', border: '1px solid var(--tes-n-200)', borderRadius: 'var(--radius-md)', background: '#fff' } },
      React.createElement(Avatar, { initial: user.initial, size: 28, radius: 7 }),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--tes-slate)', fontWeight: 600 } },
        React.createElement('span', null, user.name),
        React.createElement(Badge, { tone: 'info' }, user.scope)
      ),
      React.createElement(Icon, { name: 'chevronDown', size: 15, stroke: 'var(--tes-n-500)', strokeWidth: 1.9 })
    )
  );
}
