'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Palette, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '../primitives/controls';
import { cx } from '../cx';
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

const LS_COLLAPSED = 'ps_sidebar_collapsed';
/** Which group headings the user has folded away. Persisted like every other appearance choice. */
const LS_CLOSED_GROUPS = 'ps_nav_closed_groups';

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

  // Collapsed state is persisted like the other appearance choices — someone who
  // wants the extra 180px of content width wants it on every visit, not just
  // until the next reload.
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Group headings the user has folded away.
   *
   * Stored by LABEL rather than by index, so adding a group — or reordering them, which
   * `GROUP_ORDER` has already done once — does not silently fold a different section than the one
   * the user closed.
   *
   * Everything starts open. A nav that remembers a collapsed state is helpful; a nav that hides
   * sections on a first visit is a product that looks like it has fewer features than it has.
   */
  const [closedGroups, setClosedGroups] = useState<string[]>([]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(LS_COLLAPSED) === '1');
      const saved = localStorage.getItem(LS_CLOSED_GROUPS);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        /* Validated, not trusted. This value is user-editable, and a malformed one must not take
           the whole shell down on boot — the nav is the only way out of a broken page. */
        if (Array.isArray(parsed)) {
          setClosedGroups(parsed.filter((g): g is string => typeof g === 'string'));
        }
      }
    } catch {
      /* private mode, or unparseable — everything open, which is the safe default */
    }
  }, []);

  const toggleGroup = (label: string) => {
    setClosedGroups((prev) => {
      const next = prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label];
      try {
        localStorage.setItem(LS_CLOSED_GROUPS, JSON.stringify(next));
      } catch {
        /* preference still applies for this session */
      }
      return next;
    });
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_COLLAPSED, next ? '1' : '0');
      } catch {
        /* preference still applies for this session */
      }
      return next;
    });
  };

  return (
    <div className={cx('ds-shell', collapsed && 'ds-shell--collapsed')}>
      <Sidebar
        nav={nav}
        active={active}
        onNavigate={onNavigate}
        brand={brand}
        footer={footer}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        closedGroups={closedGroups}
        onToggleGroup={toggleGroup}
      />
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
  collapsed,
  onToggleCollapsed,
  closedGroups,
  onToggleGroup,
}: Pick<AppShellProps, 'nav' | 'active' | 'onNavigate' | 'brand' | 'footer'> & {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  closedGroups: string[];
  onToggleGroup: (label: string) => void;
}) {
  return (
    <nav className="ds-sidebar" aria-label="Main">
      <div className="ds-sidebar__brand">
        {brand.mark}
        {/* The lockup is hidden rather than unmounted when collapsed, so the
            sidebar's height and the nav's scroll position do not jump. */}
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div className="ds-sidebar__brand-name">{brand.name}</div>
            {brand.sub && <div className="ds-sidebar__brand-sub">{brand.sub}</div>}
          </div>
        )}
      </div>
      <div className="ds-sidebar__nav">
        {nav.map((group, gi) => {
          /* A group with no heading cannot be collapsed — there would be nothing to click, and
             nothing to label the control with. */
          const collapsible = Boolean(group.label) && !collapsed;
          const isOpen = !group.label || collapsed || !closedGroups.includes(group.label);

          return (
            <div key={group.label ?? `group-${gi}`}>
              {/* The heading becomes the control. It was a <div>, which is why this could not be
                  done before without also fixing the semantics: a section that hides content has
                  to be a button, carry `aria-expanded`, and name the region it controls. */}
              {collapsible && group.label && (
                <button
                  type="button"
                  className="ds-sidebar__group ds-sidebar__group--toggle"
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${gi}`}
                  onClick={() => onToggleGroup(group.label as string)}
                >
                  <ChevronDown
                    size={12}
                    strokeWidth={2.5}
                    aria-hidden="true"
                    className="ds-sidebar__group-chevron"
                    style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }}
                  />
                  <span>{group.label}</span>
                </button>
              )}
              {/* Collapsed to the icon rail, the heading is meaningless and the items must stay
                  reachable — so the whole collapse behaviour is suspended rather than stacked on
                  top of a rail that is already minimal. */}
              {group.label && collapsed && <div className="ds-sidebar__group" />}

              <div id={`nav-group-${gi}`} hidden={!isOpen}>
                {group.items.map((item) => {
                  const isActive = item.id === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cx('ds-nav-item', isActive && 'ds-nav-item--active')}
                      // The accessible name is the label; `aria-current` is what
                      // conveys "you are here", not the colour of the accent bar.
                      aria-current={isActive ? 'page' : undefined}
                      // Collapsed, the label is visually hidden but still read out —
                      // and `title` gives sighted users a hover tooltip, without
                      // which an icon-only rail is a guessing game.
                      title={collapsed ? item.label : undefined}
                      onClick={() => onNavigate(item.id)}
                    >
                      {item.icon}
                      <span className="ds-nav-item__label" style={{ flex: '1 1 auto', minWidth: 0 }}>
                        {item.label}
                      </span>
                      {item.badge != null && !collapsed && (
                        <span className="ds-badge">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ds-sidebar__footer">
        {!collapsed && footer}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={
            collapsed ? (
              <PanelLeftOpen size={17} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden="true" />
            )
          }
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        </Button>
      </div>
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
