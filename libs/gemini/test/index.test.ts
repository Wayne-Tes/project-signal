import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => ({
    GOOGLE_CLOUD_PROJECT: 'test-project',
    VERTEX_AI_LOCATION: 'europe-west2',
    SCORER_MODEL: 'gemini-2.0-flash-001',
    REPORTER_MODEL: 'gemini-2.0-pro-001',
  })),
}));

vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: vi.fn().mockImplementation((opts: unknown) => ({ _opts: opts })),
}));

describe('getVertexAI', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a VertexAI instance with project and location from config', async () => {
    const { getVertexAI } = await import('../src/index.js');
    const { VertexAI } = await import('@google-cloud/vertexai');
    const instance = getVertexAI();
    expect(VertexAI).toHaveBeenCalledWith({
      project: 'test-project',
      location: 'europe-west2',
    });
    expect(instance).toBeDefined();
  });

  it('returns the same instance on repeated calls (memoisation)', async () => {
    const { getVertexAI } = await import('../src/index.js');
    expect(getVertexAI()).toBe(getVertexAI());
  });
});

describe('getScorerModel', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns SCORER_MODEL from env', async () => {
    const { getScorerModel } = await import('../src/index.js');
    expect(getScorerModel()).toBe('gemini-2.0-flash-001');
  });
});

describe('getReporterModel', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns REPORTER_MODEL from env', async () => {
    const { getReporterModel } = await import('../src/index.js');
    expect(getReporterModel()).toBe('gemini-2.0-pro-001');
  });
});
