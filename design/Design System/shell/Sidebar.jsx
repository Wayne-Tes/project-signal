import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { MosaicMark } from '../brand/MosaicMark.jsx';

/** Default Lighthouse navigation — pass your own `nav` to reuse the
 *  shell for another product. */
export const LIGHTHOUSE_NAV = {
  workspace: [
    { id: 'Home', icon: 'home' }, { id: 'Inbox', icon: 'inbox', badge: '3', badgeColor: '#2B7DC4' },
    { id: 'Health', icon: 'health' }, { id: 'Sector radar', icon: 'radar' },
    { id: 'Champion watch', icon: 'champion' }, { id: 'Tasks', icon: 'tasks', badge: '13', badgeColor: '#E8843C' },
    { id: 'Triage', icon: 'triage' }, { id: 'Playbooks', icon: 'playbooks' },
    { id: 'Impact ledger', icon: 'ledger' }, { id: 'Opportunities', icon: 'opportunities' },
    { id: 'Meetings', icon: 'meetings' }, { id: 'Skills', icon: 'skills' },
    { id: 'Chat', icon: 'chat' }, { id: 'Reports', icon: 'reports' },
  ],
  admin: [{ id: 'Jobs', icon: 'jobs' }, { id: 'Design library', icon: 'design' }],
};

function NavItem({ item, active, accent, navy, onClick }) {
  const [hover, setHover] = React.useState(false);
  const th = navy
    ? { item: 'rgba(255,255,255,.74)', icon: 'rgba(255,255,255,.55)', activeBg: 'rgba(255,255,255,.10)', activeText: '#fff', hoverBg: 'rgba(255,255,255,.06)' }
    : { item: '#5b616e', icon: '#8b909c', activeBg: accent + '24', activeText: 'var(--tes-ink)', hoverBg: '#f4f5f7' };
  return React.createElement('div', {
    onClick, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 12px', margin: '1px 12px',
      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '14px',
      fontWeight: active ? 700 : 500, color: active ? th.activeText : (hover ? th.activeText : th.item),
      background: active ? th.activeBg : (hover ? th.hoverBg : 'transparent'),
      boxShadow: active ? ('inset 3px 0 0 ' + accent) : 'none', transition: 'background .14s, color .14s', userSelect: 'none',
    },
  },
    React.createElement(Icon, { name: item.icon, stroke: active ? accent : th.icon }),
    React.createElement('span', { style: { flex: '1 1 auto', whiteSpace: 'nowrap' } }, item.label || item.id),
    item.badge ? React.createElement('span', { style: { fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 700, color: '#fff', background: item.badgeColor || '#C9275E', borderRadius: '999px', padding: '1px 7px', lineHeight: '16px' } }, item.badge) : null
  );
}

export function Sidebar({ nav = LIGHTHOUSE_NAV, active, onNav, navy = false, accent = '#9FCB3B', user = { name: 'dev-admin', scope: 'All scope · Tes Global', initial: 'D' }, brand = 'Lighthouse', brandSub = 'by Tes' }) {
  const th = navy
    ? { bg: '#2A2F3D', border: '1px solid rgba(255,255,255,.08)', brand: '#fff', sub: 'rgba(255,255,255,.55)', group: 'rgba(255,255,255,.42)', userBg: 'rgba(255,255,255,.04)' }
    : { bg: '#fff', border: '1px solid var(--tes-n-200)', brand: 'var(--tes-ink)', sub: 'var(--tes-n-500)', group: 'var(--tes-n-400)', userBg: 'var(--tes-n-50)' };
  const groups = [['WORKSPACE', nav.workspace || []], ['ADMIN', nav.admin || []]].filter(g => g[1].length);

  return React.createElement('aside', { style: { width: 'var(--sidebar-w)', flex: 'none', height: '100vh', display: 'flex', flexDirection: 'column', background: th.bg, borderRight: th.border } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '11px', padding: '20px 20px 18px' } },
      React.createElement(MosaicMark, { size: 32 }),
      React.createElement('div', { style: { lineHeight: 1.05 } },
        React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', letterSpacing: '-.01em', color: th.brand } }, brand),
        React.createElement('div', { style: { fontSize: '11px', fontWeight: 600, color: th.sub, marginTop: '1px' } }, brandSub)
      )
    ),
    React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto', paddingBottom: '8px' } },
      groups.map(([label, items], gi) => React.createElement(React.Fragment, { key: label },
        React.createElement('div', { style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.08em', color: th.group, padding: gi === 0 ? '14px 24px 7px' : '18px 24px 7px' } }, label),
        items.map(it => React.createElement(NavItem, { key: it.id, item: it, active: active === it.id, accent, navy, onClick: () => onNav && onNav(it.id) }))
      ))
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', margin: '8px 12px 12px', borderRadius: 'var(--radius-lg)', background: th.userBg, border: th.border, cursor: 'pointer' } },
      React.createElement(Avatar, { initial: user.initial, size: 34 }),
      React.createElement('div', { style: { lineHeight: 1.2, flex: '1 1 auto', minWidth: 0 } },
        React.createElement('div', { style: { fontWeight: 700, fontSize: '13.5px', color: th.brand } }, user.name),
        React.createElement('div', { style: { fontSize: '11.5px', color: th.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, user.scope)
      ),
      React.createElement(Icon, { name: 'chevronDown', size: 16, stroke: th.sub })
    )
  );
}
