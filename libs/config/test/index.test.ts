import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://project_signal_app:password@localhost:5432/project_signal',
  COGNITO_USER_POOL_ID: 'eu-west-2_test',
  COGNITO_CLIENT_ID: 'test-client-id',
};

describe('getEnv', () => {
  const original = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original, ...BASE_ENV } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = original;
  });

  it('parses a valid environment and applies defaults', async () => {
    // Every variable whose DEFAULT is asserted must be deleted first: beforeEach spreads the
    // real process.env, and vitest loads the repo-root .env, so an ambient value would
    // silently satisfy the assertion instead of the default doing so.
    delete process.env['NODE_ENV'];
    delete process.env['PORT'];
    const { getEnv } = await import('../src/index.js');
    const env = getEnv();
    expect(env.DATABASE_URL).toBe(BASE_ENV.DATABASE_URL);
    // Cognito replaced Firebase; GOOGLE_CLOUD_PROJECT is gone from the schema entirely, which
    // is what closes out the last Google dependency on the API side.
    expect(env.COGNITO_USER_POOL_ID).toBe('eu-west-2_test');
    expect(env.COGNITO_CLIENT_ID).toBe('test-client-id');
    expect(env.SCORER_MODEL).toContain('eu.anthropic');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8080);
  });

  it('coerces PORT from a string to a number', async () => {
    process.env['PORT'] = '3000';
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().PORT).toBe(3000);
  });

  it('memoises the parsed environment', async () => {
    const { getEnv } = await import('../src/index.js');
    expect(getEnv()).toBe(getEnv());
  });

  it('throws when a required variable is missing', async () => {
    delete process.env['DATABASE_URL'];
    const { getEnv } = await import('../src/index.js');
    expect(() => getEnv()).toThrow(/Invalid environment/);
  });

  it('rejects an empty DATABASE_URL', async () => {
    process.env['DATABASE_URL'] = '';
    const { getEnv } = await import('../src/index.js');
    expect(() => getEnv()).toThrow(/Invalid environment/);
  });

  it('accepts discrete socket config (DB_SOCKET_PATH) without DATABASE_URL', async () => {
    delete process.env['DATABASE_URL'];
    process.env['DB_SOCKET_PATH'] =
      '/cloudsql/example-project:europe-west2:staging-project-signal-pg';
    const { getEnv } = await import('../src/index.js');
    const env = getEnv();
    expect(env.DB_SOCKET_PATH).toContain('/cloudsql/');
    expect(env.DB_NAME).toBe('project_signal');
    expect(env.DB_USER).toBe('project_signal_app');
  });

  it('accepts optional APIFY_API_KEY and YOUTUBE_API_KEY', async () => {
    process.env['APIFY_API_KEY'] = 'apify-key-123';
    process.env['YOUTUBE_API_KEY'] = 'yt-key-456';
    const { getEnv } = await import('../src/index.js');
    const env = getEnv();
    expect(env.APIFY_API_KEY).toBe('apify-key-123');
    expect(env.YOUTUBE_API_KEY).toBe('yt-key-456');
  });

  it('applies SCORER_MODEL default', async () => {
    delete process.env['SCORER_MODEL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().SCORER_MODEL).toBe('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('applies REPORTER_MODEL default', async () => {
    delete process.env['REPORTER_MODEL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().REPORTER_MODEL).toBe('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('accepts the SQS queue URLs', async () => {
    process.env['ITEM_QUEUE_URL'] = 'https://sqs.eu-west-2.amazonaws.com/1/psignal-dev-item';
    process.env['REPORT_QUEUE_URL'] = 'https://sqs.eu-west-2.amazonaws.com/1/psignal-dev-report';
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().ITEM_QUEUE_URL).toBe('https://sqs.eu-west-2.amazonaws.com/1/psignal-dev-item');
    expect(getEnv().REPORT_QUEUE_URL).toBe(
      'https://sqs.eu-west-2.amazonaws.com/1/psignal-dev-report',
    );
  });

  it('leaves the queue URLs undefined when unset, so queueUrl() can fail loudly', async () => {
    delete process.env['ITEM_QUEUE_URL'];
    delete process.env['REPORT_QUEUE_URL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().ITEM_QUEUE_URL).toBeUndefined();
    expect(getEnv().REPORT_QUEUE_URL).toBeUndefined();
  });
});
