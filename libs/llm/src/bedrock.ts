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
 */
export class BedrockLlmClient implements LlmClient {
  private readonly client: BedrockRuntimeClient;

  constructor() {
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.client = new BedrockRuntimeClient(endpoint ? { endpoint } : {});
  }

  async structured<T>({ model, prompt, name, description, schema }: StructuredRequest): Promise<T> {
    const res = await this.client.send(
      new ConverseCommand({
        // Newer models reject a bare model id with "on-demand throughput isn't supported" and
        // require an inference profile instead. Callers pass the profile id; this client does
        // not rewrite it, because which profile is correct is a data-residency decision
        // (`eu.` keeps routing inside the EU, `global.` does not) and not one to make silently.
        modelId: model,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        toolConfig: {
          tools: [{ toolSpec: { name, description, inputSchema: { json: schema } } }],
          toolChoice: { tool: { name } },
        },
      }),
    );

    const blocks = res.output?.message?.content ?? [];
    const call = blocks.find((b) => b.toolUse?.name === name);
    if (!call?.toolUse) {
      // Forced tool choice makes this near-impossible, which is exactly why it must not be
      // swallowed: reaching here means an assumption about the provider is wrong.
      throw new LlmResponseError(
        `Model ${model} returned no '${name}' tool call (stopReason: ${res.stopReason ?? 'unknown'})`,
      );
    }
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
              content: [{ json: b.result }],
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
