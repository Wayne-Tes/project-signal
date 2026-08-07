/** Any value expressible in JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A JSON Schema describing the shape the model must return.
 *
 * Typed as a JSON object rather than `Record<string, unknown>` because the AWS SDK's
 * `inputSchema.json` field requires a genuine JSON value — `unknown` is not assignable to it,
 * and casting the difference away would only move the error to runtime.
 */
export type JsonSchema = { [key: string]: JsonValue };

export interface StructuredRequest {
  /** Concrete model or inference-profile id, e.g. `eu.anthropic.claude-haiku-4-5-…`. */
  model: string;
  prompt: string;
  /** Names the shape being extracted. Surfaces to the model, so make it meaningful. */
  name: string;
  description: string;
  schema: JsonSchema;
}

/**
 * The provider-neutral surface the pipeline needs.
 *
 * Only one method, and it is deliberately the *structured* one. The pipeline never wants free
 * text: every call site needs a value of a known shape, and asking for prose and then parsing
 * it is what made scoring fragile in the first place — see the note in `bedrock.ts`.
 */
export interface LlmClient {
  /** Invokes `model` and returns a value conforming to `schema`. */
  structured<T>(request: StructuredRequest): Promise<T>;
}

/**
 * Thrown when the provider returns something that cannot be read as the requested shape.
 *
 * Distinct from a transport failure: the caller classifies this as permanent, because
 * re-sending the identical prompt produces the identical unusable answer.
 */
export class LlmResponseError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmResponseError';
  }
}
