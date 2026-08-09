import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  ReceiveMessageCommand: vi.fn((input) => ({ _type: 'receive', input })),
  DeleteMessageCommand: vi.fn((input) => ({ _type: 'delete', input })),
}));

const mockEnv: Record<string, string | undefined> = {
  ITEM_QUEUE_URL: 'https://sqs.eu-west-2.amazonaws.com/1/item',
};
vi.mock('@project-signal/config', () => ({ getEnv: vi.fn(() => mockEnv) }));

const { SqsConsumer } = await import('../src/consumer.js');

/**
 * The SQS consumer.
 *
 * This class is the link that was never built: ingestion published signal ids to SQS from the
 * day the AWS port landed and NOTHING read them — a grep of the repository for `ReceiveMessage`
 * returned zero hits. So every deployed environment collected signals, published them, and
 * scored none of them, leaving dimension scores, Brand impact and the index permanently empty
 * for a reason no dashboard could show.
 *
 * The tests that matter are about delete semantics. Deleting at the wrong moment either loses
 * messages silently or replays them forever, and both look like "the pipeline is a bit flaky".
 */

/** Lets a test drive one loop iteration and then stop cleanly. */
function receiveOnce(messages: { Body: string; ReceiptHandle?: string }[]) {
  let served = false;
  mockSend.mockImplementation(async (cmd: { _type: string }) => {
    if (cmd._type === 'receive') {
      if (served) return { Messages: [] };
      served = true;
      return { Messages: messages };
    }
    return {};
  });
}

function deletes(): { input: { ReceiptHandle: string } }[] {
  return mockSend.mock.calls.map((c) => c[0]).filter((c) => c._type === 'delete');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv['ITEM_QUEUE_URL'] = 'https://sqs.eu-west-2.amazonaws.com/1/item';
});

describe('SqsConsumer', () => {
  it('long-polls rather than spinning', async () => {
    /* An idle queue must cost one request every 20 seconds, not thousands. Short polling also
       samples only a subset of SQS hosts, so it can miss messages that are genuinely there. */
    receiveOnce([]);
    const c = new SqsConsumer({ queue: 'item', handle: async () => {} });
    c.start();
    await new Promise((r) => setTimeout(r, 20));
    await c.stop();

    const receive = mockSend.mock.calls.map((x) => x[0]).find((x) => x._type === 'receive');
    expect(receive.input.WaitTimeSeconds).toBe(20);
    expect(receive.input.MaxNumberOfMessages).toBe(10);
  });

  it('deletes a message ONLY after the handler succeeds', async () => {
    receiveOnce([{ Body: 'signal-1', ReceiptHandle: 'rh-1' }]);
    const order: string[] = [];
    const c = new SqsConsumer({
      queue: 'item',
      handle: async () => {
        order.push('handled');
      },
    });
    c.start();
    await new Promise((r) => setTimeout(r, 30));
    await c.stop();

    order.push('done');
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]?.input.ReceiptHandle).toBe('rh-1');
  });

  it('does NOT delete when the handler throws, so the message is retried', async () => {
    /* The property the whole retry story rests on. Deleting on receipt loses the message the
       moment the handler fails; leaving it undeleted is what lets the visibility timeout
       redeliver it and, eventually, what feeds the DLQ Terraform has always defined and which
       has never received anything. */
    receiveOnce([{ Body: 'signal-1', ReceiptHandle: 'rh-1' }]);
    const c = new SqsConsumer({
      queue: 'item',
      handle: async () => {
        throw new Error('bedrock throttled');
      },
      onError: () => {},
    });
    c.start();
    await new Promise((r) => setTimeout(r, 30));
    await c.stop();

    expect(deletes()).toHaveLength(0);
  });

  it('deletes when the handler RESOLVES on a permanent failure', async () => {
    /* A payload that will never parse must not be redelivered until the redrive policy gives
       up — that spends a fixed number of retries to reach a conclusion known on attempt one.
       The handler signals this by resolving rather than throwing. */
    receiveOnce([{ Body: 'garbage', ReceiptHandle: 'rh-2' }]);
    const c = new SqsConsumer({
      queue: 'item',
      handle: async () => {
        /* Handler decided this is permanent and swallowed it. */
      },
    });
    c.start();
    await new Promise((r) => setTimeout(r, 30));
    await c.stop();

    expect(deletes()).toHaveLength(1);
  });

  it('processes messages one at a time, in order', async () => {
    /* Concurrency here would multiply Bedrock calls without bound, and the scorer is the
       expensive part. Throughput is scaled by running more tasks. */
    receiveOnce([
      { Body: 'a', ReceiptHandle: 'rh-a' },
      { Body: 'b', ReceiptHandle: 'rh-b' },
    ]);
    const seen: string[] = [];
    const c = new SqsConsumer({
      queue: 'item',
      handle: async (body) => {
        seen.push(`start:${body}`);
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`end:${body}`);
      },
    });
    c.start();
    await new Promise((r) => setTimeout(r, 60));
    await c.stop();

    expect(seen).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('survives a receive failure instead of killing the loop', async () => {
    /* Throwing out of the loop would silently stop the entire pipeline — exactly the failure
       this class exists to end. */
    let calls = 0;
    mockSend.mockImplementation(async (cmd: { _type: string }) => {
      if (cmd._type !== 'receive') return {};
      calls += 1;
      if (calls === 1) throw new Error('network');
      return { Messages: [] };
    });

    const errors: string[] = [];
    const c = new SqsConsumer({ queue: 'item', handle: async () => {}, onError: (_e, b) => errors.push(b) });
    c.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(c.isRunning).toBe(true);
    await c.stop();

    expect(errors).toContain('<receive>');
  });

  it('fails at start-up when the queue URL is not configured', async () => {
    /* Resolved at start rather than on the first message, so a misconfiguration surfaces where
       someone is watching instead of hours later. */
    delete mockEnv['ITEM_QUEUE_URL'];
    const c = new SqsConsumer({ queue: 'item', handle: async () => {} });
    expect(() => c.start()).toThrow(/ITEM_QUEUE_URL/);
  });

  it('stop() waits for the loop to actually exit', async () => {
    receiveOnce([]);
    const c = new SqsConsumer({ queue: 'item', handle: async () => {} });
    c.start();
    expect(c.isRunning).toBe(true);
    await c.stop();
    expect(c.isRunning).toBe(false);
  });

  it('is idempotent on repeated start — no orphaned second loop', async () => {
    /* Counting receives inside a time window was the first version of this test, and it was
       flaky: how many iterations fit in 15ms depends on the machine, and CI is not this one.

       The real property is that a second start() must not leave a loop running that stop() does
       not know about. So: start twice, stop, then prove nothing sends again. Deterministic, and
       it tests the thing that would actually hurt — an orphaned loop double-processing every
       message forever. */
    receiveOnce([]);
    const c = new SqsConsumer({ queue: 'item', handle: async () => {} });
    c.start();
    c.start();
    await new Promise((r) => setTimeout(r, 15));
    await c.stop();

    const afterStop = mockSend.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSend.mock.calls.length, 'a second loop would keep polling after stop()').toBe(
      afterStop,
    );
    expect(c.isRunning).toBe(false);
  });

  it('does not treat a failed delete as a processing failure', async () => {
    /* The work is committed. One redelivery and a duplicate attempt is far cheaper than redoing
       the expensive part, and every handler here is idempotent. */
    let served = false;
    mockSend.mockImplementation(async (cmd: { _type: string }) => {
      if (cmd._type === 'receive') {
        if (served) return { Messages: [] };
        served = true;
        return { Messages: [{ Body: 'x', ReceiptHandle: 'rh' }] };
      }
      throw new Error('delete failed');
    });

    let handled = 0;
    const c = new SqsConsumer({ queue: 'item', handle: async () => { handled += 1; }, onError: () => {} });
    c.start();
    await new Promise((r) => setTimeout(r, 30));
    await c.stop();

    expect(handled).toBe(1);
  });
});
