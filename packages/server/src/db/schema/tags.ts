import { pgTable, serial, varchar, timestamp, integer, text } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
import { auditColumns } from './core';

export const tags = pgTable('tags', {
  id:          serial('id').primaryKey(),
  name:        varchar('name', { length: 50 }).notNull().unique(),
  color:       varchar('color', { length: 20 }),
  groupName:   varchar('group_name', { length: 50 }),
  description: text('description'),
  status:      statusEnum('status').notNull().default('enabled'),
  sortOrder:   integer('sort_order').notNull().default(0),
  ...auditColumns(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TagRow = typeof tags.$inferSelect;

export type NewTag = typeof tags.$inferInsert;

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────
