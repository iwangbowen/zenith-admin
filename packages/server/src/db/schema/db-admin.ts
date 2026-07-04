import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, uuid as pgUuid } from 'drizzle-orm/pg-core';
import { auditColumns, users } from './core';
import { managedFiles } from './files';

// ─── 数据库备份记录表 ──────────────────────────────────────────────────────────
export const backupTypeEnum = pgEnum('backup_type', ['pg_dump', 'drizzle_export']);

export const backupStatusEnum = pgEnum('backup_status', ['pending', 'running', 'success', 'failed']);

export const dbBackups = pgTable('db_backups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  type: backupTypeEnum('type').notNull(),
  fileId: pgUuid('file_id').references(() => managedFiles.id, { onDelete: 'set null' }),
  fileSize: integer('file_size'),
  status: backupStatusEnum('status').notNull().default('pending'),
  tables: text('tables'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type DbBackupRow = typeof dbBackups.$inferSelect;

export type NewDbBackup = typeof dbBackups.$inferInsert;

// ─── 数据库管理 SQL 查询历史表 ──────────────────────────────────────────────────
export const dbAdminQueryHistory = pgTable('db_admin_query_history', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sqlText: text('sql_text').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  rowCount: integer('row_count').notNull().default(0),
  success: boolean('success').notNull().default(true),
  errorMessage: text('error_message'),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DbAdminQueryHistoryRow = typeof dbAdminQueryHistory.$inferSelect;

export type NewDbAdminQueryHistory = typeof dbAdminQueryHistory.$inferInsert;

// ─── 数据库管理 SQL 查询收藏夹 ───────────────────────────────────────────────────
export const dbQueryFavorites = pgTable('db_query_favorites', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  sql: text('sql').notNull(),
  description: text('description'),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type DbQueryFavoriteRow = typeof dbQueryFavorites.$inferSelect;

export type NewDbQueryFavorite = typeof dbQueryFavorites.$inferInsert;
