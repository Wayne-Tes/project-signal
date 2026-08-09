import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Assistant conversation history.
 *
 * The assistant was deliberately stateless at first: the client sent the history it wanted
 * considered, and the server stored nothing, which is the cheapest possible way to not leak a
 * conversation store across tenants. The owner asked for persistent, revisitable history — a
 * desktop-chat experience — so the store now exists and has to earn that isolation properly.
 *
 * ISOLATION IS BY TENANT **AND** BY USER. Every other table in this product is tenant-scoped;
 * this one is the first where tenant scoping alone would be wrong. A conversation is private to
 * the person who had it: it can quote their own signals, their own scores and their own
 * questions, and colleagues in the same tenant have no business reading it. Both columns are
 * therefore filtered on every query, and the composite index below exists to make that the
 * cheap path rather than the diligent one.
 *
 * `userId` is the identity-provider subject (Cognito `sub`), matching `users.firebase_uid` —
 * the column name is a leftover from Firebase and is KNOWN-GAPS #25, not a claim about the
 * provider.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The identity-provider subject of the person who owns this conversation. */
    userId: varchar('user_id', { length: 128 }).notNull(),
    /**
     * Derived from the first question, not asked for.
     *
     * A chat surface that demands a title before you can ask anything is a chat surface people
     * stop using. Generated server-side from the opening message and editable later.
     */
    title: varchar('title', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bumped on every new message, so the list can be ordered by recent activity. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /* The only access pattern: "this user's conversations, most recent first". Ordering is part
       of the index because the list view always sorts by it, and a sort of a user's whole
       history on every page load is the kind of thing that is fine until it is not. */
    ownerRecent: index('conversations_owner_recent_idx').on(
      table.tenantId,
      table.userId,
      table.updatedAt,
    ),
  }),
);

/**
 * One turn in a conversation.
 *
 * `tenantId` is denormalised onto this table on purpose. Without it, reading messages safely
 * means joining to `conversations` and remembering to filter there — and this product has no
 * row-level security, so "remembering to filter" is exactly the thing that has already produced
 * two isolation defects (KNOWN-GAPS #5 and #5b). Carrying the tenant here lets every message
 * query filter it directly, so the safe query is also the obvious one.
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** `user` or `assistant`. Constrained in the API, not by an enum type. */
    role: varchar('role', { length: 16 }).notNull(),
    content: text('content').notNull(),
    /**
     * The citations shown with an assistant answer.
     *
     * Stored so a revisited conversation still shows what the answer was built from. Without
     * this, history would render past answers with no way to check them — which is precisely
     * the property that makes the assistant trustworthy in the first place.
     */
    citations: jsonb('citations'),
    /** Tool names in call order, for the "what it looked at" disclosure. */
    steps: text('steps').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byConversation: index('conversation_messages_conversation_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);
