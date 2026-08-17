/**
 * Shared query predicates.
 *
 * These live in `libs/db` rather than in whichever app first needed them because a predicate that
 * defines *which rows belong to a brand* has to give the same answer everywhere. When two services
 * each hold their own version, they drift — and the drift is invisible, because both answers look
 * reasonable on their own.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { TERRITORY_ALL } from '@project-signal/shared-types';
import { signals } from './schema/signals.js';
import { signalMentions } from './schema/signalMentions.js';

/**
 * Every signal that counts toward a brand entity, for one tenant.
 *
 * **THIS IS THE DEFINITION OF "THIS BRAND'S SIGNALS". There is deliberately only one.**
 *
 * Two mechanisms attribute a signal to an entity, and both are real feedback about it:
 *
 *   1. `signals.brand_entity_id` — the HARD attribution. The signal arrived through a source
 *      config pointed at this entity: a review on a product's own App Store listing.
 *   2. A `signal_mentions` row — the SOFT attribution. The signal TALKS ABOUT this entity: a
 *      news article about the group that names three products is one signal about four entities,
 *      which a single foreign key cannot express.
 *
 * ## Why this function exists at all
 *
 * It used to live in `apps/ingestion/src/rollup.ts` and be used by the rollup alone. Every read
 * path in the API — `/brand-impact`, `/topics`, `/strengths`, `/stats`, `/signals`,
 * `/sentiment-summary` — filtered on the foreign key only.
 *
 * **So the index and the evidence behind it were computed from different populations.** A product
 * discussed in group-level coverage scored on the dashboard while its drill-down showed fewer
 * contributing signals, or none. That is the same defect class as KNOWN-GAPS #26 — the drill-down
 * contradicting the number it was drilling into — arriving through a different door, and it is why
 * this now has one home that both the rollup and the API import.
 *
 * ## Why the tenant is a required argument
 *
 * This product has no row-level security, so tenant scoping is opt-in and nothing fails when a
 * call site forgets it — which is exactly how `GET /brands/:id` kept an intra-tenant hole until
 * 2026-08-07, and how the content backfill route shipped querying every tenant's signals.
 *
 * Making `tenantId` a parameter rather than something the caller remembers to `and` on means the
 * predicate cannot be used unsafely. The EXISTS subquery filters it too: `brand_entity_id` alone
 * would be sound today because ids are uuids, but soundness that depends on a value being
 * unguessable is not isolation.
 *
 * ## Why EXISTS rather than a join
 *
 * A join would multiply the signal row by its mentions and inflate every count, every weight and
 * every page of a keyset-paginated list. EXISTS makes one-row-per-signal a property of the query
 * rather than something each call site has to remember to deduplicate.
 */
export function attributedTo(brandEntityId: string, tenantId: string): SQL {
  const predicate = and(
    eq(signals.tenantId, tenantId),
    or(
      eq(signals.brandEntityId, brandEntityId),
      sql`EXISTS (
        SELECT 1 FROM ${signalMentions}
        WHERE ${signalMentions.signalId} = ${signals.id}
          AND ${signalMentions.brandEntityId} = ${brandEntityId}
          AND ${signalMentions.tenantId} = ${tenantId}
      )`,
    ),
  );

  /* `and()` is typed as possibly-undefined because it accepts an empty list. Both arguments here
     are always present, so this cannot be undefined — asserted rather than propagated so every
     call site does not have to handle an impossible case. */
  return predicate as SQL;
}

/**
 * Narrows a signal query to one territory, or to everything.
 *
 * Returns `undefined` for "no filter", which `and(...)` drops — so a call site reads
 * `and(attributedTo(id, tenantId), territoryFilter(t), …)` whether or not a territory was asked
 * for, with no branching.
 *
 * `TERRITORY_ALL` means every territory rather than a territory called "all". That value only
 * ever appears on `dimension_scores`, as the aggregate row; no signal carries it, so filtering
 * `signals.territory = 'all'` would silently return nothing — an empty dashboard with no error,
 * which is the worst of the available failures. Treating it as "no filter" here is what stops a
 * caller passing the aggregate's own name straight through from a URL and getting silence.
 */
export function territoryFilter(territory: string | undefined | null): SQL | undefined {
  if (!territory || territory === TERRITORY_ALL) return undefined;
  return eq(signals.territory, territory);
}
