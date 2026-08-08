'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Palette } from 'lucide-react';
import { Button } from '../primitives/controls';
import { AppearanceControls } from './AppearanceControls';

/**
 * The application chrome: sidebar + sticky top bar + Appearance popover.
 *
 * NAVIGATION IS DATA, NOT MARKUP. The shell renders whatever `nav` it is given,
 * so adding a route is a line in a config array — no edit here, and no page
 * hardcodes its own chrome. Roles are filtered by the caller, which keeps
 * authorisation logic out of a presentational component.
 */

export interface NavItem {
  /** Stable id — also the value compared against `active`. */
  id: string;
  label: string;
  icon: ReactNode;
  /** Optional count/indicator rendered on the right. */
  badge?: string | number;
}

export interface NavGroup {
  /** Group heading. Omit for an ungrouped block at the top. */
  label?: string;
  items: NavItem[];
}

export interface AppShellProps {
  nav: NavGroup[];
  active: string;
  onNavigate: (id: string) => void;
  /** Brand lockup — name plus an optional context line (e.g. the tenant). */
  brand: { name: string; sub?: string; mark?: ReactNode };
  /** Title shown in the top bar. Defaults to the active item's label. */
  title?: string;
  /** Top-bar actions, left of the Appearance button. */
  actions?: ReactNode;
  /** Rendered at the bottom of the sidebar — user identity, sign out. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  nav,
  active,
  onNavigate,
  brand,
  title,
  actions,
  footer,
  children,
}: AppShellProps) {
  const activeLabel = nav.flatMap((g) => g.items).find((i) => i.id === active)?.label;

  return (
    <div className="ds-shell">
      <Sidebar nav={nav} active={active} onNavigate={onNavigate} brand={brand} footer={footer} />
      <main className="ds-main">
        <TopBar title={title ?? activeLabel ?? ''} actions={actions} />
        {children}
      </main>
    </div>
  );
}

/* ---------- Sidebar ---------------------------------------------------- */

function Sidebar({
  nav,
  active,
  onNavigate,
  brand,
  footer,
}: Pick<AppShellProps, 'nav' | 'active' | 'onNavigate' | 'brand' | 'footer'>) {
  return (
    <nav className="ds-sidebar" aria-label="Main">
      <div className="ds-sidebar__brand">
        {brand.mark}
        <div style={{ minWidth: 0 }}>
          <div className="ds-sidebar__brand-name">{brand.name}</div>
          {brand.sub && <div className="ds-sidebar__brand-sub">{brand.sub}</div>}
        </div>
      </div>

      <div className="ds-sidebar__nav">
        {nav.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`}>
            {group.label && <div className="ds-sidebar__group">{group.label}</div>}
            {group.items.map((item) => {
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`ds-nav-item${isActive ? 'ds-nav-item--active' : ''}`}
                  // The accessible name is the label; `aria-current` is what
                  // conveys "you are here", not the colour of the accent bar.
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  {item.icon}
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>{item.label}</span>
                  {item.badge != null && <span className="ds-badge">{item.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {footer && <div className="ds-sidebar__footer">{footer}</div>}
    </nav>
  );
}

/* ---------- Top bar ----------------------------------------------------- */

function TopBar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="ds-topbar">
      <h2 className="ds-topbar__title">{title}</h2>
      <div className="ds-row">
        {actions}
        <AppearanceMenu />
      </div>
    </header>
  );
}

/* ---------- Appearance popover ------------------------------------------ */

/**
 * The palette button and its popover.
 *
 * Dismissal is handled explicitly — click outside and Escape both close it, and
 * focus returns to the trigger. A popover that traps focus or can only be
 * closed by clicking the button again is a keyboard dead end.
 */
function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Button
        ref={triggerRef}
        variant="secondary"
        iconOnly
        icon={<Palette size={19} strokeWidth={1.8} aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Appearance settings
      </Button>

      {open && (
        <div className="ds-popover" role="dialog" aria-label="Appearance">
          <div className="ds-eyebrow" style={{ marginBottom: 'var(--s-4)' }}>
            Appearance
          </div>
          <AppearanceControls />
        </div>
      )}
    </div>
  );
}
