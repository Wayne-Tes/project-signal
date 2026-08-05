import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => ({
    GOOGLE_CLOUD_PROJECT: 'test-project',
    PUBSUB_EMULATOR_HOST: undefined,
  })),
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
