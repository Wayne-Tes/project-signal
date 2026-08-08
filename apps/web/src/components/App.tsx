'use client';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { NavLevel, NavActions, TweakValues } from '@/lib/types';
import { PS_BRAND } from '@/lib/data';
import { DrillDown } from './DrillDown';
import { TweaksPanel, TweakSection, TweakSelect, TweakRadio, TweakToggle } from './TweaksPanel';
import { useBrand } from '@/lib/brand-context';
import { Dashboard } from '@/views/Dashboard';
import { TrendsView } from '@/views/Trends';
import { BrandImpactView } from '@/views/BrandImpact';
import { RoadmapView } from '@/views/Roadmap';
import { CompetitorsView } from '@/views/Competitors';
import { ReportView } from '@/views/Report';
import { AdminView } from '@/views/Admin';
import { useAuth } from '@/lib/auth';

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  trends: 'M3 17l5-6 4 4 7-9M21 6h-4M21 6v4',
  'brand-impact': 'M12 2l9 16H3z M12 9v4 M12 16v.5',
  roadmap: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  competitors: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  report: 'M6 2h9l5 5v15H6zM15 2v5h5M9 13h7M9 17h7',
  tweaks:
    'M12 3v1M12 20v1M4.2 6.2l.7.7M19.1 19.1l.7.7M3 12h1M20 12h1M4.2 17.8l.7-.7M19.1 4.9l.7-.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  admin: 'M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z M9 12l2 2 4-4',
};

function Ico({ d }: { d: string }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const PALETTES: Record<string, Record<string, string>> = {
  'Aurora (default)': {
    mint: '#5dcaa5',
    peri: '#afa9ec',
    sky: '#85b7eb',
    coral: '#e2725b',
    gold: '#d9b25f',
    bg: '#0b0c0f',
    'bg-2': '#101217',
    surface: '#14161c',
    'surface-2': '#191c24',
    'surface-3': '#20242e',
  },
  Signal: {
    mint: '#43d6a0',
    peri: '#7c8cf8',
    sky: '#5fb6f0',
    coral: '#ff6b5e',
    gold: '#e0a93c',
    bg: '#08090c',
    'bg-2': '#0d0f14',
    surface: '#11141a',
    'surface-2': '#161a22',
    'surface-3': '#1d222c',
  },
  'Graphite warm': {
    mint: '#7ec8a0',
    peri: '#c0a6e8',
    sky: '#8fb4e0',
    coral: '#e08a5e',
    gold: '#d9b25f',
    bg: '#0e0d0c',
    'bg-2': '#15130f',
    surface: '#1a1714',
    'surface-2': '#211d18',
    'surface-3': '#2a251f',
  },
  'Midnight ink': {
    mint: '#4fd1c5',
    peri: '#9f8cf0',
    sky: '#4d8ef0',
    coral: '#f56565',
    gold: '#ecc94b',
    bg: '#070a12',
    'bg-2': '#0b1020',
    surface: '#0f1626',
    'surface-2': '#141d30',
    'surface-3': '#1b273f',
  },
};

const FONTS: Record<string, { display: string; body: string; mono: string }> = {
  'Space Grotesk + Plex': {
    display: '"Space Grotesk", sans-serif',
    body: '"IBM Plex Sans", sans-serif',
    mono: '"IBM Plex Mono", monospace',
  },
  'Plex everywhere': {
    display: '"IBM Plex Sans", sans-serif',
    body: '"IBM Plex Sans", sans-serif',
    mono: '"IBM Plex Mono", monospace',
  },
  'Sora + Inter-ish': {
    display: '"Sora", sans-serif',
    body: '"IBM Plex Sans", sans-serif',
    mono: '"IBM Plex Mono", monospace',
  },
};

const NAV = [
  { id: 'dashboard', label: 'Dashboard', group: 'Brand' },
  { id: 'trends', label: 'Trends & history', group: 'Brand' },
  { id: 'brand-impact', label: 'Brand impact', group: 'Intelligence', badge: '3' },
  { id: 'roadmap', label: 'Action roadmap', group: 'Intelligence' },
  { id: 'competitors', label: 'Competitors', group: 'Intelligence' },
  { id: 'report', label: 'Weekly report', group: 'Delivery' },
];

const TITLES: Record<string, string> = {
  dashboard: 'Cadence',
  trends: 'Trends & history',
  'brand-impact': 'Brand impact',
  roadmap: 'Action roadmap',
  competitors: 'Competitive set',
  report: 'Weekly report',
  admin: 'Admin',
};

const TWEAK_DEFAULTS: TweakValues = {
  palette: 'Aurora (default)',
  fontPair: 'Space Grotesk + Plex',
  scoreAnim: 'Radial gauge',
  animate: true,
};

export function App() {
  const { user, role, signOut } = useAuth();
  const { selected: selectedBrand } = useBrand();
  const [tweaks, setTweaksState] = useState<TweakValues>(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [view, setView] = useState('dashboard');
  const [path, setPath] = useState<NavLevel[]>([]);

  const isAdmin = role === 'owner' || role === 'admin';

  const setTweak = <K extends keyof TweakValues>(key: K, value: TweakValues[K]) => {
    setTweaksState((prev) => ({ ...prev, [key]: value }));
  };

  const nav: NavActions = {
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
  };

  const pal = (PALETTES[tweaks.palette] ?? PALETTES['Aurora (default)'])!;
  const fp = (FONTS[tweaks.fontPair] ?? FONTS['Space Grotesk + Plex'])!;
  const rootStyle: CSSProperties = {
    '--mint': pal['mint'],
    '--peri': pal['peri'],
    '--sky': pal['sky'],
    '--coral': pal['coral'],
    '--gold': pal['gold'],
    '--bg': pal['bg'],
    '--bg-2': pal['bg-2'],
    '--surface': pal['surface'],
    '--surface-2': pal['surface-2'],
    '--surface-3': pal['surface-3'],
    '--font-display': fp['display'],
    '--font-body': fp['body'],
    '--font-mono': fp['mono'],
  } as CSSProperties;

  const navItems = isAdmin ? [...NAV, { id: 'admin', label: 'Admin', group: 'Admin' }] : NAV;

  const grouped = navItems.reduce<Record<string, typeof navItems>>((a, n) => {
    (a[n.group] = a[n.group] || []).push(n);
    return a;
  }, {});

  const play = tweaks.animate;

  return (
    <div style={rootStyle}>
      <div className="app">
        <aside className="rail">
          <div className="brandmark">
            <div className="logo">A</div>
            <div>
              <div className="wordmark">Project Signal</div>
              <div className="by">by Wayne Strydom</div>
            </div>
          </div>
          <div className="brand-switch">
            <div className="ava">{(selectedBrand?.name ?? '?').charAt(0).toUpperCase()}</div>
            <div className="meta">
              {/* Was hard-coded to a fictional brand. There is no "category" on brand_entities,
                  so the subtitle reports what the record actually says rather than inventing a
                  sector label. */}
              <div className="nm">{selectedBrand?.name ?? 'No brand'}</div>
              <div className="ct">
                {selectedBrand ? (selectedBrand.isOwned ? 'Owned brand' : 'Competitor') : '—'}
              </div>
            </div>
            <svg
              className="chev"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 9l4 4 4-4" />
            </svg>
          </div>
          {Object.entries(grouped).map(([g, items]) => (
            <div key={g}>
              <div className="nav-group-label">{g}</div>
              {items.map((n) => (
                <button
                  key={n.id}
                  className={`navitem ${view === n.id ? 'active' : ''}`}
                  onClick={() => setView(n.id)}
                >
                  <Ico d={ICONS[n.id] ?? ''} />
                  {n.label}
                  {'badge' in n && n.badge && <span className="badge">{n.badge}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="rail-foot">
            <div className="ava">{(user?.email ?? '?').slice(0, 2).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.email ?? 'Signed in'}
              </div>
              <div className="rl">{role ?? 'user'}</div>
            </div>
            <button
              className="btn ghost"
              onClick={() => void signOut()}
              aria-label="Sign out"
              style={{ marginLeft: 'auto' }}
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <h1>{TITLES[view]}</h1>
            {view === 'dashboard' && <span className="period mono">{PS_BRAND.tagline}</span>}
            <div className="spacer" />
            <span className="period">{PS_BRAND.period}</span>
            <button
              className="btn ghost"
              onClick={() => setTweaksOpen((o) => !o)}
              aria-label="Toggle tweaks"
            >
              <Ico d={ICONS['tweaks'] ?? ''} />
              Tweaks
            </button>
            {view === 'report' ? (
              <button className="btn primary" onClick={() => window.print()}>
                Download PDF
              </button>
            ) : (
              <>
                <button className="btn ghost">Export</button>
                <button className="btn primary" onClick={nav.openOverview}>
                  Dig into score
                </button>
              </>
            )}
          </header>

          {view === 'dashboard' && (
            <Dashboard key={`d${play}${tweaks.scoreAnim}`} nav={nav} hero={tweaks.scoreAnim} />
          )}
          {view === 'trends' && <TrendsView key={`t${play}`} nav={nav} />}
          {view === 'brand-impact' && <BrandImpactView nav={nav} />}
          {view === 'roadmap' && <RoadmapView nav={nav} />}
          {view === 'competitors' && <CompetitorsView key={`c${play}`} />}
          {view === 'report' && <ReportView />}
          {view === 'admin' && isAdmin && <AdminView />}
        </main>
      </div>

      <DrillDown path={path} nav={nav} />

      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)}>
        <TweakSection label="Palette" />
        <TweakSelect
          label="Theme"
          value={tweaks.palette}
          options={Object.keys(PALETTES)}
          onChange={(v) => setTweak('palette', v)}
        />
        <TweakSection label="Typography" />
        <TweakSelect
          label="Font pairing"
          value={tweaks.fontPair}
          options={Object.keys(FONTS)}
          onChange={(v) => setTweak('fontPair', v)}
        />
        <TweakSection label="Motion" />
        <TweakRadio
          label="Hero score"
          value={tweaks.scoreAnim}
          options={['Radial gauge', 'Bars']}
          onChange={(v) => setTweak('scoreAnim', v)}
        />
        <TweakToggle
          label="Animate on load"
          value={tweaks.animate}
          onChange={(v) => setTweak('animate', v)}
        />
      </TweaksPanel>
    </div>
  );
}
