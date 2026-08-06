import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { tenants } from './tenants';

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    source: varchar('source', { length: 50 }).notNull(),
    sourceUrl: text('source_url').notNull(),
    rawStorageRef: text('raw_storage_ref').notNull(),
    // Sentiment lives in `sentiment_results`, keyed one-to-one on signal_id, and is read by
    // joining. `signals` previously carried sentiment_label / sentiment_score / confidence /
    // model_version as well — a second home for the same data that nothing ever wrote
    // (KNOWN-GAPS #11). They were dropped rather than adopted as a read cache: two plausible
    // homes invite a future writer to pick the wrong one and split the truth. If a
    // denormalised cache is ever wanted for list performance, reintroduce it deliberately,
    // maintained by the sentiment worker in the same transaction as the results row.
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('signals_tenant_brand_idx').on(t.tenantId, t.brandEntityId),
    index('signals_published_at_idx').on(t.publishedAt),
    unique('signals_source_url_brand_entity_id_unique').on(t.sourceUrl, t.brandEntityId),
  ],
);
