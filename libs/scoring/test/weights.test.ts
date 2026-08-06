import { describe, expect, it } from 'vitest';
import { parseWeights } from '../src/index.js';

describe('parseWeights', () => {
  it('falls back to the equal default when unset', () => {
    expect(parseWeights(null).trust).toBeCloseTo(0.2, 10);
    expect(parseWeights(undefined).trust).toBeCloseTo(0.2, 10);
  });

  it('accepts a valid per-brand configuration', () => {
    expect(parseWeights({ trust: 0.5, quality: 0.5 })).toEqual({ trust: 0.5, quality: 0.5 });
  });

  it('accepts weights that do not sum to 1, since compositeScore renormalises', () => {
    expect(parseWeights({ trust: 3, quality: 1 })).toEqual({ trust: 3, quality: 1 });
  });

  // Operator-supplied jsonb: a malformed weight must not skew a customer's headline score.
  it('drops negative, zero, non-finite and non-numeric entries', () => {
    const parsed = parseWeights({ trust: -1, quality: 0, service: 'high', value: NaN });
    expect(parsed).toEqual(expect.objectContaining({ trust: 0.2 }));
  });

  it('ignores keys that are not dimensions', () => {
    expect(parseWeights({ trust: 0.5, nonsense: 0.5 })).toEqual({ trust: 0.5 });
  });

  it('falls back to the default when nothing valid survives', () => {
    expect(parseWeights({ nonsense: 1 }).experience).toBeCloseTo(0.2, 10);
  });

  it('ignores an array, which is valid JSON but not a weight map', () => {
    expect(parseWeights([1, 2, 3]).trust).toBeCloseTo(0.2, 10);
  });

  it('ignores a scalar', () => {
    expect(parseWeights('trust').trust).toBeCloseTo(0.2, 10);
  });
});
