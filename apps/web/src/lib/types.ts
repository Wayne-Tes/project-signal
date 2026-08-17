export interface Brand {
  name: string;
  tagline: string;
  category: string;
  score: number;
  prevScore: number;
  scoreLabel: string;
  period: string;
  signalsThisWeek: number;
  signalsPrevWeek: number;
  sourcesActive: number;
}

export interface Dimension {
  key: string;
  label: string;
  score: number;
  /**
   * The same dimension at the comparison date, or **null when there is no comparison**.
   *
   * Nullable deliberately, and this is not a nicety. It was `number`, and every caller satisfied
   * the type with `d.previous ?? d.score` — comparing the dimension against ITSELF. So every bar
   * on the dashboard rendered a confident green `▲ +0`, permanently, for every brand, regardless
   * of history. Not "no movement yet": a fabricated comparison that could never show movement.
   *
   * Making it nullable moves the decision to the renderer, where "we have nothing to compare
   * against" can be SAID rather than silently rounded to zero.
   */
  prev: number | null;
  weight: number;
  blurb: string;
}

// A type alias, not an interface: TypeScript gives aliases an implicit index signature, which
// is what makes these rows assignable to the charts' structural `ChartRow`. Still consumed by
// the views that remain on mock data (Dashboard, DrillDown).
export type HistoryRow = {
  date: Date;
  label: string;
  trust: number;
  quality: number;
  service: number;
  value: number;
  experience: number;
  score: number;
};

export interface VolumeData {
  sources: string[];
  weeks: Array<Record<string, number | string>>;
}

export interface Source {
  label: string;
  short: string;
  tone: string;
}

export interface Cluster {
  id: string;
  title: string;
  sentiment: number;
  volume: number;
  damage: number;
  recency: number;
  trend: number;
  summary: string;
  mix: Record<string, number>;
  dimension?: string;
  dimensionLabel?: string;
  dimKey?: string;
}

export interface Signal {
  source: string;
  author: string;
  rating: number | null;
  when: string;
  date: string;
  sentiment: number;
  confidence: number;
  text: string;
  topics: string[];
}

export interface RoadmapItem {
  id: string;
  priority: string;
  title: string;
  dimension: string;
  impact: number;
  effort: string;
  confidence: number;
  evidence: string[];
  desc: string;
  why: string;
}

export interface Competitor {
  name: string;
  score: number;
  prev: number;
  you?: boolean;
}

export interface Alert {
  active: boolean;
  metric: string;
  delta: number;
  window: string;
  when: string;
  cluster: string;
  detail: string;
}

export type NavLevel =
  | { kind: 'overview' }
  | { kind: 'dimension'; dimKey: string }
  | { kind: 'cluster'; clusterId: string };

export interface NavActions {
  openOverview: () => void;
  openDimension: (dimKey: string) => void;
  openCluster: (clusterId: string, dimKey: string) => void;
  /**
   * Opens a topic directly, with no dimension above it.
   *
   * `openCluster` always inserts a dimension level, because it is called from inside a
   * dimension's drill-down and the route the user took is what the stacked spines show. The
   * "What's changed" view has no such context — a subject there is ranked by how it moved, not by
   * which dimension it belongs to — and passing a fabricated dimension would put a step in the
   * breadcrumb the user never walked through.
   */
  openTopic: (clusterId: string) => void;
  to: (i: number) => void;
  close: () => void;
}

/* `TweakValues` lived here. It described the prototype Tweaks panel — runtime
   palette and font pickers — which the design system replaced. Theme, sidebar
   and highlight colour are now real persisted settings typed in
   `design-system/personalisation.ts`, so this interface had no remaining
   referent and was removed rather than left as a type nobody constructs. */
