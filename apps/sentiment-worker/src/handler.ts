import {
  db,
  signals,
  sentimentResults,
  brandEntities,
  brandAliases,
  signalMentions,
} from '@project-signal/db';
import { getObjectStore, keyFromRef } from '@project-signal/storage';
import { LlmResponseError } from '@project-signal/llm';
import type { Voice } from '@project-signal/shared-types';
import { and, eq, ne } from 'drizzle-orm';
import {
  scoreSignal,
  resolveMentions,
  ScoreValidationError,
  type MentionCandidate,
} from './scorer.js';

/** The logging surface this handler needs — satisfied by Fastify's pino logger. */
export interface WorkerLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Thrown for failures that will never succeed on retry: an unresolvable storage reference, a
 * payload with no text, or a model answer that is truncated, missing, or fails validation.
 *
 * The caller acks these — redelivering them five times and dead-lettering them adds noise
 * without adding information. Everything NOT wrapped in this is treated as transient and
 * rethrown so SQS retries and eventually dead-letters (KNOWN-GAPS #9).
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

/**
 * Scores one signal from the item queue.
 *
 * Named for what it handles. It was `handlePubSubMessage`, from the GCP design in which Pub/Sub
 * pushed to an HTTP endpoint; on AWS the SQS consumer pulls, and the push route is gone.
 */
export async function handleItemMessage(signalId: string, log: WorkerLog): Promise<void> {
  const [signal] = await db.get().select().from(signals).where(eq(signals.id, signalId));
  if (!signal) {
    // Permanent: the row is not coming back. Ack and move on.
    log.warn({ signalId }, 'signal not found — acking');
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
    /* The signal's own voice decides which prompt is used. A CRM note scored as a review measures
       the account manager's tone rather than the customer's view. */
    result = await scoreSignal(text, candidates, (signal.voice ?? 'direct') as Voice);
  } catch (err) {
    /* An unusable answer is permanent: retrying sends the identical prompt and gets an answer of
       the identical kind. `LlmResponseError` — no tool call, or one truncated at the output
       ceiling — and `ScoreValidationError` — a label or number that is not one — are those cases.
       (A `SyntaxError` branch used to live here; forced tool use removed JSON parsing, so it
       could no longer fire, while these two real permanent cases went five times round the
       redrive policy to the DLQ.) */
    if (err instanceof LlmResponseError || err instanceof ScoreValidationError) {
      throw new PermanentScoringError(`Unusable model output for ${signalId}: ${err.message}`, err);
    }
    // Quota, network, 5xx — rethrow so SQS retries and eventually dead-letters.
    throw err;
  }

  /* `minItems: 1` in the tool schema is a REQUEST to the model, not a guarantee from it — so the
     empty case still has to be observable. A signal scored into no dimension contributes to no
     index, no cluster and no drill-down, and used to do so in complete silence. It is stored
     anyway rather than being failed or given an invented dimension: a fabricated classification
     would be worse than a visible gap, and `GET /brands/:id/stats` now reports the gap as
     `classifiedSignals` against `scoredSignals`. */
  if (result.dimensions.length === 0) {
    log.warn({ signalId }, 'scored with no dimensions — it will not contribute to any rollup');
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
      log.error({ err, signalId }, 'could not record mentions');
    }
  }

  /* `info`, not `warn`: a successful score is the normal case, and logging it as a warning made
     every healthy signal look like a problem in the log stream. */
  log.info(
    { signalId, label: result.label, score: result.score, mentions: mentions.length },
    'signal scored',
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
