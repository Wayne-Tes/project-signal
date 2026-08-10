import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { sourceConfigs } from './sourceConfigs';
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
    /**
     * WHICH configured feed produced this signal.
     *
     * `source` says "rss". Once a brand has six RSS feeds, that no longer identifies anything —
     * you cannot tell which feed is productive, which is dead, or which one brought in the
     * results a report is built on. This column is what makes multiple feeds of one type legible
     * rather than merely permitted.
     *
     * It also fixes a watermark defect that only appears once they exist. Ingestion asked "what
     * is the newest signal for this brand and this SOURCE TYPE?" and passed that as the `since`
     * cutoff. With two RSS feeds, a busy one — Google News, hourly — would push the watermark to
     * now, and a quieter one would then have everything it published filtered out as too old, on
     * every run, permanently. The watermark is per feed because collection is per feed.
     *
     * Nullable: every signal collected before this column existed has no feed to point at, and
     * inventing one would be a lie. `set null` on delete, so removing a feed does not delete the
     * evidence it gathered — that history belongs to the brand, not to the configuration.
     */
    sourceConfigId: uuid('source_config_id').references(() => sourceConfigs.id, {
      onDelete: 'set null',
    }),
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
    /* The per-feed watermark query — max(published_at) for one source config — runs once per
       feed on every collection run, so it is the hottest new query in the pipeline. */
    index('signals_source_config_idx').on(t.sourceConfigId, t.publishedAt),
    unique('signals_source_url_brand_entity_id_unique').on(t.sourceUrl, t.brandEntityId),
  ],
);
