import {
  boolean,
  real,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * brand_entities — brands, and the products beneath them.
 *
 * A product is a brand entity with a parent, NOT a separate table. Every downstream table keys
 * off `brand_entity_id` — signals, dimension_scores, source_configs, brand_aliases — as does
 * every API route and view, so a product modelled this way inherits the whole product surface
 * (its own index, dimensions, Brand impact, drill-down, report, assistant tools) for the cost of
 * this migration. A separate products table would have duplicated the entire scoring path.
 *
 * See docs/PLAN-product-hierarchy.md.
 */
export const brandEntities = pgTable('brand_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  /**
   * Parent entity, or null for a root brand.
   *
   * Self-referencing, so depth is arbitrary — brand → division → product needs no further
   * migration. `AnyPgColumn` is required because the type is circular and TypeScript cannot
   * infer it.
   *
   * CYCLES ARE NOT PREVENTED HERE. Postgres cannot express "may not be its own ancestor" as a
   * simple constraint, and a cycle turns every recursive query into an infinite loop. The API
   * walks the ancestor chain on write; see apps/api/src/routes/brands.ts.
   */
  parentId: uuid('parent_id').references((): AnyPgColumn => brandEntities.id),
  /**
   * 'brand' or 'product'. Presentation and grouping only — the scoring path treats them
   * identically, which is the point of modelling them in one table.
   */
  kind: varchar('kind', { length: 16 }).notNull().default('brand'),
  /**
   * Orthogonal to the hierarchy, and deliberately so: a COMPETITOR can have products too, which
   * is how one portfolio is compared against another.
   */
  isOwned: boolean('is_owned').notNull().default(true),
  // Per-brand Brand Perception Index weights, e.g. {"trust":0.3,"quality":0.2,...}.
  // The product spec makes dimension weights configurable per brand; null means the equal
  // default in @project-signal/scoring. Kept as jsonb rather than five columns so adding or
  // reweighting a dimension is not a migration.
  dimensionWeights: jsonb('dimension_weights'),
  /**
   * The Brand Perception Index this brand is aiming at, 0–100. Null means none was set.
   *
   * NULL IS NOT ZERO AND NOT A DEFAULT. When it is null the API derives a target from the tracked
   * competitor set instead, and says so — a target with no stated provenance is just a number, and
   * a number nobody chose is one nobody defends in a meeting.
   *
   * There is deliberately no fallback constant. The Brand Perception Index is defined by this
   * codebase, so no external body publishes a benchmark for it; picking a plausible-looking 75
   * would be inventing an industry standard, which is exactly the fabrication that put "+3.4 pts"
   * on a fictional bank's roadmap. With nothing measurable to aim at, the honest answer is that
   * there is no target yet.
   */
  targetScore: real('target_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* "this tenant's children of X", which is every tree read. Without it, building the tree for a
     tenant with twenty products is a sequential scan per level. */
  byParent: index('brand_entities_tenant_parent_idx').on(t.tenantId, t.parentId),
}));
