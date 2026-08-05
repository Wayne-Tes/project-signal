import { pgTable, uuid, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { brandEntities } from './brands';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  role: varchar('role', { length: 20 }).notNull(),
  brandEntityId: uuid('brand_entity_id').references(() => brandEntities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
