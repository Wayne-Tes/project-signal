/**
 * source_configs — one row per configured feed. **Many rows per source type are expected.**
 *
 * This table used to carry `unique(brand_entity_id, source)`, and the create endpoint upserted
 * onto it. One feed of each type per brand was therefore the hard limit — and the failure was
 * silent: adding a second RSS feed did not fail, it OVERWROTE the first, and the list then showed
 * one row as though that had always been the whole configuration. A brand tracking
 * `"Tes Global"` and `"Tes MyConcern"` on Google News could only ever have one of them, and
 * nothing said which.
 *
 * That constraint was never load-bearing. Every consumer already works off `source_configs.id`:
 * `apps/ingestion/src/main.ts` and `scanConsumer.ts` select ids, and `handler.ts` fetches one row
 * by id, so the collection pipeline has always handled many rows of the same type correctly.
 *
 * The `config` JSONB column holds source-specific settings. Shapes by source:
 *
 *   google_reviews: { placeId: string, placeName?: string }
 *   youtube:        { channelId: string, maxResults?: number }
 *   app_store:      { appId: string, country?: string }   -- RSS feed, no auth needed
 *   play_store:     { appId: string }                     -- RSS feed, no auth needed
 *   rss:            { feedUrl: string }
 *   reddit:         { query: string, subreddit?: string, sort?: string }
 *
 * System-level credentials (e.g. APIFY_API_KEY, YOUTUBE_API_KEY) are NOT stored
 * here — they live in environment variables / Secret Manager and are resolved at
 * runtime via getEnv().
 */
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
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
    /**
     * What a person calls this feed.
     *
     * Once a brand can have six RSS feeds, "rss" identifies none of them. Nullable, because every
     * row that existed before this column did so without one; the UI falls back to summarising the
     * config, which is honest but far less readable than "Google News — Tes MyConcern".
     */
    label: varchar('label', { length: 120 }),
    /**
     * Where this feed collects from — the AUTHORITY for a signal's territory.
     *
     * A brand is not British; a feed is. `@TeachStarterUSA` and `@TeachStarter` are the same
     * product in two countries, which is why this sits here rather than on `brand_entities`, and
     * why the marketing team's channel sheet has one country per channel rather than per brand.
     *
     * ISO 3166-1 alpha-2, `GLOBAL`, or `unknown`. Validated against `TERRITORIES` in shared-types
     * by the API — a varchar here would otherwise accept `UK`, which is not an assigned ISO code
     * and would split Great Britain across two values.
     *
     * Defaults to `unknown` rather than to a guess: every feed that existed before this column
     * did so without a territory, and inventing one for them would produce reporting that is
     * confidently wrong.
     */
    territory: varchar('territory', { length: 16 }).notNull().default('unknown'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    // Source-specific settings — shape varies by source, see comment above.
    config: jsonb('config').notNull().default({}),
    /** When collection last SUCCEEDED. Only written after a fetch that returned. */
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    /**
     * When collection was last ATTEMPTED, and why it failed if it did.
     *
     * `lastFetchedAt` alone made the UI lie. It is written at the end of a successful run, so a
     * feed whose adapter throws — an expired Apify key, a 404 feed URL, a channel id that is
     * really a URL — never gets a timestamp and reads as **"never run"** forever, however many
     * times it has been attempted and failed. The owner saw exactly that: five feeds marked
     * "never run" after twelve hourly scans had each tried and failed them.
     *
     * The scan's own error string aggregates every failure into one line on `scan_runs`, which
     * tells you something broke but not WHICH feed. These two columns put the failure on the row
     * the user has to fix.
     */
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    /** The last failure, verbatim. Null once a run succeeds. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* The list query is always (tenant, brand), and with many feeds per brand it is worth an
       index. There is deliberately NO unique constraint — see the note at the top of this file.
       Two feeds of the same type are the point. An accidental *exact* duplicate is refused by the
       create endpoint, which compares the config, because that produces a message someone can
       read rather than a constraint violation they cannot. */
    byBrand: index('source_configs_tenant_brand_idx').on(t.tenantId, t.brandEntityId),
  }),
);
