import { index, pgTable, uuid, varchar, real, integer, date, unique } from 'drizzle-orm/pg-core';
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
    /**
     * Which territory this row covers, or `'all'` for the combined figure.
     *
     * **NOT NULL WITH A SENTINEL, AND THAT IS LOAD-BEARING.** Postgres treats NULLs as DISTINCT
     * in a unique constraint, so a nullable column here would let the aggregate row violate
     * uniqueness silently: `ON CONFLICT` would stop matching, the rollup's hourly upsert would
     * start appending instead of updating, and the table would grow a duplicate set of rows every
     * hour, forever, with no error anywhere. `NULLS NOT DISTINCT` exists from PG 15 but pins the
     * schema's correctness to a server version; a sentinel does not.
     *
     * `'all'` is deliberately not a value any SIGNAL can carry — see `TERRITORY_ALL` in
     * shared-types. A signal is from somewhere or from `unknown`; only an aggregate is from
     * everywhere.
     */
    territory: varchar('territory', { length: 16 }).notNull().default('all'),
    score: real('score').notNull(),
    signalCount: integer('signal_count').notNull().default(0),
  },
  (t) => ({
    /* NAMED EXPLICITLY. Drizzle's default would be
       `dimension_scores_brand_entity_id_date_dimension_territory_unique` — 64 characters, one
       over Postgres's identifier limit, so the server silently truncates the trailing `e`. The
       constraint still works, but drizzle's snapshot records the untruncated name, so the first
       future migration that drops or renames it would emit a `DROP CONSTRAINT` naming something
       that does not exist and fail against a real database while passing every test here. */
    uniq: unique('dimension_scores_brand_date_dim_territory_uniq').on(
      t.brandEntityId,
      t.date,
      t.dimension,
      t.territory,
    ),
    /* The trend query's access pattern: one brand, one territory, ordered by date. */
    byTerritory: index('dimension_scores_brand_territory_date_idx').on(
      t.brandEntityId,
      t.territory,
      t.date,
    ),
  }),
);
