import { getEnv } from '@project-signal/config';
import { BedrockLlmClient } from './bedrock.js';
import type { LlmClient } from './types.js';

export type { JsonSchema, JsonValue, LlmClient, StructuredRequest } from './types.js';
export { LlmResponseError } from './types.js';
export { BedrockLlmClient } from './bedrock.js';

let _client: LlmClient | undefined;

/** Returns the process-wide LLM client, memoised. */
export function getLlmClient(): LlmClient {
  if (!_client) {
    _client = new BedrockLlmClient();
  }
  return _client;
}

/** Test seam: drops the memoised instance. */
export function resetLlmClient(): void {
  _client = undefined;
}

/**
 * Models are named by USE CASE, not by provider, so the underlying model can change without
 * touching a call site. That property survived the move off Vertex intact and is why this port
 * did not reach into the sentiment worker's prompt.
 */
export function getScorerModel(): string {
  return getEnv().SCORER_MODEL;
}

export function getReporterModel(): string {
  return getEnv().REPORTER_MODEL;
}
