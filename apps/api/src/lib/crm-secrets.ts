import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';


/**
 * Where a CRM's OAuth tokens live, and why they live there.
 *
 * ## Never in Postgres
 *
 * `crm_connections` holds a `secret_arn` and nothing else. `source_configs.config` — the obvious
 * place — is plain JSONB: unencrypted, readable by anyone with database access, and trivially
 * dumped into a log by a careless `SELECT *`. A rotating OAuth refresh token in that column is a
 * credential leak waiting for its first incident report, and unlike an API key it grants standing
 * access to a customer's commercial records.
 *
 * ## Never in Terraform either
 *
 * Terraform creates infrastructure; this creates the secret at connect time, from a value the
 * owner supplied through the UI, so no token enters Terraform state or a tfvars file. That is the
 * same split `infra-aws/stack/secrets.tf` already documents for the Apify and YouTube keys —
 * except those are one per deployment and these are one per tenant, which is why they cannot be
 * pre-created by Terraform at all.
 *
 * ## Never logged, never returned
 *
 * `readTokens` is the only function that produces a token value, it is called only by the sync
 * path, and no route returns its result. Everything user-facing works from the ARN and the
 * connection's status.
 *
 * ## Credentials come from the SDK default chain
 *
 * The ECS task role in a deployed environment; `AWS_ENDPOINT_URL` points it at LocalStack locally.
 * No code holds a key — the house rule this file would otherwise be the most tempting place to
 * break.
 */

export interface CrmTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms. Whether it has expired is arithmetic, not a guess. */
  expiresAt: number;
  scopes: string[];
}

let client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!client) {
    /* Region and credentials come from the SDK default chain — the ECS task role in a deployed
       environment — never from config. `endpoint` is set only for LocalStack, matching how
       `libs/storage` builds its S3 client. No code in this repository holds a key, and this file
       would otherwise be the most tempting place to break that rule. */
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    client = new SecretsManagerClient(endpoint ? { endpoint } : {});
  }
  return client;
}

/** Exported for tests, which need to drop a client built against a stubbed environment. */
export function resetSecretsClient(): void {
  client = null;
}

/**
 * One secret per tenant per provider, named predictably.
 *
 * Predictable rather than random so an operator can find a tenant's secret in the console without
 * a database lookup, and so the task role's policy can be scoped by prefix instead of granting
 * `secretsmanager:*` on `*`. The tenant id is a uuid, which is an identifier rather than a secret.
 */
export function crmSecretName(tenantId: string, provider: string): string {
  /* Prefix matches the naming Terraform uses for the stack's other secrets, so one IAM policy
     statement scoped by prefix covers them all rather than granting `secretsmanager:*` on `*`. */
  const prefix = process.env['CRM_SECRET_PREFIX'] ?? 'psignal-dev-crm';
  return `${prefix}/${tenantId}/${provider}`;
}

/**
 * Stores tokens and returns the ARN.
 *
 * Create-then-update rather than update-then-create: a first connection is the common path, and
 * `ResourceExistsException` is the cheap signal that this tenant is reconnecting — which happens
 * after a revoked grant and must succeed rather than error.
 */
export async function writeTokens(
  tenantId: string,
  provider: string,
  tokens: CrmTokens,
): Promise<string> {
  const name = crmSecretName(tenantId, provider);
  const SecretString = JSON.stringify(tokens);

  try {
    const created = await getClient().send(
      new CreateSecretCommand({
        Name: name,
        SecretString,
        Description: `Project Signal CRM tokens — tenant ${tenantId}, ${provider}`,
      }),
    );
    if (!created.ARN) throw new Error('Secrets Manager returned no ARN for the created secret');
    return created.ARN;
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
    const updated = await getClient().send(
      new PutSecretValueCommand({ SecretId: name, SecretString }),
    );
    if (!updated.ARN) throw new Error('Secrets Manager returned no ARN for the updated secret');
    return updated.ARN;
  }
}

/**
 * Reads tokens back. **The only function in the codebase that produces a token value.**
 *
 * Called by the sync path and nothing else. No route returns this, and nothing logs it — a token
 * in a CloudWatch log group is as exposed as one in a database column, and rather harder to
 * notice.
 */
export async function readTokens(secretArn: string): Promise<CrmTokens> {
  const result = await getClient().send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) throw new Error('CRM secret has no value');
  return JSON.parse(result.SecretString) as CrmTokens;
}

/**
 * Removes the secret when a connection is disconnected.
 *
 * `ForceDeleteWithoutRecovery` is deliberately NOT set: Secrets Manager's recovery window is what
 * makes an accidental disconnect survivable, and a revoked OAuth grant is useless to an attacker
 * anyway. Deleting immediately would turn a misclick into a re-consent conversation with the
 * customer's IT department.
 */
export async function deleteTokens(secretArn: string): Promise<void> {
  await getClient().send(
    new DeleteSecretCommand({ SecretId: secretArn, RecoveryWindowInDays: 7 }),
  );
}

/** Expired is arithmetic. A minute of slack covers clock skew between us and the provider. */
export function isExpired(tokens: CrmTokens, now: number = Date.now()): boolean {
  return tokens.expiresAt <= now + 60_000;
}
