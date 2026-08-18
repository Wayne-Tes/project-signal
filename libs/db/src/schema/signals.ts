import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
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
    /**
     * Where this signal came from, COPIED from the source config at insert time.
     *
     * Denormalised deliberately, for three reasons:
     *
     *   1. `source_config_id` is nullable and `ON DELETE SET NULL`. Resolving territory by join
     *      would erase it for every signal a feed ever collected the moment that feed is deleted —
     *      and the comment on that column already says the evidence belongs to the brand, not to
     *      the configuration.
     *   2. Every rollup and trend query filters on it. A join for a value that never changes for
     *      a given row is waste on the hottest path in the product.
     *   3. Same rule as `tenant_id` on `signal_mentions`: with no row-level security, the safe
     *      query must not require a join to be safe.
     *
     * **CHANGING A FEED'S TERRITORY DOES NOT REWRITE HISTORY.** A signal was collected from a feed
     * that was UK at the time, and that is a fact about the past. Correcting a misconfiguration is
     * an explicit backfill, not a silent side effect of an edit — the UI says so when the field is
     * changed.
     */
    territory: varchar('territory', { length: 16 }).notNull().default('unknown'),
    /**
     * WHO WROTE THE WORDS: `direct` (the customer) or `reported` (an employee's account of what a
     * customer said).
     *
     * **THIS IS A CORRECTNESS CONTROL, NOT A LABEL.** A Customer Success manager writes a note
     * BECAUSE something needs attention, which makes CRM sentiment a work queue rather than a
     * sample. It is structurally negative-biased, and that bias is not a flaw to correct — it is
     * what the channel is for.
     *
     * Averaging it into the Brand Perception Index would drag the index down for reasons that have
     * nothing to do with brand perception changing, and **nobody would be able to see why**,
     * because the number would still look entirely plausible. That is the most expensive class of
     * defect this project produces: a number that is wrong and looks right.
     *
     * So the index is computed over `direct` only, by default. `reported` is collected, scored,
     * trended and drillable on its own terms, and can be included explicitly with a visible toggle
     * that says what it changes.
     *
     * Every public source is `direct`, which is why that is the default — a column added for the
     * CRM must not silently reclassify four hundred existing signals.
     */
    voice: varchar('voice', { length: 16 }).notNull().default('direct'),
    /**
     * The customer account this signal is about. Null for every public signal.
     *
     * `set null` on delete rather than cascade: removing an account from the CRM must not delete
     * the evidence of what they said, for the same reason deleting a feed does not delete its
     * signals. That history belongs to the brand.
     */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    rawStorageRef: text('raw_storage_ref').notNull(),
    /**
     * THE WORDS SOMEBODY ACTUALLY WROTE. The reason this table exists.
     *
     * Until this column, the verbatim text was written to S3 and then unreachable: `signals` held
     * only `raw_storage_ref`, no endpoint read it back, and the drill-down could therefore show a
     * source name, a date and a link — nothing a person could read. The owner's words: *"If you
     * have a review, I want to see the review in the window in the app."* Correct. Following a URL
     * out to the original, correlating it by hand, and coming back to a closed drawer is not a
     * product; it is a worse version of a spreadsheet.
     *
     * `raw_storage_ref` and the S3 object STAY. That object is the untouched payload — the audit
     * trail, and the only place the original markup survives. This column is the readable form:
     * markup stripped, title joined to body, clamped to `MAX_CONTENT_LENGTH`. The two are
     * deliberately different things, and the S3 copy is what proves this one was not tampered
     * with.
     *
     * Nullable, because every row collected before this column existed has no text here until the
     * backfill has run over it. Null means "not yet recovered from S3", NOT "the source said
     * nothing" — the UI must not render those the same way.
     */
    content: text('content'),
    /**
     * The headline, where the source has one distinct from the body.
     *
     * Separate from `content` rather than merged into it, because a review's title carries most
     * of its sentiment ("Constant crashes") and a list of signals is unreadable without one.
     * Null where the source genuinely has no title — a Play Store review, a Google review — which
     * is different from an empty one.
     */
    title: text('title'),
    /** Who said it, as the source names them. Null for sources with no author, e.g. RSS. */
    author: varchar('author', { length: 200 }),
    /**
     * Star rating on the source's own 1–5 scale, where it has one.
     *
     * Normalised here because the adapters disagreed: `rating` on the App Store and Play Store,
     * `stars` on Google. A UI reading raw metadata would have to know every alias and would
     * silently render nothing for the next source added.
     */
    rating: integer('rating'),
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
