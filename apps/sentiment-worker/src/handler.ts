import {
  db,
  signals,
  sentimentResults,
  brandEntities,
  brandAliases,
  signalMentions,
} from '@project-signal/db';
import { getObjectStore, keyFromRef } from '@project-signal/storage';
import { and, eq, ne } from 'drizzle-orm';
import { scoreSignal, resolveMentions, type MentionCandidate } from './scorer.js';

/**
 * Thrown for failures that will never succeed on retry: a missing signal row, an unresolvable
 * storage reference, or output the model returned in a shape we cannot parse.
 *
 * The caller acks these — redelivering them five times and dead-lettering them adds noise
 * without adding information. Everything NOT wrapped in this is treated as transient and
 * rethrown so Pub/Sub retries and eventually dead-letters (KNOWN-GAPS #9).
 */
export class PermanentScoringError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PermanentScoringError';
  }
}

/** Payload written by ingestion; only `text` is needed for scoring. */
interface RawPayload {
  text?: string;
}

export async function handlePubSubMessage(signalId: string): Promise<void> {
  const [signal] = await db.get().select().from(signals).where(eq(signals.id, signalId));
  if (!signal) {
    // Permanent: the row is not coming back. Ack and move on.
    console.warn(`Signal not found, acking: ${signalId}`);
    return;
  }

  let text: string;
  try {
    const raw = await getObjectStore().get(keyFromRef(signal.rawStorageRef));
    const payload = JSON.parse(raw) as RawPayload;
    if (!payload.text) {
      throw new PermanentScoringError(`Raw payload has no text: ${signal.rawStorageRef}`);
    }
    text = payload.text;
  } catch (err) {
    // A malformed reference or unparseable payload will not fix itself; anything else
    // (network, 5xx from the bucket) will, so let it propagate to the transient path below.
    if (err instanceof PermanentScoringError) throw err;
    if (err instanceof SyntaxError || /Unrecognised raw_storage_ref/.test(String(err))) {
      throw new PermanentScoringError(`Cannot read raw payload for ${signalId}`, err);
    }
    throw err;
  }

  /* The tenant's other entities, as mention candidates.

     Loaded per signal rather than cached: a product added in Admin must start being detected on
     the very next signal, not after a redeploy. A tenant has tens of entities, so this is one
     small indexed query alongside a call that is already crossing the network to Bedrock.

     The signal's OWN entity is excluded — a review on Tes Assess's listing is already
     hard-attributed to Tes Assess by `signals.brand_entity_id`, and recording it again as a
     mention would double-count it in any rollup that reads both. */
  const candidates = await loadMentionCandidates(signal.tenantId, signal.brandEntityId);

  let result;
  try {
    result = await scoreSignal(text, candidates);
  } catch (err) {
    // The model returning non-JSON is a permanent failure for this message: retrying sends
    // the identical prompt and gets the identical garbage.
    if (err instanceof SyntaxError) {
      throw new PermanentScoringError(`Model returned unparseable output for ${signalId}`, err);
    }
    // Quota, network, 5xx — rethrow so Pub/Sub retries and eventually dead-letters.
    throw err;
  }

  /* `minItems: 1` in the tool schema is a REQUEST to the model, not a guarantee from it — so the
     empty case still has to be observable. A signal scored into no dimension contributes to no
     index, no cluster and no drill-down, and used to do so in complete silence. It is stored
     anyway rather than being failed or given an invented dimension: a fabricated classification
     would be worse than a visible gap, and `GET /brands/:id/stats` now reports the gap as
     `classifiedSignals` against `scoredSignals`. */
  if (result.dimensions.length === 0) {
    console.warn(
      `Signal ${signalId} scored with no dimensions — it will not contribute to any rollup`,
    );
  }

  await db
    .get()
    .insert(sentimentResults)
    .values({
      signalId,
      label: result.label,
      score: result.score,
      confidence: result.confidence,
      dimensions: result.dimensions,
      topics: result.topics,
      modelVersion: result.modelVersion,
    })
    .onConflictDoUpdate({
      target: sentimentResults.signalId,
      set: {
        label: result.label,
        score: result.score,
        confidence: result.confidence,
        dimensions: result.dimensions,
        topics: result.topics,
        modelVersion: result.modelVersion,
        scoredAt: new Date(),
      },
    });

  /* Mentions are written AFTER the sentiment row, and a failure here must not fail the message:
     the sentiment score is the valuable part and is already committed. Losing one attribution
     costs a product some of its signal; losing the score costs everyone, and a retry would
     re-invoke the model for a result we already have. */
  const mentions = resolveMentions(result.mentions, candidates);
  if (mentions.length > 0) {
    try {
      await db
        .get()
        .insert(signalMentions)
        .values(
          mentions.map((m) => ({
            signalId,
            brandEntityId: m.brandEntityId,
            tenantId: signal.tenantId,
            confidence: m.confidence,
          })),
        )
        /* Re-scoring a signal must not duplicate its mentions. */
        .onConflictDoNothing();
    } catch (err) {
      console.error(`Could not record mentions for ${signalId}`, err);
    }
  }

  console.warn(
    `Scored signal ${signalId}: ${result.label} (${result.score})` +
      (mentions.length ? `, ${mentions.length} mention(s)` : ''),
  );
}

/**
 * Products and sub-brands the scorer may attribute a mention to.
 *
 * Scoped to the signal's OWN tenant. A model must never be shown another customer's product
 * names — that would leak the fact that they are a customer at all, into a prompt, for every
 * signal we score.
 */
export async function loadMentionCandidates(
  tenantId: string,
  excludeEntityId: string,
): Promise<MentionCandidate[]> {
  const entities = await db
    .get()
    .select({ id: brandEntities.id, name: brandEntities.name })
    .from(brandEntities)
    .where(and(eq(brandEntities.tenantId, tenantId), ne(brandEntities.id, excludeEntityId)));

  if (entities.length === 0) return [];

  const aliases = await db
    .get()
    .select({ brandEntityId: brandAliases.brandEntityId, alias: brandAliases.alias })
    .from(brandAliases)
    .where(eq(brandAliases.tenantId, tenantId));

  const byEntity = new Map<string, string[]>();
  for (const a of aliases) {
    const list = byEntity.get(a.brandEntityId) ?? [];
    list.push(a.alias);
    byEntity.set(a.brandEntityId, list);
  }

  return entities.map((e) => ({ id: e.id, name: e.name, aliases: byEntity.get(e.id) ?? [] }));
}
