export {
  ACHILLES_TOP_N,
  DEFAULT_DIMENSION_WEIGHTS,
  DIMENSIONS,
  HALF_LIFE_DAYS,
  type DimensionRollup,
  type ScoredItem,
  type TopicCluster,
} from './types.js';

export {
  achillesHeels,
  clusterTopics,
  compositeScore,
  recencyWeight,
  scoreAllDimensions,
  scoreDimension,
  toIndex,
} from './score.js';
