import { index, pgTable, real, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
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
    sentimentLabel: varchar('sentiment_label', { length: 20 }),
    sentimentScore: real('sentiment_score'),
    confidence: real('confidence'),
    modelVersion: varchar('model_version', { length: 50 }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('signals_tenant_brand_idx').on(t.tenantId, t.brandEntityId),
    index('signals_published_at_idx').on(t.publishedAt),
    unique('signals_source_url_brand_entity_id_unique').on(t.sourceUrl, t.brandEntityId),
  ],
);
