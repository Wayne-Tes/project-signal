import { db, brandEntities, signals, sourceConfigs } from '@project-signal/db';
import { getPubSub, TOPICS } from '@project-signal/messaging';
import { getEnv } from '@project-signal/config';
import {
  GoogleReviewsAdapter,
  AppStoreAdapter,
  PlayStoreAdapter,
  RssAdapter,
  YoutubeAdapter,
} from '@project-signal/source-adapters';
import type { AdapterConfig } from '@project-signal/source-adapters';
import { eq, and, max } from 'drizzle-orm';
import type { SignalSource } from '@project-signal/shared-types';

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

async function getLastIngestedAt(brandEntityId: string, source: SignalSource): Promise<Date | undefined> {
  const [row] = await db.get()
    .select({ latest: max(signals.publishedAt) })
    .from(signals)
    .where(and(eq(signals.brandEntityId, brandEntityId), eq(signals.source, source)));
  return row?.latest ?? undefined;
}

export async function handleIngestionJob(
  sourceConfigId: string,
): Promise<{ signalsCreated: number; signalsPublished: number }> {
  const [cfg] = await db.get()
    .select()
    .from(sourceConfigs)
    .where(eq(sourceConfigs.id, sourceConfigId));
  if (!cfg) throw new Error(`source_config not found: ${sourceConfigId}`);

  const [brand] = await db.get()
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

  for (const item of items) {
    const base = adapter.toSignal(item, adapterConfig);
    const inserted = await db.get()
      .insert(signals)
      .values({ ...base, rawStorageRef: item.url, publishedAt: item.publishedAt })
      .onConflictDoNothing()
      .returning({ id: signals.id });

    if (inserted[0]) {
      createdIds.push(inserted[0].id);
      signalsCreated++;
    }
  }

  const pubsub = getPubSub();
  const topic = pubsub.topic(TOPICS.ITEM_QUEUE);
  for (const id of createdIds) {
    await topic.publishMessage({ data: Buffer.from(id) });
  }

  await db.get()
    .update(sourceConfigs)
    .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(sourceConfigs.id, sourceConfigId));

  return { signalsCreated, signalsPublished: createdIds.length };
}
