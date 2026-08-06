import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {
  GOOGLE_CLOUD_PROJECT: 'test-project',
  PUBSUB_EMULATOR_HOST: undefined,
};

vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => mockEnv),
}));

const mockPubSubInstance = { projectId: 'test-project' };
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: vi.fn().mockImplementation((opts: unknown) => ({ ...mockPubSubInstance, _opts: opts })),
}));

describe('TOPICS', () => {
  it('exposes all expected topic names', async () => {
    const { TOPICS } = await import('../src/index.js');
    expect(TOPICS.ITEM_QUEUE).toBe('project-signal-item-queue');
    expect(TOPICS.ITEM_DLQ).toBe('project-signal-item-dlq');
    expect(TOPICS.REPORT_QUEUE).toBe('project-signal-report-queue');
    expect(TOPICS.REPORT_DLQ).toBe('project-signal-report-dlq');
  });

  it('has exactly 4 topics', async () => {
    const { TOPICS } = await import('../src/index.js');
    expect(Object.keys(TOPICS)).toHaveLength(4);
  });
});

// KNOWN-GAPS #7 — Terraform creates `<env>-item` and injects it as ITEM_TOPIC, but the code
// published to the hardcoded TOPICS.ITEM_QUEUE, a topic that does not exist in any deployed
// environment. Names must come from the environment, with the constants as local-dev defaults.
describe('topicName', () => {
  beforeEach(() => {
    vi.resetModules();
    delete mockEnv['ITEM_TOPIC'];
    delete mockEnv['REPORT_TOPIC'];
  });

  it('prefers ITEM_TOPIC from the environment', async () => {
    mockEnv['ITEM_TOPIC'] = 'staging-item';
    const { topicName } = await import('../src/index.js');
    expect(topicName('item')).toBe('staging-item');
  });

  it('prefers REPORT_TOPIC from the environment', async () => {
    mockEnv['REPORT_TOPIC'] = 'staging-report';
    const { topicName } = await import('../src/index.js');
    expect(topicName('report')).toBe('staging-report');
  });

  it('falls back to the local-dev constant when ITEM_TOPIC is unset', async () => {
    const { topicName, TOPICS } = await import('../src/index.js');
    expect(topicName('item')).toBe(TOPICS.ITEM_QUEUE);
  });

  it('falls back to the local-dev constant when REPORT_TOPIC is unset', async () => {
    const { topicName, TOPICS } = await import('../src/index.js');
    expect(topicName('report')).toBe(TOPICS.REPORT_QUEUE);
  });

  it('ignores an empty-string override rather than publishing to ""', async () => {
    mockEnv['ITEM_TOPIC'] = '';
    const { topicName, TOPICS } = await import('../src/index.js');
    expect(topicName('item')).toBe(TOPICS.ITEM_QUEUE);
  });
});

describe('getPubSub', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a PubSub client with the project from config', async () => {
    const { getPubSub } = await import('../src/index.js');
    const { PubSub } = await import('@google-cloud/pubsub');
    getPubSub();
    expect(PubSub).toHaveBeenCalledWith({ projectId: 'test-project' });
  });

  it('returns the same instance on repeated calls (memoisation)', async () => {
    const { getPubSub } = await import('../src/index.js');
    expect(getPubSub()).toBe(getPubSub());
  });
});
