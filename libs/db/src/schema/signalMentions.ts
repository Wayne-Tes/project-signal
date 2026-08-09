import { index, pgTable, real, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { signals } from './signals';
import { tenants } from './tenants';

/**
 * signal_mentions — which entities a signal TALKS ABOUT, as opposed to where it came from.
 *
 * `signals.brand_entity_id` is the HARD attribution: the source config the signal arrived
 * through. A review on Tes Assess's App Store listing is a signal *of* Tes Assess.
 *
 * This table is the SOFT attribution: a news article about Tes that names three products is one
 * signal talking about four entities. A single foreign key cannot express that, and collapsing
 * the two would lose a distinction that matters — "this review is of product X" and "this
 * article about the group mentions X" are different claims, and only the first should be read as
 * direct feedback on X.
 *
 * Populated by the scorer, which already reads the full text and is given the tenant's product
 * names and aliases as candidates. It identifies mentions of KNOWN entities only; it does not
 * invent new ones from the text. For twenty acquired brands, keeping the taxonomy under human
 * control matters more than coverage.
 *
 * `tenant_id` is denormalised here for the same reason it is on `conversation_messages`: this
 * product has no row-level security, so the safe query must not require a join to be safe.
 *
 * See docs/PLAN-product-hierarchy.md.
 */
export const signalMentions = pgTable(
  'signal_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * How sure the model was that this signal is about this entity, 0 to 1.
     *
     * Kept so a future rollup can weight or threshold on it. Nothing filters on it yet — doing
     * so before there is real data to calibrate against would be picking a number out of the air.
     */
    confidence: real('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* Re-scoring a signal must not duplicate its mentions. */
    uniq: unique().on(t.signalId, t.brandEntityId),
    /* The rollup's read pattern: "every signal mentioning this entity, for this tenant". */
    byEntity: index('signal_mentions_entity_idx').on(t.tenantId, t.brandEntityId),
  }),
);
