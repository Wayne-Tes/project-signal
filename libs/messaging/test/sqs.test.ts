import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('@project-signal/config', () => ({ getEnv: vi.fn(() => mockEnv) }));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: vi.fn() })),
  SendMessageCommand: vi.fn((input) => ({ input })),
  ReceiveMessageCommand: vi.fn((input) => ({ input })),
  DeleteMessageCommand: vi.fn((input) => ({ input })),
}));

beforeEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('queueUrl mapping', () => {
  /**
   * REGRESSION. This was `logical === 'item' ? ITEM_QUEUE_URL : REPORT_QUEUE_URL`, so adding
   * 'scan' to the union silently routed it to the REPORT queue — publisher and consumer alike.
   * Nothing failed to compile, nothing failed at runtime, and the scan queue simply stayed
   * empty while messages went to the wrong place. It surfaced only because ingestion's
   * least-privilege IAM had no receive permission on report and said so.
   *
   * It is a Record now, so a new logical queue that is not mapped is a type error. These tests
   * assert the values, because the type only guarantees a key exists — not that it is right.
   */
  it('maps every logical queue to its own variable', async () => {
    const { queueUrl } = await import('../src/sqs.js');
    mockEnv['ITEM_QUEUE_URL'] = 'https://sqs/item';
    mockEnv['REPORT_QUEUE_URL'] = 'https://sqs/report';
    mockEnv['SCAN_QUEUE_URL'] = 'https://sqs/scan';

    expect(queueUrl('item')).toBe('https://sqs/item');
    expect(queueUrl('report')).toBe('https://sqs/report');
    expect(queueUrl('scan')).toBe('https://sqs/scan');
  });

  it('never falls back to another queue when one is unset', async () => {
    /* The exact failure: scan unset must throw, not quietly become report. */
    const { queueUrl } = await import('../src/sqs.js');
    mockEnv['REPORT_QUEUE_URL'] = 'https://sqs/report';
    delete mockEnv['SCAN_QUEUE_URL'];

    expect(() => queueUrl('scan')).toThrow(/SCAN_QUEUE_URL/);
  });

  it('names the variable the operator actually has to set', async () => {
    const { queueUrl } = await import('../src/sqs.js');
    delete mockEnv['ITEM_QUEUE_URL'];
    expect(() => queueUrl('item')).toThrow(/ITEM_QUEUE_URL/);
  });
});
