/**
 * brand_aliases — alternative names / abbreviations for a brand entity.
 *
 * One brand can be referred to by several names (e.g. "Cadence", "Cadence Bank",
 * "CDN"). Aliases let ingestion/scoring match mentions that don't use the canonical
 * brand name. Unique per (brand_entity, alias).
 */
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { tenants } from './tenants';

export const brandAliases = pgTable(
  'brand_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    alias: text('alias').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.brandEntityId, t.alias),
  }),
);
