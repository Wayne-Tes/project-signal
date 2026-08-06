import type { Dimension } from '@project-signal/shared-types';
import { DEFAULT_DIMENSION_WEIGHTS } from './types.js';

/**
 * Interprets a brand's configured Brand Perception Index weights.
 *
 * `brand_entities.dimension_weights` is operator-supplied jsonb, so it is validated rather than
 * trusted: any non-numeric, non-finite, zero or negative entry is dropped, as is any key that
 * is not one of the five dimensions. If nothing valid survives, the equal default applies — a
 * malformed weight silently skewing a customer's headline score would be worse than ignoring
 * the configuration entirely.
 *
 * Weights need not sum to 1; `compositeScore` renormalises.
 */
export function parseWeights(raw: unknown): Readonly<Partial<Record<Dimension, number>>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_DIMENSION_WEIGHTS;

  const parsed: Partial<Record<Dimension, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    if (!(key in DEFAULT_DIMENSION_WEIGHTS)) continue;
    parsed[key as Dimension] = value;
  }

  return Object.keys(parsed).length > 0 ? parsed : DEFAULT_DIMENSION_WEIGHTS;
}
