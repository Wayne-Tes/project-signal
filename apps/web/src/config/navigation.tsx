import {
  Activity,
  BarChart3,
  BookOpen,
  FileText,
  Gauge,
  ListChecks,
  MessagesSquare,
  Settings,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { NavGroup } from '@/design-system';
import type { Role } from '@/lib/auth';

/**
 * Application navigation, as DATA.
 *
 * The shell renders whatever it is given, so adding a route is a line in this
 * file — no edit to the shell, and no page describing its own chrome. Keeping
 * it out of the component also keeps the role filter testable on its own.
 *
 * Icons follow the design system's vocabulary: Lucide, 19px, 1.8 stroke.
 */

/** Nav ids are the route keys the shell compares against `active`. */
export type ViewId =
  | 'dashboard'
  | 'trends'
  | 'brand-impact'
  | 'whats-changed'
  | 'roadmap'
  | 'competitors'
  | 'report'
  | 'assistant'
  | 'documentation'
  | 'admin';

const ICON = { size: 19, strokeWidth: 1.8 } as const;

interface NavDef {
  id: ViewId;
  label: string;
  group: string;
  icon: React.ReactNode;
  /** Roles allowed to see the item. Omitted means everyone. */
  roles?: Role[];
}

/**
 * Sentence case throughout, per the design system's content rules — never Title
 * Case, and no emoji.
 */
const NAV: NavDef[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Brand', icon: <Gauge {...ICON} /> },
  { id: 'trends', label: 'Trends & history', group: 'Brand', icon: <TrendingUp {...ICON} /> },
  {
    id: 'brand-impact',
    label: 'Brand impact',
    group: 'Intelligence',
    icon: <Target {...ICON} />,
  },
  /* Directly after Brand impact, which is the "what is wrong" view — this is the "what moved"
     view, and the two are read together. */
  {
    id: 'whats-changed',
    label: "What's changed",
    group: 'Intelligence',
    icon: <Activity {...ICON} />,
  },
  {
    id: 'roadmap',
    label: 'Action roadmap',
    group: 'Intelligence',
    icon: <ListChecks {...ICON} />,
  },
  {
    id: 'competitors',
    label: 'Competitors',
    group: 'Intelligence',
    icon: <BarChart3 {...ICON} />,
  },
  { id: 'report', label: 'Weekly report', group: 'Delivery', icon: <FileText {...ICON} /> },
  /* The assistant and the documentation are reachable from the top bar on every view — that is
     where they answer a question raised by what you are looking at. These are the other half:
     places you go ON PURPOSE, to work through a conversation or to read. A pop-over cannot hold
     a chat history, and a slide-over is the wrong shape for reading documentation end to end. */
  {
    id: 'assistant',
    label: 'Assistant',
    group: 'Workspace',
    icon: <MessagesSquare {...ICON} />,
  },
  {
    id: 'documentation',
    label: 'Documentation',
    group: 'Workspace',
    icon: <BookOpen {...ICON} />,
  },
  {
    id: 'admin',
    label: 'Admin',
    group: 'Manage',
    icon: <Settings {...ICON} />,
    roles: ['owner', 'admin'],
  },
];

/** Group order is fixed here so a new item cannot reorder the sidebar. */
const GROUP_ORDER = ['Brand', 'Intelligence', 'Delivery', 'Workspace', 'Manage'];

/**
 * The nav for a given role.
 *
 * Hiding an item is presentation only — the API enforces authorisation
 * independently, and a `user` who types the admin route still gets a 403. This
 * exists so people are not shown doors they cannot open, not as a security
 * control.
 */
export function navForRole(role: Role): NavGroup[] {
  const visible = NAV.filter((item) => !item.roles || (role && item.roles.includes(role)));

  /* Any group NOT named in GROUP_ORDER is appended rather than dropped.

     Mapping over GROUP_ORDER alone means a nav item in an unlisted group vanishes silently: it
     is in NAV, it is in ViewId, its view renders when reached — and no user can ever reach it.
     That is exactly what happened when the Workspace group was added and GROUP_ORDER was not
     updated, and nothing failed except an e2e click that timed out with no clue as to why.
     Ordering stays explicit; only the failure mode changes, from invisible to merely last. */
  const ordered = [
    ...GROUP_ORDER,
    ...[...new Set(visible.map((i) => i.group))].filter((g) => !GROUP_ORDER.includes(g)),
  ];

  return ordered
    .map((label) => ({
      label,
      items: visible
        .filter((i) => i.group === label)
        .map((i) => ({ id: i.id, label: i.label, icon: i.icon })),
    }))
    .filter((g) => g.items.length > 0);
}

/** Every view id the current role may reach — used to validate the active view. */
export function allowedViews(role: Role): ViewId[] {
  return NAV.filter((item) => !item.roles || (role && item.roles.includes(role))).map((i) => i.id);
}
