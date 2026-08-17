import { getLlmClient, getScorerModel } from '@project-signal/llm';
import type { JsonSchema } from '@project-signal/llm';
import type { SentimentLabel, Dimension } from '@project-signal/shared-types';

/** A product or sub-brand the model may attribute a mention to. */
export interface MentionCandidate {
  id: string;
  name: string;
  /** Alternative names, abbreviations and former names. May be empty. */
  aliases: string[];
}

/** One entity the model judged the text to be talking about. */
export interface DetectedMention {
  name: string;
  confidence: number;
}

export interface ScoreResult {
  label: SentimentLabel;
  score: number;
  confidence: number;
  dimensions: Dimension[];
  topics: string[];
  /** Names the model matched. Resolved back to entity ids by the caller. */
  mentions: DetectedMention[];
  modelVersion: string;
}

/**
 * The prompt.
 *
 * Candidates are listed by NAME with their aliases, and the model is asked to return names it
 * recognises rather than ids. Asking a model to echo a uuid invites it to invent a
 * plausible-looking one, and a fabricated uuid either fails a foreign key or — worse — matches
 * some unrelated row. Names are resolved back to ids by code that can simply refuse an unknown
 * one.
 */
export const PROMPT_TEMPLATE = (text: string, candidates: MentionCandidate[] = []): string => {
  const base = `Analyse the brand sentiment of the following customer review.\n\nReview: ${text}`;
  if (candidates.length === 0) return base;

  const list = candidates
    .map((c) => (c.aliases.length ? `- ${c.name} (also: ${c.aliases.join(', ')})` : `- ${c.name}`))
    .join('\n');

  return `${base}

The following products and sub-brands are tracked. If the review names or clearly refers to any
of them, list them under "mentions", using the exact name as written below. Only list one if the
text genuinely refers to it — do not guess from the general subject matter, and do not invent
names that are not on this list.

${list}`;
};

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
    /**
     * AT LEAST ONE DIMENSION IS REQUIRED, and that is a defect fix rather than a preference.
     *
     * `scoreAllDimensions` omits dimensions no item touches, and the rollup skips a brand when
     * that leaves nothing. So a signal returned with `dimensions: []` was collected, stored,
     * queued, scored — and then contributed to no index, no dimension, no cluster and no
     * drill-down, with no error anywhere. At small volumes it takes a whole brand out of the
     * rollup; the register shows two that sat at zero rows.
     *
     * The previous wording ("Omit any it does not") actively invited the empty array on the
     * short, factual text that most of a Google News feed consists of.
     */
    dimensions: {
      type: 'array',
      minItems: 1,
      description:
        'Which brand dimensions the text touches. At least one is required: if the text relates only weakly to the brand, choose the single closest dimension rather than returning an empty list.',
      items: { type: 'string', enum: ['trust', 'quality', 'service', 'value', 'experience'] },
    },
    topics: {
      type: 'array',
      description: 'Up to 5 short topic tags, lowercase.',
      items: { type: 'string' },
    },
    mentions: {
      type: 'array',
      description:
        'Products or sub-brands from the supplied list that this text actually refers to. Empty if none. Never include a name that is not on the list.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exactly as written in the supplied list.' },
          confidence: { type: 'number', description: 'How sure you are, 0 to 1.' },
        },
        required: ['name', 'confidence'],
      },
    },
  },
  /* `mentions` is NOT required. Making it so would force the model to emit the key on every
     signal for tenants that track no products at all, which is noise on the overwhelming
     majority of calls. Absent is normalised to [] below. */
  required: ['label', 'score', 'confidence', 'dimensions', 'topics'],
} satisfies JsonSchema;

export async function scoreSignal(
  text: string,
  candidates: MentionCandidate[] = [],
): Promise<ScoreResult> {
  const model = getScorerModel();
  const result = await getLlmClient().structured<Omit<ScoreResult, 'modelVersion'>>({
    model,
    prompt: PROMPT_TEMPLATE(text, candidates),
    name: 'record_sentiment',
    description: 'Records the brand-sentiment assessment of a single customer review.',
    schema: SENTIMENT_SCHEMA,
  });

  return { ...result, mentions: result.mentions ?? [], modelVersion: model };
}

/**
 * Resolves detected names back to entity ids.
 *
 * Matching normalises case and collapses whitespace, across both names and aliases, because a model
 * asked for "exactly as written" will still return "TES Assess" for "Tes Assess". A name that
 * matches nothing is DROPPED, silently by design: the model was told not to invent names, and
 * the correct response to it doing so anyway is to ignore it rather than to fail the whole
 * signal — one hallucinated product must not cost us a real sentiment score.
 */
export function resolveMentions(
  detected: DetectedMention[],
  candidates: MentionCandidate[],
): { brandEntityId: string; confidence: number }[] {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const byName = new Map<string, string>();
  for (const c of candidates) {
    byName.set(norm(c.name), c.id);
    for (const a of c.aliases) byName.set(norm(a), c.id);
  }

  const seen = new Set<string>();
  const out: { brandEntityId: string; confidence: number }[] = [];
  for (const m of detected) {
    const id = byName.get(norm(m.name ?? ''));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      brandEntityId: id,
      /* Clamped: a model returning 1.4 or -0.2 should not put an out-of-range value in a column
         a future rollup may weight by. */
      confidence: Math.max(0, Math.min(1, typeof m.confidence === 'number' ? m.confidence : 0)),
    });
  }
  return out;
}
