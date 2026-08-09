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
 * One tool the model may call during a conversation.
 *
 * Identical in shape to the forced-tool spec used by `structured`, because it is the same
 * provider concept used for a different purpose: there, one tool is forced to shape the
 * output; here, several are offered and the model chooses.
 */
export interface ToolSpec {
  name: string;
  description: string;
  schema: JsonSchema;
}

/**
 * A single piece of a turn.
 *
 * Modelled as a discriminated union rather than as loose optional fields so an exhaustive
 * `switch` fails to compile when a block kind is added. The alternative — optional properties
 * on one interface — makes "a tool result with no id" representable, and that is exactly the
 * state that produces an unanswerable provider error at runtime.
 */
export type ContentBlock =
  | { kind: 'text'; text: string }
  /** The model asking for a tool to be run. `id` correlates it with its result. */
  | { kind: 'toolUse'; id: string; name: string; input: JsonValue }
  /** Our answer to a `toolUse`. `id` MUST match, or the provider rejects the turn. */
  | { kind: 'toolResult'; id: string; result: JsonValue; isError?: boolean };

export interface ConverseTurn {
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
}

export interface ConverseRequest {
  /** Concrete model or inference-profile id. */
  model: string;
  /** System prompt. Separate from the messages so it cannot be overwritten by history. */
  system: string;
  messages: ConverseTurn[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** 0 for analytical work. Defaults low, deliberately — see the note in bedrock.ts. */
  temperature?: number;
}

/**
 * Why the model stopped.
 *
 * `toolUse` is the one the caller must handle: the turn is incomplete until the requested
 * tools have run and their results have been sent back.
 */
export type StopReason = 'endTurn' | 'toolUse' | 'maxTokens' | 'other';

export interface ConverseResult {
  blocks: ContentBlock[];
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * The provider-neutral surface.
 *
 * Two methods with genuinely different jobs. `structured` extracts a value of a known shape and
 * is what the scoring pipeline uses — it never wants prose. `converse` runs a multi-turn
 * exchange in which the model chooses tools, and is what the assistant uses. Keeping them
 * separate means the pipeline cannot accidentally acquire a conversation, and the assistant
 * cannot accidentally force a single shape onto an open-ended answer.
 */
export interface LlmClient {
  /** Invokes `model` and returns a value conforming to `schema`. */
  structured<T>(request: StructuredRequest): Promise<T>;
  /** One round of a tool-using conversation. The caller owns the loop. */
  converse(request: ConverseRequest): Promise<ConverseResult>;
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
