import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cover for the module that holds CRM OAuth tokens.
 *
 * This file shipped at 0% coverage. Everything in it is a decision about a credential that grants
 * standing access to a customer's commercial records, and none of those decisions were pinned by
 * anything: not that the tokens go to Secrets Manager rather than Postgres, not that a reconnect
 * succeeds where a naive create would fail, and not that a disconnect keeps a recovery window.
 * A comment explaining why `ForceDeleteWithoutRecovery` is unset does not stop the next edit
 * setting it.
 *
 * The SDK is mocked rather than exercised against LocalStack because what matters here is which
 * command is issued with which arguments — the same reason `libs/storage/test/s3.test.ts` mocks
 * `@aws-sdk/client-s3`.
 */

const mockSend = vi.fn();
const seen: { name: string; input: unknown }[] = [];

/** Faithful enough to the real class that `instanceof` works, which is what writeTokens branches on. */
class FakeResourceExistsException extends Error {
  constructor() {
    super('already exists');
    this.name = 'ResourceExistsException';
  }
}

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const record = (name: string) =>
    vi.fn((input: unknown) => {
      seen.push({ name, input });
      return { __type: name, input };
    });
  return {
    SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
    CreateSecretCommand: record('Create'),
    PutSecretValueCommand: record('Put'),
    GetSecretValueCommand: record('Get'),
    DeleteSecretCommand: record('Delete'),
    ResourceExistsException: FakeResourceExistsException,
  };
});

const TOKENS = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  expiresAt: 1_800_000_000_000,
  scopes: ['crm.objects.contacts.read'],
};

async function load() {
  const mod = await import('../../src/lib/crm-secrets.js');
  mod.resetSecretsClient();
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  /* The mock factory is hoisted and evaluated ONCE, so the SecretsManagerClient constructor spy
     survives resetModules and its call count accumulates across the whole file. Clearing (rather
     than resetting) drops the recorded calls while keeping the factory implementations, which is
     what lets the "constructed once" assertion below mean anything. */
  vi.clearAllMocks();
  mockSend.mockReset();
  seen.length = 0;
  delete process.env['AWS_ENDPOINT_URL'];
  delete process.env['CRM_SECRET_PREFIX'];
});

describe('crmSecretName', () => {
  it('is predictable, so an operator can find a secret without a database lookup', async () => {
    const { crmSecretName } = await load();
    expect(crmSecretName('tenant-1', 'hubspot')).toBe('psignal-dev-crm/tenant-1/hubspot');
  });

  it('honours CRM_SECRET_PREFIX, which is how the task role policy stays prefix-scoped', async () => {
    /* The IAM statement applied with ef93031 is scoped to `psignal-dev-crm/*`. A name built with a
       different prefix is not merely misfiled — it is outside the policy, so every call 403s. */
    process.env['CRM_SECRET_PREFIX'] = 'psignal-prod-crm';
    const { crmSecretName } = await load();
    expect(crmSecretName('tenant-1', 'salesforce')).toBe('psignal-prod-crm/tenant-1/salesforce');
  });
});

describe('writeTokens', () => {
  it('creates the secret on a first connection and returns its ARN', async () => {
    mockSend.mockResolvedValue({ ARN: 'arn:aws:secretsmanager:eu-west-2:1:secret:x' });
    const { writeTokens } = await load();

    const arn = await writeTokens('tenant-1', 'hubspot', TOKENS);

    expect(arn).toBe('arn:aws:secretsmanager:eu-west-2:1:secret:x');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('Create');
  });

  it('serialises every token field, so a refresh after restart is possible', async () => {
    mockSend.mockResolvedValue({ ARN: 'arn:x' });
    const { writeTokens } = await load();
    await writeTokens('tenant-1', 'hubspot', TOKENS);

    const input = seen[0]?.input as { SecretString: string };
    expect(JSON.parse(input.SecretString)).toEqual(TOKENS);
  });

  it('falls back to PutSecretValue when the secret already exists — the reconnect path', async () => {
    /* A revoked grant sends the owner back through connect. Create-then-update means that path
       succeeds; create-only would fail on exactly the journey a user is most frustrated on. */
    mockSend
      .mockRejectedValueOnce(new FakeResourceExistsException())
      .mockResolvedValueOnce({ ARN: 'arn:existing' });
    const { writeTokens } = await load();

    expect(await writeTokens('tenant-1', 'hubspot', TOKENS)).toBe('arn:existing');
    expect(seen.map((s) => s.name)).toEqual(['Create', 'Put']);
  });

  it('rethrows any error that is not ResourceExistsException', async () => {
    /* An AccessDenied must not be swallowed into an update attempt that also fails — the second
       error would replace the first and point at the wrong cause. */
    mockSend.mockRejectedValueOnce(new Error('AccessDeniedException'));
    const { writeTokens } = await load();

    await expect(writeTokens('tenant-1', 'hubspot', TOKENS)).rejects.toThrow(
      'AccessDeniedException',
    );
    expect(seen.map((s) => s.name)).toEqual(['Create']);
  });

  it('throws rather than returning an empty ARN when create returns none', async () => {
    mockSend.mockResolvedValue({});
    const { writeTokens } = await load();
    await expect(writeTokens('t', 'hubspot', TOKENS)).rejects.toThrow(/no ARN/);
  });

  it('throws rather than returning an empty ARN when the update returns none', async () => {
    mockSend.mockRejectedValueOnce(new FakeResourceExistsException()).mockResolvedValueOnce({});
    const { writeTokens } = await load();
    await expect(writeTokens('t', 'hubspot', TOKENS)).rejects.toThrow(/no ARN/);
  });
});

describe('readTokens', () => {
  it('parses the stored value back into tokens', async () => {
    mockSend.mockResolvedValue({ SecretString: JSON.stringify(TOKENS) });
    const { readTokens } = await load();
    expect(await readTokens('arn:x')).toEqual(TOKENS);
  });

  it('throws on an empty secret rather than returning undefined fields', async () => {
    /* A binary-only or emptied secret would otherwise yield `undefined` tokens and fail later, in
       the sync path, as an unauthenticated API call — a long way from the cause. */
    mockSend.mockResolvedValue({});
    const { readTokens } = await load();
    await expect(readTokens('arn:x')).rejects.toThrow('CRM secret has no value');
  });
});

describe('deleteTokens', () => {
  it('keeps a recovery window, so a misclicked disconnect is survivable', async () => {
    /* The one assertion in this file most worth having. Setting ForceDeleteWithoutRecovery turns a
       misclick into a re-consent conversation with the customer's IT department, and the only
       thing preventing it today is a comment. */
    mockSend.mockResolvedValue({});
    const { deleteTokens } = await load();
    await deleteTokens('arn:x');

    const input = seen[0]?.input as Record<string, unknown>;
    expect(seen[0]?.name).toBe('Delete');
    expect(input['RecoveryWindowInDays']).toBe(7);
    expect(input).not.toHaveProperty('ForceDeleteWithoutRecovery');
  });
});

describe('isExpired', () => {
  it('treats a token expiring inside the skew window as already expired', async () => {
    const { isExpired } = await load();
    expect(isExpired({ ...TOKENS, expiresAt: 1_000_000 }, 1_000_000 - 30_000)).toBe(true);
  });

  it('treats a token beyond the skew window as valid', async () => {
    const { isExpired } = await load();
    expect(isExpired({ ...TOKENS, expiresAt: 1_000_000 }, 1_000_000 - 90_000)).toBe(false);
  });

  it('is inclusive exactly at the boundary, so the window is a full minute', async () => {
    const { isExpired } = await load();
    expect(isExpired({ ...TOKENS, expiresAt: 1_000_000 }, 1_000_000 - 60_000)).toBe(true);
    expect(isExpired({ ...TOKENS, expiresAt: 1_000_000 }, 1_000_000 - 60_001)).toBe(false);
  });

  it('defaults now to the clock, so callers cannot forget to pass it', async () => {
    const { isExpired } = await load();
    expect(isExpired({ ...TOKENS, expiresAt: Date.now() - 1 })).toBe(true);
  });
});

describe('client construction', () => {
  it('passes no endpoint by default, so the SDK default chain and region apply', async () => {
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    mockSend.mockResolvedValue({ ARN: 'arn:x' });
    const { writeTokens } = await load();
    await writeTokens('t', 'hubspot', TOKENS);

    expect(SecretsManagerClient).toHaveBeenCalledWith({});
  });

  it('points at AWS_ENDPOINT_URL when set, which is how LocalStack is used locally', async () => {
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:4566';
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    mockSend.mockResolvedValue({ ARN: 'arn:x' });
    const { writeTokens } = await load();
    await writeTokens('t', 'hubspot', TOKENS);

    expect(SecretsManagerClient).toHaveBeenCalledWith({ endpoint: 'http://localhost:4566' });
  });

  it('reuses one client across calls rather than building one per request', async () => {
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    mockSend.mockResolvedValue({ ARN: 'arn:x' });
    const { writeTokens } = await load();
    await writeTokens('t', 'hubspot', TOKENS);
    await writeTokens('t', 'hubspot', TOKENS);

    expect(SecretsManagerClient).toHaveBeenCalledTimes(1);
  });
});
