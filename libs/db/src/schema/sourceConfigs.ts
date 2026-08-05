/**
 * source_configs — one row per (brand_entity, source) pair.
 *
 * The `config` JSONB column holds source-specific settings. Shapes by source:
 *
 *   google_reviews: { placeId: string, placeName?: string }
 *   youtube:        { channelId: string, maxResults?: number }
 *   app_store:      { appId: string, country?: string }   -- RSS feed, no auth needed
 *   play_store:     { appId: string }                     -- RSS feed, no auth needed
 *   rss:            { feedUrl: string }
 *
 * System-level credentials (e.g. APIFY_API_KEY, YOUTUBE_API_KEY) are NOT stored
 * here — they live in environment variables / Secret Manager and are resolved at
 * runtime via getEnv().
 */
import {
  boolean,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { tenants } from './tenants';

export const sourceConfigs = pgTable(
  'source_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    source: varchar('source', { length: 50 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    // Source-specific settings — shape varies by source, see comment above.
    config: jsonb('config').notNull().default({}),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.brandEntityId, t.source),
  }),
);
