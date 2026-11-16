import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Cognito pool configuration.
 *
 * Two properties matter. A Cognito build with its pool ids missing must fail LOUDLY — `NEXT_PUBLIC_*`
 * values are inlined at build time, and a silently-defaulted id is a bundle pointed at the wrong
 * pool. And the failure must happen on USE, not on import — otherwise a local-mode build, which
 * never touches Cognito, could not load the auth module at all (that was the defect).
 */

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: class {
    constructor(public readonly config: { UserPoolId: string; ClientId: string }) {}
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getUserPool', () => {
  it('imports without the Cognito variables — a local build never needs them', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', '');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', '');
    await expect(import('../src/lib/cognito')).resolves.toBeDefined();
  });

  it('throws a named, actionable error when used without them', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', '');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', '');
    const { getUserPool } = await import('../src/lib/cognito');
    expect(() => getUserPool()).toThrow(
      /NEXT_PUBLIC_COGNITO_USER_POOL_ID[\s\S]*NEXT_PUBLIC_AUTH_MODE=local/,
    );
  });

  it('builds the pool once from the configured ids', async () => {
    vi.stubEnv('NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'eu-west-2_abc');
    vi.stubEnv('NEXT_PUBLIC_COGNITO_CLIENT_ID', 'client-1');
    const { getUserPool } = await import('../src/lib/cognito');
    const pool = getUserPool() as unknown as { config: { UserPoolId: string; ClientId: string } };
    expect(pool.config).toEqual({ UserPoolId: 'eu-west-2_abc', ClientId: 'client-1' });
    expect(getUserPool()).toBe(pool);
  });
});

describe('AUTH_MODE', () => {
  it('is local only for the exact string, and Cognito for anything else', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'local');
    expect((await import('../src/lib/config')).AUTH_MODE).toBe('local');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', 'Local ');
    expect((await import('../src/lib/config')).AUTH_MODE).toBe('cognito');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_AUTH_MODE', '');
    expect((await import('../src/lib/config')).AUTH_MODE).toBe('cognito');
  });
});
