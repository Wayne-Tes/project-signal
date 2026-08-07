import { getLlmClient, getScorerModel } from '@project-signal/llm';
import type { JsonSchema } from '@project-signal/llm';
import type { SentimentLabel, Dimension } from '@project-signal/shared-types';

export interface ScoreResult {
  label: SentimentLabel;
  score: number;
  confidence: number;
  dimensions: Dimension[];
  topics: string[];
  modelVersion: string;
}

export const PROMPT_TEMPLATE = (text: string): string =>
  `Analyse the brand sentiment of the following customer review.\n\nReview: ${text}`;

/**
 * The shape the model must return.
 *
 * This is not a hint — it is passed to Bedrock as a tool input schema with `toolChoice` forcing
 * that tool, so the provider returns a parsed object. There is deliberately no JSON parsing,
 * no ```json fence stripping, and no "return ONLY valid JSON" plea in the prompt: all three
 * existed to salvage prose, and all three could fail. A model that wrapped its answer in a
 * sentence used to raise PermanentScoringError, which acks the message — so the signal was
 * dropped permanently and silently (KNOWN-GAPS #9).
 *
 * The five dimensions are fixed across the codebase; keep this enum in step with
 * `Dimension` in @project-signal/shared-types.
 */
export const SENTIMENT_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
    score: {
      type: 'number',
      description: 'Sentiment from -1 (most negative) to 1 (most positive).',
    },
    confidence: { type: 'number', description: 'Confidence in this assessment, 0 to 1.' },
    dimensions: {
      type: 'array',
      description: 'Which brand dimensions the review touches. Omit any it does not.',
      items: { type: 'string', enum: ['trust', 'quality', 'service', 'value', 'experience'] },
    },
    topics: {
      type: 'array',
      description: 'Up to 5 short topic tags, lowercase.',
      items: { type: 'string' },
    },
  },
  required: ['label', 'score', 'confidence', 'dimensions', 'topics'],
} satisfies JsonSchema;

export async function scoreSignal(text: string): Promise<ScoreResult> {
  const model = getScorerModel();
  const result = await getLlmClient().structured<Omit<ScoreResult, 'modelVersion'>>({
    model,
    prompt: PROMPT_TEMPLATE(text),
    name: 'record_sentiment',
    description: 'Records the brand-sentiment assessment of a single customer review.',
    schema: SENTIMENT_SCHEMA,
  });

  return { ...result, modelVersion: model };
}
