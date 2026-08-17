import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * crm_connections — one tenant's link to their CRM.
 *
 * ## Why this is not a `source_config`
 *
 * Every collector so far is public, pull-based, and authenticated with ONE system-wide credential:
 * `getSystemCredentials()` hands every tenant the same Apify token and the same YouTube key. A CRM
 * link breaks that model in three ways, and this table exists because of the first.
 *
 *   1. It is **per tenant**, obtained by an OAuth flow, and its refresh token rotates.
 *   2. It reaches **personal data** about named individuals. See `signals.voice` and
 *      `docs/PLAN-change-territory-and-actions.md` §8.3.
 *   3. The voice it collects is **second-hand** — an employee's account of what a customer said.
 *
 * ## The token is not here
 *
 * `secret_arn` points at AWS Secrets Manager; the credential itself never touches this table.
 * `source_configs.config` is plain JSONB — unencrypted, readable by anyone with database access,
 * and trivially dumped into a log by a careless `SELECT *`. A rotating OAuth refresh token in that
 * column would be a credential leak waiting for its first incident report.
 *
 * Terraform creates the secret and deliberately does not own its value, the same split
 * `infra-aws/stack/secrets.tf` already uses, so no token enters Terraform state or a tfvars file.
 *
 * ## `last_attempted_at` and `last_error` mirror `source_configs` on purpose
 *
 * A connection whose refresh token has expired must show WHY, on the row someone can fix. That
 * exact defect has already been fixed once on feeds: five of this tenant's showed "never run"
 * after twelve hourly scans had each attempted and failed them, because only success wrote a
 * timestamp.
 */
export const crmConnections = pgTable(
  'crm_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** `hubspot` | `salesforce`. Validated against `CRM_PROVIDERS` in shared-types on write. */
    provider: varchar('provider', { length: 32 }).notNull(),
    /**
     * Salesforce is per-instance (`https://acme.my.salesforce.com`); HubSpot is not.
     *
     * Nullable rather than defaulted, because a wrong instance URL points at another company's
     * org — which is the kind of mistake that looks like it worked.
     */
    instanceUrl: text('instance_url'),
    /** ARN of the Secrets Manager secret holding the tokens. Never the tokens themselves. */
    secretArn: text('secret_arn').notNull(),
    /** Scopes granted, so a later feature can tell whether it needs re-consent. */
    scopes: text('scopes').array().notNull().default([]),
    /** Identity-provider subject of whoever connected it — an audit question, always asked. */
    connectedBy: varchar('connected_by', { length: 128 }).notNull(),

    /** `active` | `expired` | `revoked` | `disabled`. Varchar, because this set will grow. */
    status: varchar('status', { length: 16 }).notNull().default('active'),

    /** When a sync last SUCCEEDED. Only written after a fetch that returned. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** When one was last ATTEMPTED, and why it failed if it did. See the note above. */
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* One connection per provider per tenant. Two links to the same CRM would double every
       interaction collected, and the duplicates would look like genuine extra volume. */
    uniqProvider: unique('crm_connections_tenant_provider_uniq').on(t.tenantId, t.provider),
    byTenant: index('crm_connections_tenant_idx').on(t.tenantId, t.status),
  }),
);
