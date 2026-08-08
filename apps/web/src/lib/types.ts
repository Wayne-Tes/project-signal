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
  prev: number;
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
  to: (i: number) => void;
  close: () => void;
}

/* `TweakValues` lived here. It described the prototype Tweaks panel — runtime
   palette and font pickers — which the design system replaced. Theme, sidebar
   and highlight colour are now real persisted settings typed in
   `design-system/personalisation.ts`, so this interface had no remaining
   referent and was removed rather than left as a type nobody constructs. */
