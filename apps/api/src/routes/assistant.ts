import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { conversationMessages, conversations, db } from '@project-signal/db';
import { ask, type ChatMessage } from '../assistant/agent.js';

/**
 * The assistant endpoint, and the conversation history behind it.
 *
 * HISTORY IS SERVER-AUTHORITATIVE. When a request names a conversation, the prior turns are
 * loaded from the database — the client's copy is not trusted and not read. That is not
 * pedantry: the alternative lets a caller post a fabricated assistant turn ("you previously
 * confirmed the index is 94") and have the model treat its own supposed words as established
 * fact. The client sends one thing, the new question.
 *
 * ISOLATION IS BY TENANT **AND** BY USER. Every query below filters both. A conversation quotes
 * the person's own signals, scores and questions, and colleagues in the same tenant have no
 * business reading it — this is the one table in the product where tenant scoping alone would
 * be the wrong answer.
 *
 * The assistant itself remains strictly read-only over BRAND data. Writing a conversation row is
 * not a counter-example: it records what the user asked and what they were told. No tool can
 * reach it, and no model output decides what is written. See `assistant/tools.ts`.
 */

/** Ceilings on what one request may carry. */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
/** How many prior turns are replayed to the model. Older ones stay readable in the UI. */
const HISTORY_TURNS = 12;
const MAX_TITLE = 80;

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

/**
 * A conversation title, derived from the opening question.
 *
 * Asked-for titles are a surface people abandon; a chat that demands a name before it will
 * answer anything gets used once. Cut on a word boundary so the list does not fill with
 * truncated half-words.
 */
function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_TITLE) return clean || 'New conversation';
  const cut = clean.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

interface AssistantBody {
  messages: ChatMessage[];
  view?: string;
  brandId?: string;
  /** Continue an existing conversation. Omit to start a new one. */
  conversationId?: string;
}

export const assistantRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Conversation history ────────────────────────────────────────────────────

  fastify.get(
    '/assistant/conversations',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description: "List the signed-in user's own assistant conversations, most recent first.",
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                updatedAt: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const rows = await db
        .get()
        .select({
          id: conversations.id,
          title: conversations.title,
          updatedAt: conversations.updatedAt,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, request.user.tenantId),
            eq(conversations.userId, request.user.uid),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(200);

      return reply.send(rows);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/assistant/conversations/:id',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description: 'One conversation and its turns.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const conversation = await loadOwnConversation(request.user, request.params.id);
      /* 404 whether it does not exist or belongs to someone else. Distinguishing the two turns
         the ownership boundary into an oracle for enumerating other people's conversations. */
      if (!conversation) return reply.notFound('Conversation not found');

      const messages = await db
        .get()
        .select({
          id: conversationMessages.id,
          role: conversationMessages.role,
          content: conversationMessages.content,
          citations: conversationMessages.citations,
          steps: conversationMessages.steps,
          createdAt: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.tenantId, request.user.tenantId),
          ),
        )
        .orderBy(asc(conversationMessages.createdAt));

      return reply.send({ ...conversation, messages });
    },
  );

  fastify.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/assistant/conversations/:id',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description: 'Rename a conversation.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const conversation = await loadOwnConversation(request.user, request.params.id);
      if (!conversation) return reply.notFound('Conversation not found');

      await db
        .get()
        .update(conversations)
        .set({ title: request.body.title.trim(), updatedAt: new Date() })
        .where(
          and(
            eq(conversations.id, conversation.id),
            eq(conversations.tenantId, request.user.tenantId),
            eq(conversations.userId, request.user.uid),
          ),
        );

      return reply.send({ ...conversation, title: request.body.title.trim() });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/assistant/conversations/:id',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description: 'Delete a conversation and its turns.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const conversation = await loadOwnConversation(request.user, request.params.id);
      if (!conversation) return reply.notFound('Conversation not found');

      /* Messages go with it via ON DELETE CASCADE. The tenant and user filters are repeated
         here rather than relying on the lookup above — the delete must be safe on its own
         terms, because that is the statement that would do the damage. */
      await db
        .get()
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, conversation.id),
            eq(conversations.tenantId, request.user.tenantId),
            eq(conversations.userId, request.user.uid),
          ),
        );

      return reply.code(204).send();
    },
  );

  // ── Asking ──────────────────────────────────────────────────────────────────

  fastify.post<{ Body: AssistantBody }>(
    '/assistant/messages',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'Ask the assistant a question. Read-only over brand data: it retrieves only what the caller may already see, through this API’s own authenticated routes. Pass conversationId to continue a saved conversation.',
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
            conversationId: { type: 'string', maxLength: 64 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              conversationId: { type: 'string' },
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
      const { messages, view, brandId, conversationId } = request.body;

      const question = messages[messages.length - 1];
      if (question?.role !== 'user') {
        return reply.badRequest('The final message must be from the user.');
      }

      const authorization = request.headers.authorization;
      if (!authorization) return reply.unauthorized('Missing Authorization header.');

      /* Resolve the conversation before spending anything on the model, so an unknown id fails
         fast rather than after a paid round trip. */
      let conversation = conversationId
        ? await loadOwnConversation(request.user, conversationId)
        : null;
      if (conversationId && !conversation) return reply.notFound('Conversation not found');

      /* History comes from the database, never from the client. A caller could otherwise post a
         fabricated assistant turn and have the model treat its own supposed words as fact. */
      const priorTurns: ChatMessage[] = conversation
        ? (
            await db
              .get()
              .select({
                role: conversationMessages.role,
                content: conversationMessages.content,
              })
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.conversationId, conversation.id),
                  eq(conversationMessages.tenantId, request.user.tenantId),
                ),
              )
              .orderBy(asc(conversationMessages.createdAt))
          )
            .slice(-HISTORY_TURNS)
            .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        : [];

      try {
        const result = await ask(
          { app: fastify, authorization },
          { messages: [...priorTurns, question], view, brandId },
        );

        /* Persist only after a successful answer. Writing the question first would leave a
           conversation containing a question and no reply whenever the model failed, which
           reads to the user as the assistant having ignored them. */
        if (!conversation) {
          const [created] = await db
            .get()
            .insert(conversations)
            .values({
              tenantId: request.user.tenantId,
              userId: request.user.uid,
              title: titleFrom(question.content),
            })
            .returning();
          conversation = created ?? null;
        } else {
          await db
            .get()
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(
              and(
                eq(conversations.id, conversation.id),
                eq(conversations.tenantId, request.user.tenantId),
                eq(conversations.userId, request.user.uid),
              ),
            );
        }

        if (conversation) {
          await db
            .get()
            .insert(conversationMessages)
            .values([
              {
                conversationId: conversation.id,
                tenantId: request.user.tenantId,
                role: 'user',
                content: question.content,
              },
              {
                conversationId: conversation.id,
                tenantId: request.user.tenantId,
                role: 'assistant',
                content: result.answer,
                /* Stored so a revisited conversation still shows what the answer rested on.
                   History without citations is history you cannot check. */
                citations: result.citations,
                steps: result.steps,
              },
            ]);
        }

        return reply.send({
          conversationId: conversation?.id,
          answer: result.answer,
          citations: result.citations,
          steps: result.steps,
          truncated: result.truncated,
        });
      } catch (err) {
        /* Bedrock model access in this account is gated per model and has changed underneath a
           running deployment. Distinguishing that from a genuine bug matters: one is a
           configuration problem the owner can act on, the other is ours. */
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

/**
 * Loads a conversation only if it belongs to this user, in this tenant.
 *
 * One helper rather than the filter repeated at four call sites — the filter being repeated
 * correctly at every call site is precisely the assumption that failed in KNOWN-GAPS #5 and #5b.
 */
async function loadOwnConversation(
  user: { tenantId: string; uid: string },
  id: string,
): Promise<{ id: string; title: string; createdAt: Date; updatedAt: Date } | null> {
  const [row] = await db
    .get()
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.tenantId, user.tenantId),
        eq(conversations.userId, user.uid),
      ),
    )
    .limit(1);
  return row ?? null;
}

export default assistantRoutes;
