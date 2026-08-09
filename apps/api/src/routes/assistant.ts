import type { FastifyPluginAsync } from 'fastify';
import { ask, type ChatMessage } from '../assistant/agent.js';

/**
 * The assistant endpoint.
 *
 * One route, one verb. It is a POST because a conversation is a body, not a URL — but it
 * MUTATES NOTHING: no conversation is stored, and every tool it can reach is a GET back through
 * this same API carrying the caller's own token. See the header of `assistant/tools.ts` for why
 * that indirection is the security design rather than an implementation detail.
 *
 * Conversations are stateless. The client sends the history it wants considered, which keeps the
 * server from holding user content it has no requirement to hold, and means there is no
 * conversation store to isolate per tenant — the cheapest way to not leak one is not to have
 * one. Persisted history is a product decision with a retention question attached, and it is not
 * this change's to make.
 */

/** Ceilings on what one request may carry. */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

const CITATION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    detail: { type: 'string' },
    href: { type: 'string' },
  },
};

interface AssistantBody {
  messages: ChatMessage[];
  view?: string;
  brandId?: string;
}

export const assistantRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: AssistantBody }>(
    '/assistant/messages',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'Ask the in-product assistant a question. Read-only: it can only retrieve data the caller is already permitted to see, through this API’s own authenticated routes.',
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_MESSAGES,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_CHARS },
                },
              },
            },
            view: { type: 'string', maxLength: 64 },
            brandId: { type: 'string', maxLength: 64 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              answer: { type: 'string' },
              citations: { type: 'array', items: CITATION_SCHEMA },
              steps: { type: 'array', items: { type: 'string' } },
              truncated: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { messages, view, brandId } = request.body;

      /* The last turn must be the user's. A history ending on an assistant turn asks the model
         to continue its own message, which produces a fragment rather than an answer. */
      if (messages[messages.length - 1]?.role !== 'user') {
        return reply.badRequest('The final message must be from the user.');
      }

      /* Forwarded verbatim to every tool call, so each one re-enters the API as this caller.
         Guaranteed present: the auth plugin rejects the request before this handler runs. */
      const authorization = request.headers.authorization;
      if (!authorization) return reply.unauthorized('Missing Authorization header.');

      try {
        const result = await ask({ app: fastify, authorization }, { messages, view, brandId });
        return reply.send({
          answer: result.answer,
          citations: result.citations,
          steps: result.steps,
          truncated: result.truncated,
        });
      } catch (err) {
        /* Bedrock model access in this account is gated per model and has changed underneath a
           running deployment before (see libs/config). Distinguishing that from a genuine bug
           matters: one is a configuration problem the owner can act on, the other is ours. */
        const message = err instanceof Error ? err.message : String(err);
        const isModelAccess =
          message.includes('use case details') ||
          message.includes('ResourceNotFoundException') ||
          message.includes('AccessDeniedException');

        request.log.error({ err }, 'assistant request failed');

        if (isModelAccess) {
          return reply.serviceUnavailable(
            'The assistant is unavailable: this AWS account does not currently have access to the configured model.',
          );
        }
        return reply.internalServerError('The assistant could not answer that.');
      }
    },
  );
};

export default assistantRoutes;
