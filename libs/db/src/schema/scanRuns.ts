import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { tenants } from './tenants';

/**
 * scan_runs — one record per collection run, and the reason the scan button is usable.
 *
 * Without this the user presses Scan and nothing observable happens: collection is asynchronous,
 * takes minutes, and writes signals that will not appear on a dashboard until a rollup has also
 * run. A button whose only feedback is "the number might change later" is one people press
 * repeatedly and then distrust. This is what turns it into *queued → running → 47 signals
 * collected*.
 *
 * It also carries the debounce. A scan hits third-party APIs with per-account quotas, so
 * "is one already running for this brand" has to be a question the API can answer cheaply and
 * atomically, not a guess.
 *
 * See docs/PLAN-product-hierarchy.md phase 4.
 */
export const scanRuns = pgTable(
  'scan_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The entity the scan was requested for. Its sources are the ones fetched. */
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    /**
     * `queued` | `running` | `completed` | `failed`.
     *
     * Deliberately a varchar rather than a pg enum: adding a state to an enum is a migration and
     * a lock, and this set will grow (`cancelled`, `partial`) as the feature is used.
     */
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    /** `manual` or `scheduled`. Distinguishes a user's click from the timer. */
    trigger: varchar('trigger', { length: 16 }).notNull().default('manual'),
    /** Identity-provider subject of whoever pressed the button; null for scheduled runs. */
    requestedBy: varchar('requested_by', { length: 128 }),
    /** Sources attempted, and how many produced signals — the numbers the user is shown. */
    sourcesAttempted: integer('sources_attempted').notNull().default(0),
    sourcesSucceeded: integer('sources_succeeded').notNull().default(0),
    signalsCollected: integer('signals_collected').notNull().default(0),
    /**
     * Why it failed, in words a person can act on.
     *
     * A failed scan that says only "failed" sends someone to the logs, which they cannot reach.
     */
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    /* "the recent runs for this brand", which is both the history list and the debounce check. */
    byBrand: index('scan_runs_brand_started_idx').on(t.tenantId, t.brandEntityId, t.startedAt),
  }),
);
