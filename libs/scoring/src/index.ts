export {
  BRAND_IMPACT_TOP_N,
  DEFAULT_DIMENSION_WEIGHTS,
  DIMENSIONS,
  HALF_LIFE_DAYS,
  type DimensionRollup,
  type ScoredItem,
  type TopicCluster,
} from './types.js';

export {
  brandImpact,
  clusterTopics,
  compositeScore,
  recencyWeight,
  scoreAllDimensions,
  scoreDimension,
  toIndex,
  topicsForDimension,
  topStrengths,
} from './score.js';

export { parseWeights } from './weights.js';

export {
  BACKFILL_THRESHOLD_DAYS,
  isBackfilled,
  splitPeriods,
  summariseChange,
  summariseSources,
  type ChangeBasis,
  type ChangeItem,
  type ChangeSummary,
  type SourceChange,
  type TopicChange,
} from './change.js';

export {
  counterfactual,
  gapTo,
  median,
  project,
  PROJECTION_HORIZON_DAYS,
  resolveTarget,
  type Benchmarks,
  type Counterfactual,
  type Projection,
  type Target,
  type TargetSource,
} from './target.js';
