import { describe, expect, it } from 'vitest';
import { keyFromRef, rawKey } from '../src/types.js';

describe('rawKey', () => {
  it('builds a deterministic key from the tenant/brand/source/externalId tuple', () => {
    expect(rawKey('t1', 'b1', 'rss', 'ext-1')).toBe('t1/b1/rss/ext-1.json');
  });

  it('encodes external ids containing slashes so the key depth stays fixed', () => {
    expect(rawKey('t1', 'b1', 'rss', 'https://a/b')).toBe('t1/b1/rss/https%3A%2F%2Fa%2Fb.json');
  });
});

describe('keyFromRef', () => {
  it('strips an s3:// prefix', () => {
    expect(keyFromRef('s3://bucket/t1/b1/rss/x.json')).toBe('t1/b1/rss/x.json');
  });

  it('still strips a gs:// prefix, so rows written before the move remain resolvable', () => {
    expect(keyFromRef('gs://bucket/t1/b1/rss/x.json')).toBe('t1/b1/rss/x.json');
  });

  it('rejects a bare URL, which is what the old rawStorageRef held', () => {
    expect(() => keyFromRef('https://example.com/review/1')).toThrow(/Unrecognised/);
  });
});
