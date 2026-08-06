import { db, signals, sentimentResults } from '@project-signal/db';
import { getObjectStore, keyFromRef } from '@project-signal/storage';
import { eq } from 'drizzle-orm';
import { scoreSignal } from './scorer.js';

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

  let result;
  try {
    result = await scoreSignal(text);
  } catch (err) {
    // The model returning non-JSON is a permanent failure for this message: retrying sends
    // the identical prompt and gets the identical garbage.
    if (err instanceof SyntaxError) {
      throw new PermanentScoringError(`Model returned unparseable output for ${signalId}`, err);
    }
    // Quota, network, 5xx — rethrow so Pub/Sub retries and eventually dead-letters.
    throw err;
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

  console.warn(`Scored signal ${signalId}: ${result.label} (${result.score})`);
}
