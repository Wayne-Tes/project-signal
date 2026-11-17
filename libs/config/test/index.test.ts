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

  /**
   * The default changed on 2026-08-09, and the reason is the point of the test.
   *
   * It was Haiku 4.5, recorded as verified via `list-inference-profiles`. That listing was not
   * evidence: every profile this account may NOT invoke is still listed and still reports
   * ACTIVE. Verified by actually invoking it, only Sonnet 5 and Opus 5 answer — so the deployed
   * sentiment worker was carrying a model id it could no longer call.
   *
   * All three default to the same profile deliberately. Asserting that keeps them from drifting
   * apart silently onto a value nobody has invoked.
   */
  const VERIFIED_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

  it('applies SCORER_MODEL default', async () => {
    delete process.env['SCORER_MODEL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().SCORER_MODEL).toBe(VERIFIED_MODEL);
  });

  it('applies ASSISTANT_MODEL default', async () => {
    delete process.env['ASSISTANT_MODEL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().ASSISTANT_MODEL).toBe(VERIFIED_MODEL);
  });

  it('applies REPORTER_MODEL default', async () => {
    delete process.env['REPORTER_MODEL'];
    const { getEnv } = await import('../src/index.js');
    expect(getEnv().REPORTER_MODEL).toBe(VERIFIED_MODEL);
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

  describe('AUTH_MODE', () => {
    beforeEach(() => {
      // The repo-root .env may set these for local development; every case states its own.
      delete process.env['AUTH_MODE'];
      delete process.env['LOCAL_AUTH_PASSWORD'];
      delete process.env['NODE_ENV'];
    });

    it('defaults to cognito, so unsigned tokens are never accepted by accident', async () => {
      const { getEnv } = await import('../src/index.js');
      expect(getEnv().AUTH_MODE).toBe('cognito');
    });

    it('accepts local mode with a password of at least 12 characters', async () => {
      process.env['AUTH_MODE'] = 'local';
      process.env['LOCAL_AUTH_PASSWORD'] = 'twelve-chars';
      const { getEnv } = await import('../src/index.js');
      expect(getEnv().AUTH_MODE).toBe('local');
    });

    it('refuses local mode with no password', async () => {
      process.env['AUTH_MODE'] = 'local';
      const { getEnv } = await import('../src/index.js');
      expect(() => getEnv()).toThrow(/LOCAL_AUTH_PASSWORD/);
    });

    it('refuses local mode with a short password', async () => {
      process.env['AUTH_MODE'] = 'local';
      process.env['LOCAL_AUTH_PASSWORD'] = 'short';
      const { getEnv } = await import('../src/index.js');
      expect(() => getEnv()).toThrow(/LOCAL_AUTH_PASSWORD/);
    });

    it('refuses local mode in production, whatever the password', async () => {
      process.env['AUTH_MODE'] = 'local';
      process.env['LOCAL_AUTH_PASSWORD'] = 'a-perfectly-long-password';
      process.env['NODE_ENV'] = 'production';
      const { getEnv } = await import('../src/index.js');
      expect(() => getEnv()).toThrow(/AUTH_MODE=local is refused/);
    });

    it('rejects an unknown mode', async () => {
      process.env['AUTH_MODE'] = 'none';
      const { getEnv } = await import('../src/index.js');
      expect(() => getEnv()).toThrow(/Invalid environment/);
    });
  });

  describe('RESOURCE_TAGS', () => {
    it('accepts a JSON object of strings', async () => {
      process.env['RESOURCE_TAGS'] = '{"Project":"project-signal","Environment":"dev"}';
      const { getEnv } = await import('../src/index.js');
      expect(getEnv().RESOURCE_TAGS).toBe('{"Project":"project-signal","Environment":"dev"}');
    });

    it('rejects malformed JSON', async () => {
      process.env['RESOURCE_TAGS'] = '{not json';
      const { getEnv } = await import('../src/index.js');
      expect(() => getEnv()).toThrow(/RESOURCE_TAGS/);
    });

    it('rejects non-string values and arrays', async () => {
      process.env['RESOURCE_TAGS'] = '{"Project":1}';
      let mod = await import('../src/index.js');
      expect(() => mod.getEnv()).toThrow(/RESOURCE_TAGS/);
      vi.resetModules();
      process.env['RESOURCE_TAGS'] = '["a"]';
      mod = await import('../src/index.js');
      expect(() => mod.getEnv()).toThrow(/RESOURCE_TAGS/);
    });

    it('treats unset or empty as no tags', async () => {
      process.env['RESOURCE_TAGS'] = '';
      const { getEnv } = await import('../src/index.js');
      expect(getEnv().RESOURCE_TAGS).toBe('');
    });
  });
});

describe('listenHost', () => {
  it('binds loopback outside production, so local sign-in is not reachable from the network', async () => {
    const { listenHost } = await import('../src/index.js');
    expect(listenHost({ NODE_ENV: 'development' })).toBe('127.0.0.1');
    expect(listenHost({})).toBe('127.0.0.1');
    expect(listenHost({ NODE_ENV: 'test' })).toBe('127.0.0.1');
  });

  it('binds every interface in production, where the container is reached through its ENI', async () => {
    const { listenHost } = await import('../src/index.js');
    expect(listenHost({ NODE_ENV: 'production' })).toBe('0.0.0.0');
  });

  it('honours an explicit HOST either way, and ignores a blank one', async () => {
    const { listenHost } = await import('../src/index.js');
    expect(listenHost({ NODE_ENV: 'development', HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(listenHost({ NODE_ENV: 'production', HOST: '10.0.0.5' })).toBe('10.0.0.5');
    expect(listenHost({ NODE_ENV: 'production', HOST: '  ' })).toBe('0.0.0.0');
  });
});
