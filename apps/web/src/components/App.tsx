'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleHelp, Download, LogOut, Sparkles } from 'lucide-react';
import type { NavActions, NavLevel } from '@/lib/types';
import { AppShell, Badge, Button, Row, useAppearance } from '@/design-system';
import { allowedViews, navForRole, type ViewId } from '@/config/navigation';
import { DrillDown } from './DrillDown';
import { useBrand } from '@/lib/brand-context';
import { useAuth } from '@/lib/auth';
import { PS_BRAND } from '@/lib/data';
import { Dashboard } from '@/views/Dashboard';
import { TrendsView } from '@/views/Trends';
import { BrandImpactView } from '@/views/BrandImpact';
import { RoadmapView } from '@/views/Roadmap';
import { CompetitorsView } from '@/views/Competitors';
import { ReportView } from '@/views/Report';
import { AdminView } from '@/views/Admin';
import { HelpCentre } from '@/features/help/HelpCentre';
import { AssistantDock } from '@/features/assistant/AssistantDock';
import { Tour, hasSeenTour } from '@/features/tour/Tour';

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
  const { hero, animate } = useAppearance();

  const [view, setView] = useState<ViewId>('dashboard');
  const [path, setPath] = useState<NavLevel[]>([]);

  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSlug, setHelpSlug] = useState<string | undefined>();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  /* The tour offers itself once, to a genuinely new user. Deferred to an effect rather than
     computed during render because `hasSeenTour` reads localStorage, which does not exist
     during the server pass and would make the first client render disagree with it. */
  useEffect(() => {
    if (!hasSeenTour()) setTourOpen(true);
  }, []);

  const openArticle = (slug: string): void => {
    setHelpSlug(slug);
    setHelpOpen(true);
  };

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
      actions={
        <>
          {/* Period. Reads PS_BRAND, the prototype's mock data — the API exposes
              no reporting window yet. STUB: docs/STUBS.md #3. */}
          <span className="ds-eyebrow">{PS_BRAND.period}</span>

          {role ? <Badge tone="info">{role}</Badge> : null}

          {/* STUB: never had a handler, in the prototype or now. Left visible and
              disabled rather than removed — docs/STUBS.md #1. */}
          <Button
            variant="ghost"
            disabled
            title="Export is not implemented yet"
            icon={<Download size={17} strokeWidth={1.8} aria-hidden="true" />}
          >
            Export
          </Button>

          {/* Help and the assistant sit in the top bar on EVERY view, because both answer
              questions that arise while looking at something. Moving either into a settings
              menu is how a help system stops being used. */}
          <span data-tour="help">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<CircleHelp size={17} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => {
                setHelpSlug(undefined);
                setHelpOpen(true);
              }}
            >
              Help
            </Button>
          </span>

          <span data-tour="assistant">
            <Button
              variant="secondary"
              size="sm"
              icon={<Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => setAssistantOpen(true)}
            >
              Ask
            </Button>
          </span>

          {activeView === 'report' ? (
            <Button variant="primary" onClick={() => window.print()}>
              Download PDF
            </Button>
          ) : (
            // The only entry point to the top-level drill-down. Removing it made
            // DrillDown reachable only by clicking into a dimension or cluster.
            <span data-tour="drill">
              <Button variant="primary" onClick={drill.openOverview}>
                Dig into score
              </Button>
            </span>
          )}
        </>
      }
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
        {activeView === 'dashboard' && (
          // key remounts the view so entrance animations replay when the hero
          // style or the animate preference changes — the prototype behaviour.
          <Dashboard
            key={`dashboard-${hero}-${animate}`}
            nav={drill}
            hero={hero === 'bars' ? 'Bars' : 'Radial gauge'}
          />
        )}
        {activeView === 'trends' && <TrendsView nav={drill} />}
        {activeView === 'brand-impact' && <BrandImpactView nav={drill} />}
        {activeView === 'roadmap' && <RoadmapView nav={drill} />}
        {activeView === 'competitors' && <CompetitorsView />}
        {activeView === 'report' && <ReportView />}
        {activeView === 'admin' && <AdminView />}
      </div>

      {path.length > 0 && <DrillDown path={path} nav={drill} />}

      <HelpCentre
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        view={activeView}
        initialSlug={helpSlug}
        onStartTour={() => {
          setHelpOpen(false);
          setTourOpen(true);
        }}
      />

      <AssistantDock
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        view={activeView}
        brandId={selectedBrand?.id}
        onOpenArticle={openArticle}
      />

      <Tour open={tourOpen} onClose={() => setTourOpen(false)} onOpenArticle={openArticle} />
    </AppShell>
  );
}
