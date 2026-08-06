import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const brandEntities = pgTable('brand_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  isOwned: boolean('is_owned').notNull().default(true),
  // Per-brand Brand Perception Index weights, e.g. {"trust":0.3,"quality":0.2,...}.
  // The product spec makes dimension weights configurable per brand; null means the equal
  // default in @project-signal/scoring. Kept as jsonb rather than five columns so adding or
  // reweighting a dimension is not a migration.
  dimensionWeights: jsonb('dimension_weights'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
