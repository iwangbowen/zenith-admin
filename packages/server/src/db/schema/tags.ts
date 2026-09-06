import { pgTable, varchar, integer, text } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns } from './core';

export const tags = pgTable('tags', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  name:        varchar({ length: 50 }).notNull().unique(),
  color:       varchar({ length: 20 }),
  groupName:   varchar({ length: 50 }),
  description: text(),
  status:      statusEnum().notNull().default('enabled'),
  sortOrder:   integer().notNull().default(0),
  ...auditColumns(),
  ...timestampColumns(),
});

export type TagRow = typeof tags.$inferSelect;

export type NewTag = typeof tags.$inferInsert;

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────
