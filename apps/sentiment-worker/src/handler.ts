import { db, signals, sentimentResults } from '@project-signal/db';
import { eq } from 'drizzle-orm';
import { scoreSignal } from './scorer.js';

export async function handlePubSubMessage(signalId: string): Promise<void> {
  const [signal] = await db.get().select().from(signals).where(eq(signals.id, signalId));
  if (!signal) {
    console.warn(`Signal not found: ${signalId}`);
    return;
  }

  console.warn(
    `[placeholder] Using source_url as scoring text — raw storage not yet wired. Signal: ${signalId}`,
  );
  const text = signal.sourceUrl;

  try {
    const result = await scoreSignal(text);

    await db.get()
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
  } catch (err) {
    console.error(`Failed to score signal ${signalId}:`, err);
  }
}
