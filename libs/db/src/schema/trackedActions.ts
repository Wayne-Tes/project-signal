import { index, integer, pgTable, real, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { brandEntities } from './brands';
import { tenants } from './tenants';

/**
 * tracked_actions — an action somebody committed to, and what happened afterwards.
 *
 * ## Why this exists, and why it comes BEFORE any advice
 *
 * The roadmap can now say what a subject is worth. It could not say whether acting on it ever
 * worked. Without that, every recommendation is unfalsifiable: you cannot ask "does this advice
 * help" because nothing records what was tried, when, or from what starting point.
 *
 * This table is what turns the roadmap from a list into an experiment log — and it is deliberately
 * built first, because **a baseline cannot be retrofitted**. A row created after the fact has to
 * guess where the index stood when the work began, and a guessed baseline makes every subsequent
 * verdict a guess too.
 *
 * ## The baseline columns are immutable by convention
 *
 * `baseline_*` is stamped once, at accept, and never updated. The whole value of the record is
 * that it says where things stood *before* — a baseline that drifts is not a baseline. Nothing in
 * the API updates them; only `status`, `note` and `completed_at` change after creation.
 *
 * ## Why the verdict is not stored
 *
 * There is no `verdict` column, and that is a decision rather than an omission. The outcome is
 * computed on read from `dimension_scores`, which already holds a daily series per brand, per
 * territory. Storing a verdict would mean recomputing and rewriting it on a schedule, and a stale
 * verdict — "improved" on a subject that has since collapsed — is worse than no verdict. The same
 * reasoning as the portfolio index, which is computed on read for exactly this reason.
 *
 * `ceiling_delta` IS stored, because it is a claim we made at a moment in time and the point is to
 * check it later. Recomputing it would quietly rewrite history to match the outcome, which is the
 * one thing that would make the whole log worthless.
 */
export const trackedActions = pgTable(
  'tracked_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    brandEntityId: uuid('brand_entity_id')
      .notNull()
      .references(() => brandEntities.id),
    /** The cluster topic this action addresses, normalised lower-case as the clusterer emits it. */
    topic: text('topic').notNull(),
    /** Scope it was accepted under, so a UK action is not judged against global numbers. */
    territory: varchar('territory', { length: 16 }).notNull().default('all'),

    /** `accepted` | `completed` | `abandoned`. Varchar not enum — this set will grow. */
    status: varchar('status', { length: 16 }).notNull().default('accepted'),

    /* --- Baseline: stamped once, never updated. --------------------------------------------- */
    baselineAt: timestamp('baseline_at', { withTimezone: true }).notNull().defaultNow(),
    /** Composite index at the moment of accepting. Null if the brand had no score yet. */
    baselineIndex: real('baseline_index'),
    /** The cluster's damage at accept — volume × negativity × recency. */
    baselineDamage: real('baseline_damage'),
    baselineVolume: integer('baseline_volume'),
    /**
     * The counterfactual ceiling we claimed at accept time.
     *
     * Stored rather than recomputed precisely so it can be checked. Recomputing it later would
     * silently rewrite the prediction to match the outcome, and a log that edits its own
     * predictions proves nothing at all.
     */
    ceilingDelta: real('ceiling_delta'),

    /** Identity-provider subject of whoever accepted it. */
    acceptedBy: varchar('accepted_by', { length: 128 }),
    /** What was actually done. Free text — the one thing the product cannot infer. */
    note: text('note'),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* The list query: this brand's actions, most recent first. */
    byBrand: index('tracked_actions_brand_idx').on(t.tenantId, t.brandEntityId, t.baselineAt),
  }),
);
