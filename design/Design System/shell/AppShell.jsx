import React from 'react';
import { Sidebar, LIGHTHOUSE_NAV } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import { Fab } from './Fab.jsx';

/**
 * AppShell — the whole Lighthouse chrome in one component: fixed light
 * (or navy) sidebar with a lime active accent, a glassy sticky top bar
 * with the Appearance popover, and the assistant FAB. Renders your
 * route content as `children` in the scrolling main column.
 *
 * Appearance (sidebar Light/Navy + accent colour) is a real user
 * setting: it persists to localStorage (lh_sidebar, lh_accent) and
 * applies app-wide. Pass `persistAppearance={false}` to opt out.
 */
export function AppShell({
  active,
  onNav,
  children,
  nav = LIGHTHOUSE_NAV,
  pageTitle,
  user = { name: 'dev-admin', scope: 'all scope', initial: 'D' },
  notifications = 2,
  persistAppearance = true,
  onAssistant,
}) {
  const [navy, setNavy] = React.useState(false);
  const [accent, setAccent] = React.useState('#9FCB3B');

  React.useEffect(() => {
    if (!persistAppearance) return;
    try {
      const s = localStorage.getItem('lh_sidebar');
      const a = localStorage.getItem('lh_accent');
      if (s === 'navy') setNavy(true);
      if (a) setAccent(a);
    } catch (e) {}
  }, [persistAppearance]);

  const chooseSidebar = (v) => { setNavy(v === 'navy'); if (persistAppearance) { try { localStorage.setItem('lh_sidebar', v); } catch (e) {} } };
  const chooseAccent = (c) => { setAccent(c); if (persistAppearance) { try { localStorage.setItem('lh_accent', c); } catch (e) {} } };

  const sidebarUser = { name: user.name, scope: user.scope === 'all scope' ? 'All scope · Tes Global' : user.scope, initial: user.initial };

  return React.createElement('div', {
    'data-sidebar': navy ? 'navy' : 'light',
    style: { display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--app-bg)', color: 'var(--text-body)' },
  },
    React.createElement(Sidebar, { nav, active, onNav, navy, accent, user: sidebarUser }),
    React.createElement('main', { style: { flex: '1 1 auto', height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
      React.createElement(TopBar, { title: pageTitle != null ? pageTitle : active, navy, accent, onSidebar: chooseSidebar, onAccent: chooseAccent, notifications, user }),
      children
    ),
    React.createElement(Fab, { onClick: onAssistant })
  );
}
