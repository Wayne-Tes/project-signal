import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: mockSend })),
  // Return the input verbatim so assertions can read the command's shape directly.
  AdminUpdateUserAttributesCommand: vi.fn((input) => input),
}));

const mockEnv = vi.hoisted(() => ({ value: {} as Record<string, string | undefined> }));
vi.mock('@project-signal/config', () => ({ getEnv: () => mockEnv.value }));

import { setUserClaims } from '../../src/lib/claims.js';

/**
 * These cover the mapping from the authorisation model onto Cognito's wire format. The route
 * tests mock setUserClaims itself, because they are about the transactional guarantee
 * (KNOWN-GAPS #18) rather than about attribute arrays — so this is the only place the mapping
 * is actually checked.
 */
describe('setUserClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.value = { COGNITO_USER_POOL_ID: 'eu-west-2_test' };
  });

  it('writes role, tenantId and brandEntityId as custom attributes', async () => {
    await setUserClaims('cognito-sub-1', {
      role: 'admin',
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      UserPoolId: 'eu-west-2_test',
      Username: 'cognito-sub-1',
      UserAttributes: [
        { Name: 'custom:role', Value: 'admin' },
        { Name: 'custom:tenantId', Value: 'tenant-1' },
        { Name: 'custom:brandEntityId', Value: 'brand-1' },
      ],
    });
  });

  it('clears the brand pin with an empty string rather than omitting it', async () => {
    // Cognito's update call has no "delete attribute" — omitting the attribute leaves the OLD
    // pin in place. An unpinned user would silently keep their previous brand restriction, which
    // is a stale-authorisation bug of exactly the kind claims/table divergence causes.
    await setUserClaims('cognito-sub-1', {
      role: 'user',
      tenantId: 'tenant-1',
      brandEntityId: null,
    });

    const command = mockSend.mock.calls[0]![0] as {
      UserAttributes: Array<{ Name: string; Value: string }>;
    };
    expect(command.UserAttributes).toContainEqual({ Name: 'custom:brandEntityId', Value: '' });
  });

  it('refuses to write when no user pool is configured', async () => {
    // Throwing propagates out of the caller's database transaction and rolls the users row back.
    // Succeeding silently would create a row whose holder could never be authorised.
    mockEnv.value = {};

    await expect(
      setUserClaims('cognito-sub-1', { role: 'owner', tenantId: 'tenant-1' }),
    ).rejects.toThrow(/COGNITO_USER_POOL_ID/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
