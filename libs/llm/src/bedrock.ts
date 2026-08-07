import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { LlmResponseError, type LlmClient, type StructuredRequest } from './types.js';

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
}
