import { pgTable, uuid, varchar, real, text, timestamp } from 'drizzle-orm/pg-core';
import { signals } from './signals';

export const sentimentResults = pgTable('sentiment_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalId: uuid('signal_id').notNull().unique().references(() => signals.id),
  label: varchar('label', { length: 20 }),
  score: real('score'),
  confidence: real('confidence'),
  dimensions: text('dimensions').array(),
  topics: text('topics').array(),
  modelVersion: varchar('model_version', { length: 50 }),
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
});
