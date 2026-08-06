import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSave = vi.fn();
const mockDownload = vi.fn();

vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn(() => ({
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({ save: mockSave, download: mockDownload })),
    })),
  })),
}));

describe('GcsObjectStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSave.mockReset().mockResolvedValue(undefined);
    mockDownload.mockReset();
  });

  it('returns a gs:// reference from put()', async () => {
    const { GcsObjectStore } = await import('../src/gcs.js');
    const ref = await new GcsObjectStore('test-raw').put('t1/b1/rss/ext-1.json', '{"text":"hi"}');
    expect(ref).toBe('gs://test-raw/t1/b1/rss/ext-1.json');
    expect(mockSave).toHaveBeenCalledWith('{"text":"hi"}', { contentType: 'application/json' });
  });

  it('round-trips content through get()', async () => {
    mockDownload.mockResolvedValue([Buffer.from('{"text":"hi"}')]);
    const { GcsObjectStore } = await import('../src/gcs.js');
    await expect(new GcsObjectStore('test-raw').get('t1/b1/rss/ext-1.json')).resolves.toBe(
      '{"text":"hi"}',
    );
  });
});

describe('rawKey', () => {
  it('builds a deterministic key from the tenant/brand/source/externalId tuple', async () => {
    const { rawKey } = await import('../src/types.js');
    expect(rawKey('t1', 'b1', 'rss', 'ext-1')).toBe('t1/b1/rss/ext-1.json');
  });

  it('encodes external ids containing slashes so the key depth stays fixed', async () => {
    const { rawKey } = await import('../src/types.js');
    expect(rawKey('t1', 'b1', 'rss', 'https://a/b')).toBe('t1/b1/rss/https%3A%2F%2Fa%2Fb.json');
  });
});

describe('keyFromRef', () => {
  it('strips a gs:// prefix', async () => {
    const { keyFromRef } = await import('../src/types.js');
    expect(keyFromRef('gs://bucket/t1/b1/rss/x.json')).toBe('t1/b1/rss/x.json');
  });

  it('strips an s3:// prefix so AWS references parse identically', async () => {
    const { keyFromRef } = await import('../src/types.js');
    expect(keyFromRef('s3://bucket/t1/b1/rss/x.json')).toBe('t1/b1/rss/x.json');
  });

  it('rejects a bare URL, which is what the old rawStorageRef held', async () => {
    const { keyFromRef } = await import('../src/types.js');
    expect(() => keyFromRef('https://example.com/review/1')).toThrow(/Unrecognised/);
  });
});

describe('getObjectStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws a named error when RAW_BUCKET is unset', async () => {
    vi.doMock('@project-signal/config', () => ({ getEnv: () => ({}) }));
    const { getObjectStore } = await import('../src/index.js');
    expect(() => getObjectStore()).toThrow(/RAW_BUCKET/);
  });

  it('returns a GCS store and memoises it', async () => {
    vi.doMock('@project-signal/config', () => ({ getEnv: () => ({ RAW_BUCKET: 'test-raw' }) }));
    const { getObjectStore } = await import('../src/index.js');
    const { GcsObjectStore } = await import('../src/gcs.js');
    const store = getObjectStore();
    expect(store).toBeInstanceOf(GcsObjectStore);
    expect(getObjectStore()).toBe(store);
  });
});
