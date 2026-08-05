import { getVertexAI, getScorerModel } from '@project-signal/gemini';
import type { SentimentLabel, Dimension } from '@project-signal/shared-types';

export interface ScoreResult {
  label: SentimentLabel;
  score: number;
  confidence: number;
  dimensions: Dimension[];
  topics: string[];
  modelVersion: string;
}

export const PROMPT_TEMPLATE = (text: string): string => `
Analyse the brand sentiment of the following customer review.
Return ONLY valid JSON matching this schema:
{
  "label": "positive"|"negative"|"neutral"|"mixed",
  "score": <float -1 to 1>,
  "confidence": <float 0 to 1>,
  "dimensions": [<array of: "trust"|"quality"|"service"|"value"|"experience">],
  "topics": [<up to 5 short topic strings>]
}

Review: ${text}
`;

function stripCodeFences(raw: string): string {
  return raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
}

function extractText(response: { candidates?: Array<{ content: { parts: Array<{ text?: string }> } }> }): string {
  return response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function scoreSignal(text: string): Promise<ScoreResult> {
  const model = getVertexAI().getGenerativeModel({ model: getScorerModel() });
  const result = await model.generateContent(PROMPT_TEMPLATE(text));
  const raw = extractText(result.response).trim();
  const parsed = JSON.parse(stripCodeFences(raw)) as Omit<ScoreResult, 'modelVersion'>;
  return { ...parsed, modelVersion: getScorerModel() };
}
