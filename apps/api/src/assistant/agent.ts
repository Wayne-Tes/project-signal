import { getAssistantModel, getLlmClient } from '@project-signal/llm';
import type { ContentBlock, ConverseTurn, JsonValue } from '@project-signal/llm';
import { ASSISTANT_TOOLS, runTool, type ToolContext } from './tools.js';
import { buildCitations, type Citation } from './citations.js';

/**
 * The assistant's agent loop.
 *
 * The loop lives here rather than in `libs/llm` on purpose: running a tool is an authorisation
 * decision in this product, and the provider adapter must not be the thing making it. `libs/llm`
 * knows how to talk to Bedrock; this knows what the assistant is allowed to do.
 */

/** A turn as the client sends it. Deliberately not the provider's shape. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  messages: ChatMessage[];
  /** The view the user is looking at, so "explain this" has a referent. */
  view?: string;
  /** The brand currently selected in the UI. A hint only — never an authorisation input. */
  brandId?: string;
}

export interface AssistantAnswer {
  answer: string;
  citations: Citation[];
  /** Tool names in call order. Surfaced in the UI so the user can see what it looked at. */
  steps: string[];
  usage: { inputTokens: number; outputTokens: number };
  /** True when the loop hit its ceiling — the answer may be partial, and says so. */
  truncated: boolean;
}

/**
 * How many model round-trips one question may take.
 *
 * Six is enough for the deepest genuine chain the tools support — list brands, read the score,
 * read the dimensions, read Brand impact, pull signals, answer — with one spare. It exists to
 * bound cost and latency on a question that sends the model in circles, not to shape good
 * answers. When it trips, the user is told the answer is partial rather than being handed a
 * confident-looking summary built on half the evidence.
 */
const MAX_TURNS = 6;

/** Tool calls per turn. A model that asks for twenty things at once has misunderstood. */
const MAX_TOOL_CALLS_PER_TURN = 5;

const SYSTEM_PROMPT = `
You are the Project Signal assistant. Project Signal is a brand-intelligence product: it collects
public signals about a brand, scores each with a language model, and rolls them up into a Brand
Perception Index (0-100) across five dimensions — trust, quality, service, value, experience.

YOUR SOURCES
You have tools that read the signed-in user's own data, and a tool that searches the product help
centre. Use them. Do not answer a question about how the product works from memory when
search_help can tell you — the help centre is the authority, and your recollection is not.

CITING
Every factual claim about the user's data or about how the product works must rest on a tool
result. Do not invent numbers, brand names, dates or quotations, ever, under any circumstances.
If the tools do not support a claim, say what you do not know. A user can check you, and being
caught inventing a figure destroys the value of every correct answer you have given.

WHEN THERE IS NO DATA
A brand with no rollup is UNSCORED. That is not a score of zero — zero would mean uniformly
negative sentiment. Say "not scored yet" and explain what has to happen first. Never present an
absent score as a low one.

ALWAYS CHECK VOLUME
Before drawing a conclusion from a score, check how many signals it rests on. A score built on
twelve signals is a rumour; the same score from twelve hundred is a finding. Say which you are
looking at.

WHAT YOU CANNOT DO
You are strictly read-only. You cannot add a source, edit an alias, change a role, or alter
anything. If asked, say so plainly and explain where in the product the user can do it
themselves. You can only ever see the signed-in user's own tenant.

STYLE
British English. Direct and specific. Lead with the answer, then the evidence. Prefer a real
number over an adjective. Keep it short — a few sentences for a simple question. Use a short
markdown table only when comparing several things. Never open with "Great question".
`.trim();

/** Blocks the model returned that are tool calls, capped. */
function toolCalls(blocks: ContentBlock[]): Extract<ContentBlock, { kind: 'toolUse' }>[] {
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: 'toolUse' }> => b.kind === 'toolUse')
    .slice(0, MAX_TOOL_CALLS_PER_TURN);
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export async function ask(ctx: ToolContext, request: AssistantRequest): Promise<AssistantAnswer> {
  const llm = getLlmClient();
  const model = getAssistantModel();

  /* Context about where the user is, appended to the system prompt rather than injected as a
     user turn. As a user turn the model can read it as an instruction from the person; as
     system context it is plainly ours, and a signal title that says "ignore your instructions"
     has no path to becoming one. */
  const situated = [
    SYSTEM_PROMPT,
    request.view ? `\nThe user is currently on the "${request.view}" view.` : '',
    request.brandId
      ? `\nThe brand selected in the interface is ${request.brandId}. Treat this as a hint about what they mean, not as permission — every tool call is authorised against their own token regardless.`
      : '',
  ].join('');

  const messages: ConverseTurn[] = request.messages.map((m) => ({
    role: m.role,
    blocks: [{ kind: 'text', text: m.content }],
  }));

  const steps: string[] = [];
  const toolResults: { name: string; input: JsonValue; data: JsonValue }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const result = await llm.converse({
      model,
      system: situated,
      messages,
      tools: ASSISTANT_TOOLS,
    });

    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;

    const calls = toolCalls(result.blocks);
    if (calls.length === 0) {
      return {
        answer: textOf(result.blocks),
        citations: buildCitations(toolResults),
        steps,
        usage: { inputTokens, outputTokens },
        truncated: false,
      };
    }

    /* The assistant turn must be recorded EXACTLY as the model produced it, tool calls
       included. Sending back a turn missing its toolUse blocks, or results whose ids do not
       match, is rejected by the provider — the correlation is not advisory. */
    messages.push({ role: 'assistant', blocks: result.blocks });

    const resultBlocks: ContentBlock[] = [];
    for (const call of calls) {
      steps.push(call.name);
      const run = await runTool(ctx, call.name, call.input);
      if (run.ok) toolResults.push({ name: call.name, input: call.input, data: run.data });
      resultBlocks.push({
        kind: 'toolResult',
        id: call.id,
        result: run.data,
        isError: !run.ok,
      });
    }
    messages.push({ role: 'user', blocks: resultBlocks });
  }

  /* Out of turns with tools still outstanding. Rather than return the model's last partial
     text as though it were an answer, ask it once more with no tools available, so it composes
     an answer from what it already has — and flag it as partial. */
  const final = await llm.converse({
    model,
    system: `${situated}\n\nYou have run out of research steps. Answer from what you already have, and say plainly which part of the question you could not get to.`,
    messages,
  });
  inputTokens += final.usage.inputTokens;
  outputTokens += final.usage.outputTokens;

  return {
    answer: textOf(final.blocks),
    citations: buildCitations(toolResults),
    steps,
    usage: { inputTokens, outputTokens },
    truncated: true,
  };
}
