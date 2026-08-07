import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
const mockSend = vi.fn();

vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => mockEnv),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  SendMessageCommand: vi.fn((input) => ({ input })),
}));

const ITEM_URL = 'https://sqs.eu-west-2.amazonaws.com/290304998906/psignal-dev-item';
const REPORT_URL = 'https://sqs.eu-west-2.amazonaws.com/290304998906/psignal-dev-report';

beforeEach(() => {
  vi.resetModules();
  mockSend.mockReset().mockResolvedValue({ MessageId: 'msg-1' });
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  delete process.env['AWS_ENDPOINT_URL'];
});

// KNOWN-GAPS #7, in its AWS form. The old code published to a hardcoded topic constant that
// existed in no deployed environment, and nothing failed — messages simply went nowhere. An
// SQS URL embeds the account id and region, so there is no constant that could stand in for
// it, and an unset variable must be a hard error rather than a silent default.
describe('queueUrl', () => {
  it('resolves the item queue from the environment', async () => {
    mockEnv['ITEM_QUEUE_URL'] = ITEM_URL;
    const { queueUrl } = await import('../src/index.js');
    expect(queueUrl('item')).toBe(ITEM_URL);
  });

  it('resolves the report queue from the environment', async () => {
    mockEnv['REPORT_QUEUE_URL'] = REPORT_URL;
    const { queueUrl } = await import('../src/index.js');
    expect(queueUrl('report')).toBe(REPORT_URL);
  });

  it('throws a named error when the item queue is unset', async () => {
    const { queueUrl } = await import('../src/index.js');
    expect(() => queueUrl('item')).toThrow(/ITEM_QUEUE_URL/);
  });

  it('throws a named error when the report queue is unset', async () => {
    const { queueUrl } = await import('../src/index.js');
    expect(() => queueUrl('report')).toThrow(/REPORT_QUEUE_URL/);
  });

  it('treats an empty string as unset rather than publishing to ""', async () => {
    mockEnv['ITEM_QUEUE_URL'] = '';
    const { queueUrl } = await import('../src/index.js');
    expect(() => queueUrl('item')).toThrow(/ITEM_QUEUE_URL/);
  });
});

describe('SqsPublisher', () => {
  it('sends the body to the resolved queue and returns the message id', async () => {
    mockEnv['ITEM_QUEUE_URL'] = ITEM_URL;
    const { getPublisher } = await import('../src/index.js');

    await expect(getPublisher().publish('item', 'signal-uuid-1')).resolves.toBe('msg-1');
    expect(mockSend.mock.calls[0]![0].input).toEqual({
      QueueUrl: ITEM_URL,
      MessageBody: 'signal-uuid-1',
    });
  });

  it('throws when SQS returns no MessageId, rather than reporting a publish that may not have happened', async () => {
    mockEnv['ITEM_QUEUE_URL'] = ITEM_URL;
    mockSend.mockResolvedValue({});
    const { getPublisher } = await import('../src/index.js');
    await expect(getPublisher().publish('item', 'x')).rejects.toThrow(/no MessageId/);
  });

  it('propagates a send failure so the caller can nack rather than silently dropping', async () => {
    mockEnv['ITEM_QUEUE_URL'] = ITEM_URL;
    mockSend.mockRejectedValue(new Error('ThrottlingException'));
    const { getPublisher } = await import('../src/index.js');
    await expect(getPublisher().publish('item', 'x')).rejects.toThrow(/ThrottlingException/);
  });

  it('points at LocalStack when AWS_ENDPOINT_URL is set', async () => {
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:4566';
    const { SQSClient } = await import('@aws-sdk/client-sqs');
    const { getPublisher } = await import('../src/index.js');
    getPublisher();
    expect(SQSClient).toHaveBeenCalledWith({ endpoint: 'http://localhost:4566' });
  });

  it('passes no explicit config in a deployed environment, so the default chain resolves it', async () => {
    const { SQSClient } = await import('@aws-sdk/client-sqs');
    const { getPublisher } = await import('../src/index.js');
    getPublisher();
    expect(SQSClient).toHaveBeenCalledWith({});
  });
});

describe('getPublisher', () => {
  it('memoises the publisher', async () => {
    const { getPublisher } = await import('../src/index.js');
    expect(getPublisher()).toBe(getPublisher());
  });

  it('resetPublisher drops the memoised instance so the environment is re-read', async () => {
    const { getPublisher, resetPublisher } = await import('../src/index.js');
    const first = getPublisher();
    resetPublisher();
    expect(getPublisher()).not.toBe(first);
  });
});
