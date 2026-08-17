import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * accounts — the customer a CRM interaction is about.
 *
 * ## Why not a brand entity
 *
 * Reusing `brand_entities` was considered and rejected. A customer is not a brand: putting
 * hundreds of them in that tree would pollute the brand switcher, the portfolio rollup and
 * competitor comparison all at once, and every one of those surfaces would need a filter to
 * exclude them. An account is a genuinely different axis, orthogonal to brand, product and
 * territory.
 *
 * ## `arr_band`, never an ARR figure
 *
 * A band makes "weight this theme by commercial exposure" possible without importing revenue
 * data. That matters twice over: the revenue uplift model is an open question in the product spec
 * (§9) that this does not pretend to answer, and an exact contract value is materially more
 * sensitive than a bucket. The band is enough to rank; the number is somebody else's to hold.
 *
 * ## Ranking by accounts, not by volume
 *
 * The reason this table exists at all. In the CRM channel, one renewal-risk note from a 250k+
 * account is not one-fiftieth of fifty app-store reviews, and ranking by raw volume — which is
 * what every other view does — would bury it. Themes here are ranked by distinct accounts
 * affected and their bands.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Which CRM this came from — the same vocabulary as `crm_connections.provider`. */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** The record id in that CRM. What makes a re-sync an update rather than a duplicate. */
    externalId: varchar('external_id', { length: 128 }).notNull(),

    name: text('name').notNull(),
    /** Primary web domain, where the CRM holds one. Useful for matching, never for identifying. */
    domain: text('domain'),
    /** Free-form segment as the CRM labels it — every organisation names these differently. */
    segment: varchar('segment', { length: 64 }),
    /**
     * Commercial exposure as a BAND: `<10k` | `10-50k` | `50-250k` | `250k+` | null.
     *
     * Deliberately not a number. See the note above.
     */
    arrBand: varchar('arr_band', { length: 16 }),
    /** The CSM or AE the CRM has against the account. A routing hint for whoever acts. */
    ownerName: varchar('owner_name', { length: 200 }),
    /** Where the account is, reusing the same vocabulary as `signals.territory`. */
    territory: varchar('territory', { length: 16 }).notNull().default('unknown'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* Re-syncing must update rather than duplicate. Without this, every sync would multiply the
       account list and every "distinct accounts affected" count would inflate with it. */
    uniqExternal: unique('accounts_tenant_provider_external_uniq').on(
      t.tenantId,
      t.provider,
      t.externalId,
    ),
    byTenant: index('accounts_tenant_idx').on(t.tenantId, t.arrBand),
  }),
);
