import { db, brandEntities, signals, sentimentResults, sourceConfigs } from '@project-signal/db';
import { getPublisher } from '@project-signal/messaging';
import { getObjectStore, rawKey } from '@project-signal/storage';
import { getEnv } from '@project-signal/config';
import {
  GoogleReviewsAdapter,
  AppStoreAdapter,
  PlayStoreAdapter,
  RssAdapter,
  YoutubeAdapter,
} from '@project-signal/source-adapters';
import type { AdapterConfig } from '@project-signal/source-adapters';
import { eq, and, isNull, max } from 'drizzle-orm';
import type { SignalSource } from '@project-signal/shared-types';

/** Bounds one sweep so a large backlog cannot exceed the Cloud Run request timeout. */
const RECONCILE_LIMIT = 500;

const ADAPTERS = {
  google_reviews: new GoogleReviewsAdapter(),
  app_store: new AppStoreAdapter(),
  play_store: new PlayStoreAdapter(),
  rss: new RssAdapter(),
  youtube: new YoutubeAdapter(),
} as const;

function getSystemCredentials(source: string): Record<string, string> {
  const env = getEnv();
  const apifyKey = env.APIFY_API_KEY ?? '';
  if (source === 'google_reviews') return { apifyApiKey: apifyKey };
  if (source === 'app_store') return { apifyApiKey: apifyKey };
  if (source === 'play_store') return { apifyApiKey: apifyKey };
  if (source === 'youtube') return { youtubeApiKey: env.YOUTUBE_API_KEY ?? '' };
  return {};
}

async function getLastIngestedAt(
  brandEntityId: string,
  source: SignalSource,
): Promise<Date | undefined> {
  const [row] = await db
    .get()
    .select({ latest: max(signals.publishedAt) })
    .from(signals)
    .where(and(eq(signals.brandEntityId, brandEntityId), eq(signals.source, source)));
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

  const since = await getLastIngestedAt(cfg.brandEntityId, cfg.source as SignalSource);

  const adapterConfig: AdapterConfig = {
    brandEntityId: cfg.brandEntityId,
    tenantId: cfg.tenantId,
    source: cfg.source as SignalSource,
    credentials: { ...getSystemCredentials(cfg.source), ...(cfg.config as Record<string, string>) },
  };

  const { items } = await adapter.fetch(adapterConfig, since);

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
      .values({ ...base, rawStorageRef, publishedAt: item.publishedAt })
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
    .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(sourceConfigs.id, sourceConfigId));

  return { signalsCreated, signalsPublished: createdIds.length };
}
