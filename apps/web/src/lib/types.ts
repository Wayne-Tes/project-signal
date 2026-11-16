/*
 * Presentation types shared across the shell and the drill-down.
 *
 * This file used to also carry the shapes of the deleted mock-data fixture — `Brand`, `HistoryRow`,
 * `Cluster`, `Signal`, `RoadmapItem`, `Competitor`, `Alert` and friends — under a comment claiming
 * two views still rendered mock data. Neither was true: `lib/data.ts` was deleted (KNOWN-GAPS #13)
 * and every view reads the API through the shapes in `lib/brand-data.ts`. Types nothing constructs
 * are a trap for the next reader, so they were removed rather than left documenting fiction.
 */

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
