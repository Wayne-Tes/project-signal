import { db, brandEntities, signals, sentimentResults, sourceConfigs } from '@project-signal/db';
import { getPublisher } from '@project-signal/messaging';
import { getObjectStore, rawKey } from '@project-signal/storage';
import { getEnv } from '@project-signal/config';
import {
  GoogleReviewsAdapter,
  AppStoreAdapter,
  PlayStoreAdapter,
  RedditAdapter,
  RssAdapter,
  YoutubeAdapter,
} from '@project-signal/source-adapters';
import type { AdapterConfig } from '@project-signal/source-adapters';
import { eq, isNull, max } from 'drizzle-orm';
import type { SignalSource } from '@project-signal/shared-types';

/** Bounds one sweep so a large backlog cannot exceed the Cloud Run request timeout. */
const RECONCILE_LIMIT = 500;

/** Feed errors are shown in the UI; a full stack trace pasted into a table cell helps nobody. */
const MAX_ERROR_LENGTH = 400;

const ADAPTERS = {
  google_reviews: new GoogleReviewsAdapter(),
  app_store: new AppStoreAdapter(),
  play_store: new PlayStoreAdapter(),
  reddit: new RedditAdapter(),
  rss: new RssAdapter(),
  youtube: new YoutubeAdapter(),
} as const;

/**
 * The sources this process can actually collect.
 *
 * Exported so a test can assert it matches `COLLECTING_SOURCES` in shared-types, which the API
 * validates new source configs against. Drift in either direction fails silently — see the test.
 */
export const ADAPTER_SOURCES = Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[];

function getSystemCredentials(source: string): Record<string, string> {
  const env = getEnv();
  const apifyKey = env.APIFY_API_KEY ?? '';
  if (source === 'google_reviews') return { apifyApiKey: apifyKey };
  if (source === 'app_store') return { apifyApiKey: apifyKey };
  if (source === 'play_store') return { apifyApiKey: apifyKey };
  /* Reddit goes through the same Apify account. No second credential to provision, and nothing
     to configure per brand beyond the search term itself. */
  if (source === 'reddit') return { apifyApiKey: apifyKey };
  if (source === 'youtube') return { youtubeApiKey: env.YOUTUBE_API_KEY ?? '' };
  return {};
}

/**
 * The `since` cutoff for one feed.
 *
 * PER SOURCE CONFIG, not per source type — and that distinction is a defect fix, not a
 * refinement. This used to ask "what is the newest signal for this brand and this SOURCE TYPE?".
 * With one feed per type that was the same question. With several it is not: a busy Google News
 * feed collecting hourly pushes the watermark to now, and a quieter feed on the same brand — a
 * school blog, a second search term — then has everything it publishes filtered out as older than
 * the cutoff, on every run, permanently. It would look exactly like nobody talking about that
 * brand, which is the failure mode this whole system exists to distinguish from silence.
 *
 * Signals collected before `source_config_id` existed have none, so they cannot contribute to any
 * feed's watermark. That is the right answer rather than a limitation: the first run after this
 * change re-examines recent items for each feed, and `onConflictDoNothing` against the
 * `(source_url, brand_entity_id)` unique index drops anything already stored.
 */
async function getLastIngestedAt(sourceConfigId: string): Promise<Date | undefined> {
  const [row] = await db
    .get()
    .select({ latest: max(signals.publishedAt) })
    .from(signals)
    .where(eq(signals.sourceConfigId, sourceConfigId));
  return row?.latest ?? undefined;
}

/**
 * Re-publishes signals that were persisted but never scored.
 *
 * The safety net for a failed dual-write: a signal row commits, then the Pub/Sub publish
 * fails, and nothing ever scores it. Cloud Scheduler calls this hourly (KNOWN-GAPS #2 — the
 * job existed and 404'd because the endpoint did not).
 *
 * Idempotent by construction: it selects only signals with no `sentiment_results` row, so a
 * signal already scored is never re-published, and re-running immediately is a no-op.
 */
export async function reconcilePendingSignals(
  limit = RECONCILE_LIMIT,
): Promise<{ pending: number; published: number }> {
  const pending = await db
    .get()
    .select({ id: signals.id })
    .from(signals)
    .leftJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
    .where(isNull(sentimentResults.signalId))
    .limit(limit);

  const publisher = getPublisher();

  let published = 0;
  for (const { id } of pending) {
    await publisher.publish('item', id);
    published++;
  }

  return { pending: pending.length, published };
}

export async function handleIngestionJob(
  sourceConfigId: string,
): Promise<{ signalsCreated: number; signalsPublished: number }> {
  const [cfg] = await db
    .get()
    .select()
    .from(sourceConfigs)
    .where(eq(sourceConfigs.id, sourceConfigId));
  if (!cfg) throw new Error(`source_config not found: ${sourceConfigId}`);

  const [brand] = await db
    .get()
    .select()
    .from(brandEntities)
    .where(eq(brandEntities.id, cfg.brandEntityId));
  if (!brand) throw new Error(`brand_entity not found: ${cfg.brandEntityId}`);

  const adapter = ADAPTERS[cfg.source as keyof typeof ADAPTERS];
  if (!adapter) throw new Error(`No adapter for source: ${cfg.source}`);

  const since = await getLastIngestedAt(sourceConfigId);

  const adapterConfig: AdapterConfig = {
    brandEntityId: cfg.brandEntityId,
    tenantId: cfg.tenantId,
    source: cfg.source as SignalSource,
    credentials: { ...getSystemCredentials(cfg.source), ...(cfg.config as Record<string, string>) },
  };

  /* The attempt is stamped BEFORE the fetch, and cleared to a failure if the fetch throws.
     Without this the row keeps whatever `lastFetchedAt` it last had — usually none — and reads
     as "never run" however many times it has been tried. Five of this tenant's feeds showed
     "never run" after twelve hourly scans had each attempted and failed them. */
  await db
    .get()
    .update(sourceConfigs)
    .set({ lastAttemptedAt: new Date() })
    .where(eq(sourceConfigs.id, sourceConfigId));

  let items;
  try {
    ({ items } = await adapter.fetch(adapterConfig, since));
  } catch (err) {
    /* Recorded on the row the user has to fix, then rethrown so the scan still counts it as a
       failed source. The scan's own error string aggregates every failure into one line, which
       says something broke but never which feed. */
    const message = err instanceof Error ? err.message : String(err);
    await db
      .get()
      .update(sourceConfigs)
      .set({ lastError: message.slice(0, MAX_ERROR_LENGTH), updatedAt: new Date() })
      .where(eq(sourceConfigs.id, sourceConfigId));
    throw err;
  }

  let signalsCreated = 0;
  const createdIds: string[] = [];
  const store = getObjectStore();

  for (const item of items) {
    const base = adapter.toSignal(item, adapterConfig);

    // Persist the verbatim payload BEFORE the row, so raw_storage_ref can never point at an
    // object that does not exist. The reverse order would leave rows whose evidence is
    // unresolvable if the upload fails. This is the audit trail the product spec promises,
    // and the text the sentiment worker scores.
    const rawStorageRef = await store.put(
      rawKey(cfg.tenantId, cfg.brandEntityId, cfg.source, item.externalId),
      JSON.stringify({
        externalId: item.externalId,
        url: item.url,
        text: item.text,
        publishedAt: item.publishedAt,
        metadata: item.metadata,
        fetchedAt: new Date().toISOString(),
      }),
    );

    const inserted = await db
      .get()
      .insert(signals)
      /* `sourceConfigId` is stamped here and nowhere else. It is what makes six RSS feeds legible
         rather than merely permitted — which feed is productive, which is dead, and which one the
         findings in a report actually came from. It is also what the per-feed watermark above
         reads. */
      .values({ ...base, sourceConfigId, rawStorageRef, publishedAt: item.publishedAt })
      .onConflictDoNothing()
      .returning({ id: signals.id });

    if (inserted[0]) {
      createdIds.push(inserted[0].id);
      signalsCreated++;
    }
  }

  const publisher = getPublisher();
  for (const id of createdIds) {
    await publisher.publish('item', id);
  }

  await db
    .get()
    .update(sourceConfigs)
    /* `lastError: null` matters as much as the timestamp. A feed that recovers must stop showing
       the failure it had three days ago, or the panel accumulates stale alarms nobody trusts. */
    .set({ lastFetchedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(sourceConfigs.id, sourceConfigId));

  return { signalsCreated, signalsPublished: createdIds.length };
}
