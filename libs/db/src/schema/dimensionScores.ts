import { pgTable, uuid, varchar, real, integer, date, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { brandEntities } from './brands';

export const dimensionScores = pgTable(
  'dimension_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    brandEntityId: uuid('brand_entity_id').notNull().references(() => brandEntities.id),
    date: date('date').notNull(),
    dimension: varchar('dimension', { length: 20 }).notNull(),
    score: real('score').notNull(),
    signalCount: integer('signal_count').notNull().default(0),
  },
  (t) => ({
    uniq: unique().on(t.brandEntityId, t.date, t.dimension),
  }),
);
