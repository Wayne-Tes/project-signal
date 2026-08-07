import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn((input) => ({ __type: 'Put', input })),
  GetObjectCommand: vi.fn((input) => ({ __type: 'Get', input })),
}));

describe('S3ObjectStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    delete process.env['AWS_ENDPOINT_URL'];
  });

  it('returns an s3:// reference from put()', async () => {
    mockSend.mockResolvedValue({});
    const { S3ObjectStore } = await import('../src/s3.js');
    const ref = await new S3ObjectStore('test-raw').put('t1/b1/rss/ext-1.json', '{"text":"hi"}');

    expect(ref).toBe('s3://test-raw/t1/b1/rss/ext-1.json');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'test-raw',
      Key: 't1/b1/rss/ext-1.json',
      Body: '{"text":"hi"}',
      ContentType: 'application/json',
    });
  });

  it('honours an explicit content type', async () => {
    mockSend.mockResolvedValue({});
    const { S3ObjectStore } = await import('../src/s3.js');
    await new S3ObjectStore('test-raw').put('k', 'plain', 'text/plain');
    expect(mockSend.mock.calls[0]![0].input).toMatchObject({ ContentType: 'text/plain' });
  });

  it('round-trips content through get()', async () => {
    mockSend.mockResolvedValue({ Body: { transformToString: () => Promise.resolve('{"text":"hi"}') } });
    const { S3ObjectStore } = await import('../src/s3.js');
    await expect(new S3ObjectStore('test-raw').get('t1/b1/rss/ext-1.json')).resolves.toBe(
      '{"text":"hi"}',
    );
    expect(mockSend.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'test-raw',
      Key: 't1/b1/rss/ext-1.json',
    });
  });

  it('throws when a response carries no body rather than returning empty content', async () => {
    // Returning '' here would be scored by the sentiment worker as though it were the review
    // text — a silent data fault, which is exactly the class of bug KNOWN-GAPS #4 was.
    mockSend.mockResolvedValue({});
    const { S3ObjectStore } = await import('../src/s3.js');
    await expect(new S3ObjectStore('test-raw').get('missing')).rejects.toThrow(/no body/);
  });

  it('points at LocalStack when AWS_ENDPOINT_URL is set, and uses path-style addressing', async () => {
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:4566';
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { S3ObjectStore } = await import('../src/s3.js');
    new S3ObjectStore('test-raw');

    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'http://localhost:4566',
      forcePathStyle: true,
    });
  });

  it('passes no explicit config in a deployed environment, so the default chain resolves it', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { S3ObjectStore } = await import('../src/s3.js');
    new S3ObjectStore('test-raw');
    expect(S3Client).toHaveBeenCalledWith({});
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

  it('returns an S3 store and memoises it', async () => {
    vi.doMock('@project-signal/config', () => ({ getEnv: () => ({ RAW_BUCKET: 'test-raw' }) }));
    const { getObjectStore } = await import('../src/index.js');
    const { S3ObjectStore } = await import('../src/s3.js');
    const store = getObjectStore();
    expect(store).toBeInstanceOf(S3ObjectStore);
    expect(getObjectStore()).toBe(store);
  });
});
