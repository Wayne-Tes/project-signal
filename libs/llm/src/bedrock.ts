import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock as SdkContentBlock,
  type Message as SdkMessage,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LlmResponseError,
  type ContentBlock,
  type ConverseRequest,
  type ConverseResult,
  type ConverseTurn,
  type JsonValue,
  type LlmClient,
  type StopReason,
  type StructuredRequest,
} from './types.js';

/**
 * Bedrock-backed LLM client, using the Converse API.
 *
 * **Structured output is obtained through forced tool use, not through prompting.** The model
 * is given exactly one tool whose input schema *is* the shape we want, and `toolChoice` forces
 * it, so the provider returns a parsed object rather than prose we have to salvage.
 *
 * That is a real correctness gain over what this replaces. The Gemini implementation asked for
 * "ONLY valid JSON", stripped ```json fences, and called JSON.parse — and when the model
 * wrapped its answer in a sentence, the signal was classified as a permanent failure and
 * dropped for good (KNOWN-GAPS #9). Removing the parse removes that entire failure class.
 *
 * Region and credentials resolve through the SDK's default chain — the ECS task role in a
 * deployed environment.
 *
 * **`AWS_ENDPOINT_URL` is deliberately NOT honoured here**, unlike the S3 and SQS clients. Locally
 * it points at LocalStack, which does not emulate Bedrock, so following it would turn every
 * scoring call into a connection error against an endpoint that cannot answer. Instead a developer
 * puts a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK` (see libs/config) and this client — alone —
 * presents it, with the real regional endpoint named explicitly so LocalStack is never asked.
 *
 * **Why an API key and not an SSO profile.** An SSO login caches a token on the developer's machine
 * that reaches every account and role the developer can — for an organisation administrator, that
 * is production. Anything running as that user, a coding agent included, can read the cache. A
 * Bedrock API key can do nothing but call Bedrock, and its IAM user is held to invoke-and-list by
 * an inline policy (docs/HANDOVER.md), so the worst a leaked key can do is run model calls in the
 * sandbox until it expires. The profile route was removed for that reason, not deprecated.
 */
export interface BedrockClientOptions {
  /** Bedrock API key. Local development only; unset in a deployed environment (task role). */
  apiKey?: string;
  /** Bedrock region. Unset means the SDK's own resolution (AWS_REGION). Required with `apiKey`. */
  region?: string;
}

/**
 * Some models refuse a forced tool choice outright — Claude Sonnet 5.5 and Opus 5.5 on Bedrock
 * answer `tool_choice: type "tool" and "any" are not supported for this model` (invoked
 * 2026-11-17). Matched on the provider's message because the error class alone,
 * ValidationException, also covers genuinely malformed requests that must not be retried.
 */
const FORCED_TOOL_UNSUPPORTED = /tool_choice[^]*not supported/i;

function isForcedToolUnsupported(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === 'ValidationException' &&
    FORCED_TOOL_UNSUPPORTED.test(err.message)
  );
}

export class BedrockLlmClient implements LlmClient {
  private readonly client: BedrockRuntimeClient;
  /** Models seen to refuse a forced tool choice, so each pays for the refusal once per process. */
  private readonly offerToolOnly = new Set<string>();

  constructor(options: BedrockClientOptions = {}) {
    if (options.apiKey && !options.region) {
      throw new Error('A Bedrock API key needs an explicit region (BEDROCK_REGION)');
    }
    this.client = new BedrockRuntimeClient({
      ...(options.region ? { region: options.region } : {}),
      ...(options.apiKey
        ? {
            token: { token: options.apiKey },
            authSchemePreference: ['httpBearerAuth'],
            /* Named, so AWS_ENDPOINT_URL (LocalStack, locally) can never redirect the key. */
            endpoint: `https://bedrock-runtime.${options.region}.amazonaws.com`,
          }
        : {}),
    });
  }

  async structured<T = unknown>({
    model,
    system,
    prompt,
    name,
    description,
    schema,
    maxTokens = 1024,
  }: StructuredRequest): Promise<T> {
    const send = (forced: boolean) => {
      /* Without a forced choice the instruction carries the obligation instead; the missing-call
         check below still refuses an answer that ignores it, so nothing unstructured gets through. */
      const instruction = forced ? undefined : `Respond only by calling the ${name} tool.`;
      const systemText = [system, instruction].filter(Boolean).join('\n\n');
      return this.client.send(
        new ConverseCommand({
          // Newer models reject a bare model id with "on-demand throughput isn't supported" and
          // require an inference profile instead. Callers pass the profile id; this client does
          // not rewrite it, because which profile is correct is a data-residency decision
          // (`eu.` keeps routing inside the EU, `global.` does not) and not one to make silently.
          modelId: model,
          ...(systemText ? { system: [{ text: systemText }] } : {}),
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          toolConfig: {
            tools: [{ toolSpec: { name, description, inputSchema: { json: schema } } }],
            toolChoice: forced ? { tool: { name } } : { auto: {} },
          },
          /* A ceiling, so a runaway answer costs a bounded amount. Hitting it is checked below. */
          inferenceConfig: { maxTokens },
        }),
      );
    };

    let res;
    if (this.offerToolOnly.has(model)) {
      res = await send(false);
    } else {
      try {
        res = await send(true);
      } catch (err) {
        if (!isForcedToolUnsupported(err)) throw err;
        this.offerToolOnly.add(model);
        res = await send(false);
      }
    }

    /* A tool call cut off at the output ceiling can still parse — as a PARTIAL object with
       fields missing. That is worse than no answer, so it is refused here rather than handed to
       a caller that might trust whatever fields did arrive. */
    if (res.stopReason === 'max_tokens') {
      throw new LlmResponseError(
        `Model ${model} hit the ${maxTokens}-token output ceiling before finishing '${name}'`,
      );
    }

    const blocks = res.output?.message?.content ?? [];
    const call = blocks.find((b) => b.toolUse?.name === name);
    if (!call?.toolUse) {
      // Forced tool choice makes this near-impossible, which is exactly why it must not be
      // swallowed: reaching here means an assumption about the provider is wrong.
      throw new LlmResponseError(
        `Model ${model} returned no '${name}' tool call (stopReason: ${res.stopReason ?? 'unknown'})`,
      );
    }
    /* Unchecked by design — see `LlmClient.structured`. The caller validates. */
    return call.toolUse.input as T;
  }

  /**
   * One round of a tool-using conversation.
   *
   * This method deliberately does NOT loop. Running the tools is the caller's job, because
   * only the caller knows what a tool is allowed to touch — in this product that means the
   * tenant of the verified token, which must never be something the model can influence. A
   * loop inside the provider adapter would put the client library in charge of authorisation,
   * which is precisely the wrong place for it.
   */
  async converse({
    model,
    system,
    messages,
    tools,
    maxTokens = 4096,
    temperature,
  }: ConverseRequest): Promise<ConverseResult> {
    const res = await this.client.send(
      new ConverseCommand({
        modelId: model,
        system: [{ text: system }],
        messages: messages.map(toSdkMessage),
        ...(tools?.length
          ? {
              toolConfig: {
                tools: tools.map((t) => ({
                  toolSpec: {
                    name: t.name,
                    description: t.description,
                    inputSchema: { json: t.schema },
                  },
                })),
                /* `auto`, not `any`: the model must be free to answer a question that needs no
                   data ("what does the index measure?") without inventing a tool call to
                   satisfy a forced choice. */
                toolChoice: { auto: {} },
              },
            }
          : {}),
        /* `temperature` is OMITTED unless a caller asks for one.

           Sending it is not free: Claude Sonnet 5 rejects the request outright with
           "ValidationException: The model returned the following errors: `temperature` is
           deprecated for this model." A previous version defaulted it to 0 — a sensible-looking
           choice for analytical work — and every assistant request 500'd against the only model
           this account can currently invoke.

           Spreading conditionally rather than passing `undefined`: the SDK serialises a present
           key with an undefined value, so the field still reaches the provider. */
        inferenceConfig: { maxTokens, ...(temperature === undefined ? {} : { temperature }) },
      }),
    );

    const blocks = (res.output?.message?.content ?? []).flatMap(fromSdkBlock);

    return {
      blocks,
      stopReason: STOP_REASONS[res.stopReason ?? ''] ?? 'other',
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      },
    };
  }
}

/** Provider stop reasons we act on. Anything else collapses to `other`. */
const STOP_REASONS: Record<string, StopReason> = {
  end_turn: 'endTurn',
  tool_use: 'toolUse',
  max_tokens: 'maxTokens',
  stop_sequence: 'endTurn',
};

/**
 * Coerces a tool result into the JSON OBJECT the provider demands.
 *
 * An array is wrapped under `items` and a primitive under `value`, both named so the model can
 * read the shape without guessing. Returning the value untouched when it is already an object
 * keeps the common case free of a pointless nesting level.
 */
function asJsonObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return { items: value };
  if (value !== null && typeof value === 'object') return value;
  return { value };
}

function toSdkMessage(turn: ConverseTurn): SdkMessage {
  return {
    role: turn.role,
    content: turn.blocks.map((b): SdkContentBlock => {
      switch (b.kind) {
        case 'text':
          return { text: b.text };
        case 'toolUse':
          return { toolUse: { toolUseId: b.id, name: b.name, input: b.input } };
        case 'toolResult':
          return {
            toolResult: {
              toolUseId: b.id,
              /* Bedrock requires an OBJECT here. A bare array or primitive is rejected with
                 "The format of the value at …toolResult.content.0.json is invalid", which fails
                 the whole conversation rather than the one tool.

                 Several of this product's routes legitimately return a bare array —
                 `/brands/:id/brand-impact` among them — so this is the common case, not an edge
                 case. Wrapping here rather than at each call site keeps the provider's constraint
                 in the provider adapter, which is the only place that knows about it. */
              content: [{ json: asJsonObject(b.result) }],
              /* Surfacing failure as `error` rather than as a JSON blob that happens to
                 contain the word "error" lets the model retry or explain, instead of
                 reporting our failure text back to the user as though it were data. */
              status: b.isError ? 'error' : 'success',
            },
          };
      }
    }),
  };
}

function fromSdkBlock(block: SdkContentBlock): ContentBlock[] {
  if (typeof block.text === 'string') return [{ kind: 'text', text: block.text }];
  if (block.toolUse?.toolUseId && block.toolUse.name) {
    return [
      {
        kind: 'toolUse',
        id: block.toolUse.toolUseId,
        name: block.toolUse.name,
        input: (block.toolUse.input ?? {}) as JsonValue,
      },
    ];
  }
  /* Reasoning blocks and any future block type are dropped rather than guessed at. Returning
     an array makes that a normal case instead of a null the caller has to filter. */
  return [];
}
