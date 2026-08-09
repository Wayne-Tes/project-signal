import type { FastifyInstance } from 'fastify';
import { searchHelp } from '@project-signal/help-content';
import type { JsonValue, ToolSpec } from '@project-signal/llm';

/**
 * The tools the assistant may use.
 *
 * ============================================================================================
 * THE SECURITY DESIGN, WHICH IS THE WHOLE POINT OF THIS FILE
 * ============================================================================================
 *
 * Every data tool is executed by re-entering THIS API's own routes through `app.inject()`,
 * carrying the caller's Authorization header. Nothing here queries the database.
 *
 * That is deliberate and it is not a shortcut — it is the opposite. This product has no
 * Postgres row-level security: tenant scoping is applied by hand in every query, and
 * `requireBrandAccess` is an opt-in preHandler that nothing forces a new route to add. A
 * hand-written set of assistant queries would be a second, parallel implementation of that
 * scoping, written once and then quietly diverging from the routes it mirrors — and an
 * assistant is precisely the wrong place to discover a tenant leak, because it can be asked to
 * fetch things in combinations no UI would ever request.
 *
 * Re-entering the real routes means:
 *   - The assistant can see EXACTLY what the user can see through the API. Not approximately.
 *   - `requireBrandAccess` runs, so a brand id belonging to another tenant 403s — even though
 *     the brand id is a value the MODEL chose.
 *   - A future fix to a route's scoping fixes the assistant in the same commit.
 *   - It is READ-ONLY by construction: only GET routes are reachable, and `assertReadOnly`
 *     below refuses anything else regardless of what a tool definition says.
 *
 * The tenant is NEVER a tool argument. It is not in any input schema below, and no tool accepts
 * one. It comes only from the verified token, via the header we forward. A model that decides
 * to "check another tenant" has no way to express that.
 *
 * `inject` is Fastify's in-process request dispatcher: a full request through the real router,
 * plugins and preHandlers, with no socket and no network hop.
 */

/** Result of running one tool. `ok: false` is reported to the model, not thrown. */
export interface ToolRunResult {
  ok: boolean;
  data: JsonValue;
}

/** Everything a tool needs that does not come from the model. */
export interface ToolContext {
  app: FastifyInstance;
  /** The caller's raw Authorization header, forwarded verbatim. Never parsed here. */
  authorization: string;
  /** For a citation's human label only — authorisation always comes from the token. */
  brandName?: string;
}

const BRAND_ID = {
  type: 'string',
  description: 'The brand entity id, as returned by list_brands.',
} as const;

/**
 * Tool definitions.
 *
 * Descriptions are written for the MODEL, and they carry the product's semantics rather than
 * the endpoint's shape. "A damage score of volume × negativity × recency" tells it how to
 * interpret what comes back; "returns clusters" does not, and the difference shows up directly
 * in answer quality.
 */
export const ASSISTANT_TOOLS: ToolSpec[] = [
  {
    name: 'search_help',
    description:
      'Search the product help centre for how Project Signal works — what the Brand Perception Index measures, how scoring, decay, dimensions or Brand impact are calculated, how to configure sources or aliases, roles and permissions. Use this for any "how does this work" or "what does this mean" question BEFORE answering from memory, and cite what you find.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the user wants to understand.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_brands',
    description:
      "List the brands in the user's tenant, including which is theirs and which are tracked competitors. Call this first when a question concerns a brand and you do not yet have its id.",
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_brand_score',
    description:
      'The current Brand Perception Index for one brand: the 0-100 headline number and its recent movement. Returns nothing scored if the brand has no rollup yet, which means "not scored", NOT "scored zero".',
    schema: { type: 'object', properties: { brandId: BRAND_ID }, required: ['brandId'] },
  },
  {
    name: 'get_dimension_scores',
    description:
      'Scores over time for the five perception dimensions (trust, quality, service, value, experience). Use this to answer which part of the brand is moving, and in which direction.',
    schema: {
      type: 'object',
      properties: {
        brandId: BRAND_ID,
        days: {
          type: 'integer',
          description: 'How many days of history. Defaults to 90 — one half-life.',
        },
      },
      required: ['brandId'],
    },
  },
  {
    name: 'get_brand_impact',
    description:
      'The subjects doing the most damage to this brand, ranked by damage = volume × negativity × recency. This is the "what should we fix first" question. Each cluster names the dimensions it touches.',
    schema: { type: 'object', properties: { brandId: BRAND_ID }, required: ['brandId'] },
  },
  {
    name: 'get_strengths',
    description:
      'The mirror of Brand impact: subjects doing the most good, ranked by volume × positivity × recency. Use it for "what is working" and to balance an answer that would otherwise only report problems.',
    schema: { type: 'object', properties: { brandId: BRAND_ID }, required: ['brandId'] },
  },
  {
    name: 'get_sentiment_summary',
    description:
      'The distribution of sentiment labels (positive, negative, neutral, mixed) across this brand’s scored signals.',
    schema: { type: 'object', properties: { brandId: BRAND_ID }, required: ['brandId'] },
  },
  {
    name: 'get_brand_stats',
    description:
      'Volume statistics for a brand: how many signals have been collected and scored, and over what period. Always check this before drawing a conclusion from a score — a score built on twelve signals is a rumour, not a finding.',
    schema: { type: 'object', properties: { brandId: BRAND_ID }, required: ['brandId'] },
  },
  {
    name: 'get_signals',
    description:
      'Individual signals — the actual things people published. Use this to quote evidence for a claim rather than only describing the aggregate. Paginated; ask for a small number.',
    schema: {
      type: 'object',
      properties: {
        brandId: BRAND_ID,
        limit: { type: 'integer', description: 'How many to return. Keep it at or under 20.' },
      },
      required: ['brandId'],
    },
  },
];

/** Maps a tool call to the GET route that answers it. */
function routeFor(name: string, input: Record<string, JsonValue>): string | undefined {
  const id = typeof input['brandId'] === 'string' ? encodeURIComponent(input['brandId']) : '';
  switch (name) {
    case 'list_brands':
      return '/brands';
    case 'get_brand_score':
      return id && `/brands/${id}/score`;
    case 'get_dimension_scores': {
      if (!id) return undefined;
      const days = typeof input['days'] === 'number' ? Math.min(input['days'], 365) : 90;
      return `/brands/${id}/dimension-scores?days=${days}`;
    }
    case 'get_brand_impact':
      return id && `/brands/${id}/brand-impact`;
    case 'get_strengths':
      return id && `/brands/${id}/strengths`;
    case 'get_sentiment_summary':
      return id && `/brands/${id}/sentiment-summary`;
    case 'get_brand_stats':
      return id && `/brands/${id}/stats`;
    case 'get_signals': {
      if (!id) return undefined;
      /* Capped independently of what the model asks for. An unbounded page would blow the
         context window and cost, and the model has no way to know how large a signal is. */
      const limit = typeof input['limit'] === 'number' ? Math.min(Math.max(input['limit'], 1), 20) : 10;
      return `/brands/${id}/signals?limit=${limit}`;
    }
    default:
      return undefined;
  }
}

/**
 * Belt and braces on the read-only guarantee.
 *
 * `routeFor` only ever produces GETs today. This asserts it, so that adding a mutating tool
 * becomes a deliberate act that has to delete this check, rather than something that slips in
 * because a route string was written with a different verb in mind.
 */
function assertReadOnly(method: string): void {
  if (method !== 'GET') {
    throw new Error(
      `The assistant is read-only; refusing to dispatch ${method}. Adding a mutating tool is a ` +
        'product decision, not an implementation detail — see the header of assistant/tools.ts.',
    );
  }
}

/** Runs one tool call. Never throws for an expected failure — the model is told instead. */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawInput: JsonValue,
): Promise<ToolRunResult> {
  const input: Record<string, JsonValue> =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};

  if (name === 'search_help') {
    const query = typeof input['query'] === 'string' ? input['query'] : '';
    const hits = searchHelp(query, 4);
    return {
      ok: true,
      data: {
        /* The body is sent whole. Articles are short by design, and sending a snippet would
           make the model reason about a fragment and then cite the article as though it had
           read it. */
        articles: hits.map((h: { article: { slug: string; title: string; summary: string; body: string } }) => ({
          slug: h.article.slug,
          title: h.article.title,
          summary: h.article.summary,
          body: h.article.body,
        })),
      },
    };
  }

  const url = routeFor(name, input);
  if (!url) return { ok: false, data: { error: `Unknown tool or missing argument: ${name}` } };

  assertReadOnly('GET');

  const res = await ctx.app.inject({
    method: 'GET',
    url,
    /* The caller's own credential. This is what makes the route apply the caller's tenant and
       role — the assistant holds no identity of its own and cannot acquire one. */
    headers: { authorization: ctx.authorization },
  });

  if (res.statusCode === 403 || res.statusCode === 404) {
    /* Reported to the model rather than thrown, so it can say "you do not have access to that
       brand" instead of the request failing. The distinction between the two is deliberately
       not surfaced: telling a user which of "does not exist" and "not yours" applies is how a
       tenant boundary becomes an enumeration oracle. */
    return { ok: false, data: { error: 'That brand is not available to you.' } };
  }
  if (res.statusCode >= 400) {
    return { ok: false, data: { error: `Request failed (${res.statusCode}).` } };
  }

  return { ok: true, data: res.json() as JsonValue };
}
