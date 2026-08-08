'use client';

import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { NavActions, NavLevel } from '@/lib/types';
import { AppShell, Badge, Button, Row } from '@/design-system';
import { allowedViews, navForRole, type ViewId } from '@/config/navigation';
import { DrillDown } from './DrillDown';
import { useBrand } from '@/lib/brand-context';
import { useAuth } from '@/lib/auth';
import { Dashboard } from '@/views/Dashboard';
import { TrendsView } from '@/views/Trends';
import { BrandImpactView } from '@/views/BrandImpact';
import { RoadmapView } from '@/views/Roadmap';
import { CompetitorsView } from '@/views/Competitors';
import { ReportView } from '@/views/Report';
import { AdminView } from '@/views/Admin';

/**
 * The application root.
 *
 * All chrome — sidebar, top bar, Appearance — comes from the design system's
 * AppShell. This component's remaining job is genuinely its own: which view is
 * active, the drill-down path, and the brand/identity context the shell renders
 * in its slots.
 *
 * The previous version hand-rolled the rail, the brand switcher, the top bar and
 * a Tweaks panel that could restyle the app at runtime. That panel is gone: its
 * palette and font pickers were a prototyping affordance, and the parts worth
 * keeping — theme, sidebar and highlight colour — are now real, persisted user
 * settings in the shell's Appearance popover.
 */
export function App() {
  const { user, role, signOut } = useAuth();
  const { selected: selectedBrand } = useBrand();

  const [view, setView] = useState<ViewId>('dashboard');
  const [path, setPath] = useState<NavLevel[]>([]);

  const nav = useMemo(
    () => navForRole(role),
    // Recomputing on role change is the point: the Admin item appears and
    // disappears with it.
    [role],
  );

  // A role change can strip the active view out from under the user — an admin
  // demoted while sitting on the Admin page. Falling back keeps them on a page
  // they can actually see rather than rendering an empty shell.
  const permitted = allowedViews(role);
  const activeView: ViewId = permitted.includes(view) ? view : 'dashboard';

  const drill: NavActions = useMemo(
    () => ({
      openOverview: () => setPath([{ kind: 'overview' }]),
      openDimension: (dimKey) =>
        setPath((p) =>
          p.length && p[0]?.kind === 'overview'
            ? [...p, { kind: 'dimension', dimKey }]
            : [{ kind: 'dimension', dimKey }],
        ),
      openCluster: (clusterId, dimKey) =>
        setPath((p) => {
          const base = p.filter((l) => l.kind !== 'cluster');
          const hasDim = base.some(
            (l) =>
              l.kind === 'dimension' &&
              (l as { kind: 'dimension'; dimKey: string }).dimKey === dimKey,
          );
          const stack = hasDim
            ? base
            : [...(base.length ? base : []), { kind: 'dimension' as const, dimKey }];
          return [...stack, { kind: 'cluster' as const, clusterId }];
        }),
      to: (i) => setPath((p) => p.slice(0, i + 1)),
      close: () => setPath([]),
    }),
    [],
  );

  return (
    <AppShell
      nav={nav}
      active={activeView}
      onNavigate={(id) => setView(id as ViewId)}
      brand={{
        name: 'Project Signal',
        // The tenant's selected brand, not a fictional label. `brand_entities`
        // has no category column, so this reports what the row actually says.
        sub: selectedBrand
          ? `${selectedBrand.name} · ${selectedBrand.isOwned ? 'Owned brand' : 'Competitor'}`
          : 'No brand selected',
      }}
      actions={role ? <Badge tone="info">{role}</Badge> : null}
      footer={
        <Row gap="var(--s-2)">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--side-item)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.email ?? 'Signed in'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<LogOut size={17} strokeWidth={1.8} aria-hidden="true" />}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </Row>
      }
    >
      <div className="ds-content">
        {activeView === 'dashboard' && <Dashboard nav={drill} />}
        {activeView === 'trends' && <TrendsView nav={drill} />}
        {activeView === 'brand-impact' && <BrandImpactView nav={drill} />}
        {activeView === 'roadmap' && <RoadmapView nav={drill} />}
        {activeView === 'competitors' && <CompetitorsView />}
        {activeView === 'report' && <ReportView />}
        {activeView === 'admin' && <AdminView />}
      </div>

      {path.length > 0 && <DrillDown path={path} nav={drill} />}
    </AppShell>
  );
}
