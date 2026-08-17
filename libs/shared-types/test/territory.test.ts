import { describe, expect, it } from 'vitest';
import {
  COLLECTING_SOURCES,
  isCollectingSource,
  isTerritory,
  normaliseTerritory,
  TERRITORIES,
  TERRITORY_ALL,
  TERRITORY_LABELS,
} from '../src/index.js';

/**
 * Territory is a closed vocabulary on purpose.
 *
 * A shape check — "two uppercase letters" — would accept `UK`, which is not an assigned ISO
 * 3166-1 country code. `GB` is. Both look entirely plausible in a database, so the split would
 * surface months later as two half-empty rows in a report that nobody could reconcile. The
 * marketing team's channel sheet says "UK" and "AUS" throughout, so this is not hypothetical.
 */
describe('normaliseTerritory', () => {
  it('accepts the codes it stores', () => {
    expect(normaliseTerritory('GB')).toBe('GB');
    expect(normaliseTerritory('AU')).toBe('AU');
    expect(normaliseTerritory('GLOBAL')).toBe('GLOBAL');
    expect(normaliseTerritory('unknown')).toBe('unknown');
  });

  /* The whole reason the alias map exists: these are what the channel sheet actually contains,
     and rejecting them would turn the import into a manual find-and-replace. */
  it('corrects the spellings the channel sheet actually uses', () => {
    expect(normaliseTerritory('UK')).toBe('GB');
    expect(normaliseTerritory('AUS')).toBe('AU');
    expect(normaliseTerritory('USA')).toBe('US');
    expect(normaliseTerritory('Australia')).toBe('AU');
  });

  it('is insensitive to case and surrounding space', () => {
    expect(normaliseTerritory('  uk  ')).toBe('GB');
    expect(normaliseTerritory('global')).toBe('GLOBAL');
  });

  /**
   * `Global?` appears six times in the sheet. The question mark is its author saying they are not
   * sure, and resolving it on their behalf would file six channels under a territory nobody
   * chose. Null forces a 400 and a conversation.
   */
  it('refuses an ambiguous value rather than guessing', () => {
    expect(normaliseTerritory('Global?')).toBeNull();
    expect(normaliseTerritory('EMEA')).toBeNull();
    expect(normaliseTerritory('ZZ')).toBeNull();
    expect(normaliseTerritory('nonsense')).toBeNull();
  });

  /* Null, NOT a fallback to `unknown`. A silent fallback would store something plausible for a
     typo, and territory reporting would then be confidently wrong with nothing to notice. */
  it('returns null rather than falling back to unknown', () => {
    expect(normaliseTerritory('GBR')).toBeNull();
    expect(normaliseTerritory(null)).toBeNull();
    expect(normaliseTerritory(undefined)).toBeNull();
  });

  it('treats an empty string as explicitly unset', () => {
    expect(normaliseTerritory('')).toBe('unknown');
    expect(normaliseTerritory('   ')).toBe('unknown');
  });
});

describe('the vocabulary', () => {
  it('rejects UK, because ISO does', () => {
    expect(isTerritory('UK')).toBe(false);
    expect(isTerritory('GB')).toBe(true);
  });

  /**
   * `'all'` is the aggregate row on `dimension_scores` and must never be a signal's territory.
   * If it were in the vocabulary, a feed could be configured as "all", its signals would carry
   * it, and they would then be double-counted into the aggregate they are supposed to compose.
   */
  it('does not contain the aggregate sentinel', () => {
    expect(TERRITORIES).not.toContain(TERRITORY_ALL);
    expect(isTerritory(TERRITORY_ALL)).toBe(false);
    expect(normaliseTerritory(TERRITORY_ALL)).toBeNull();
  });

  it('labels every code it accepts', () => {
    for (const t of TERRITORIES) {
      expect(TERRITORY_LABELS[t], `no label for ${t}`).toBeTruthy();
    }
  });

  it('never stores a display name as a value', () => {
    /* The stored value is the code; the label is presentation. Storing "United Kingdom" would
       make every query depend on prose. */
    for (const t of TERRITORIES) {
      expect(normaliseTerritory(TERRITORY_LABELS[t])).not.toBe(TERRITORY_LABELS[t]);
    }
  });
});

/**
 * `isCollectingSource` — the guard that separates what the SCHEMA can model from what the
 * pipeline can actually fetch.
 *
 * Untested until now, and it is the check behind KNOWN-GAPS #24: the integrations endpoint used
 * to accept any string, so a `trustpilot` feed could be stored, listed as configured and enabled,
 * and then throw "No adapter for source" on every collection run — an error the dispatcher counts
 * as a failed source and drops. The only symptom was a feed that silently produced nothing, which
 * is indistinguishable from nobody talking about the brand.
 */
describe('isCollectingSource', () => {
  it('accepts every source an adapter exists for', () => {
    for (const s of COLLECTING_SOURCES) expect(isCollectingSource(s)).toBe(true);
  });

  /* Modelled by `SignalSource` but with no collector. Accepting these is the defect. */
  it('rejects a source the schema models but nothing can fetch', () => {
    expect(isCollectingSource('trustpilot')).toBe(false);
    expect(isCollectingSource('news_api')).toBe(false);
    expect(isCollectingSource('x')).toBe(false);
    expect(isCollectingSource('survey')).toBe(false);
  });

  it('rejects arbitrary input', () => {
    expect(isCollectingSource('')).toBe(false);
    expect(isCollectingSource('RSS')).toBe(false);
    expect(isCollectingSource('facebook')).toBe(false);
  });
});
