import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  InvalidRequestException,
  PutSecretValueCommand,
  ResourceExistsException,
  RestoreSecretCommand,
  SecretsManagerClient,
  type Tag,
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
 * Tags for a secret this process creates.
 *
 * Without tags a runtime-created secret is invisible to `infra-aws/scripts/99-teardown.sh`, which
 * inventories the shared account BY THE `Project` TAG precisely so it can see what Terraform state
 * cannot — and these secrets are never in Terraform state. Values come from RESOURCE_TAGS, which
 * Terraform injects from the same variables as the stack's default_tags; `Project` is guaranteed
 * even when that is unset (local development), because it is the key the inventory filters on.
 * `ManagedBy=api` records that no Terraform module owns the resource.
 */
export function secretTags(): Tag[] {
  let configured: Record<string, string> = {};
  const raw = process.env['RESOURCE_TAGS'];
  if (raw) {
    /* Validated as a JSON object of strings by libs/config at API boot; parsed defensively here
       anyway, so a bad value can never stop a secret being written. */
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        configured = Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        );
      }
    } catch {
      configured = {};
    }
  }
  const tags: Record<string, string> = {
    Project: 'project-signal',
    ...configured,
    ManagedBy: 'api',
  };
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/** What `writeTokens` did: the ARN, and whether this call brought the secret into being. */
export interface WrittenSecret {
  arn: string;
  /**
   * True when the secret did not exist as a live secret before this call — created, or restored
   * from scheduled deletion. A caller whose later step fails uses it to undo exactly what it did,
   * and nothing more: deleting a secret that an existing connection already relies on would
   * break that connection.
   */
  created: boolean;
}

/** Secrets Manager's refusal for a name whose previous secret is inside its recovery window. */
function isScheduledForDeletion(err: unknown): boolean {
  return (
    err instanceof InvalidRequestException && /scheduled for deletion/i.test(err.message ?? '')
  );
}

/**
 * Stores tokens and returns the ARN, and whether the secret is new.
 *
 * Create-then-update rather than update-then-create: a first connection is the common path, and
 * `ResourceExistsException` is the cheap signal that this tenant is reconnecting — which happens
 * after a revoked grant and must succeed rather than error.
 *
 * RECONNECTING AFTER A DISCONNECT. A disconnect schedules the secret for deletion with a recovery
 * window (`deleteTokens`). Inside that window Secrets Manager refuses BOTH CreateSecret and
 * PutSecretValue for the name, so reconnecting within a week of disconnecting used to fail with a
 * 500. The secret is restored first, then written.
 */
export async function writeTokens(
  tenantId: string,
  provider: string,
  tokens: CrmTokens,
): Promise<WrittenSecret> {
  const name = crmSecretName(tenantId, provider);
  const SecretString = JSON.stringify(tokens);

  const put = async (created: boolean): Promise<WrittenSecret> => {
    const updated = await getClient().send(
      new PutSecretValueCommand({ SecretId: name, SecretString }),
    );
    if (!updated.ARN) throw new Error('Secrets Manager returned no ARN for the updated secret');
    return { arn: updated.ARN, created };
  };

  try {
    const created = await getClient().send(
      new CreateSecretCommand({
        Name: name,
        SecretString,
        Description: `Project Signal CRM tokens — tenant ${tenantId}, ${provider}`,
        Tags: secretTags(),
      }),
    );
    if (!created.ARN) throw new Error('Secrets Manager returned no ARN for the created secret');
    return { arn: created.ARN, created: true };
  } catch (err) {
    if (err instanceof ResourceExistsException) return put(false);
    if (isScheduledForDeletion(err)) {
      await getClient().send(new RestoreSecretCommand({ SecretId: name }));
      return put(true);
    }
    throw err;
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
  await getClient().send(new DeleteSecretCommand({ SecretId: secretArn, RecoveryWindowInDays: 7 }));
}

/** Expired is arithmetic. A minute of slack covers clock skew between us and the provider. */
export function isExpired(tokens: CrmTokens, now: number = Date.now()): boolean {
  return tokens.expiresAt <= now + 60_000;
}
