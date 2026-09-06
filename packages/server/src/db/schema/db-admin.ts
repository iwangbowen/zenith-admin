import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, boolean, text, uuid as pgUuid, index } from 'drizzle-orm/pg-core';
import { auditColumns, users } from './core';
import { managedFiles } from './files';

// ─── 数据库备份记录表 ──────────────────────────────────────────────────────────
export const backupTypeEnum = pgEnum('backup_type', ['pg_dump', 'drizzle_export']);

export const backupStatusEnum = pgEnum('backup_status', ['pending', 'running', 'success', 'failed']);

export const dbBackups = pgTable('db_backups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 128 }).notNull(),
  type: backupTypeEnum().notNull(),
  fileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  fileSize: integer(),
  status: backupStatusEnum().notNull().default('pending'),
  tables: text(),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  durationMs: integer(),
  errorMessage: text(),
  ...auditColumns(),
  ...timestampColumns(),
});

export type DbBackupRow = typeof dbBackups.$inferSelect;

export type NewDbBackup = typeof dbBackups.$inferInsert;

// ─── 数据库管理 SQL 查询历史表 ──────────────────────────────────────────────────
export const dbAdminQueryHistory = pgTable('db_admin_query_history', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  sqlText: text().notNull(),
  durationMs: integer().notNull().default(0),
  rowCount: integer().notNull().default(0),
  success: boolean().notNull().default(true),
  errorMessage: text(),
  executedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('db_admin_query_history_executed_at_idx').on(t.executedAt),
  index('db_admin_query_history_user_idx').on(t.userId),
]);

export type DbAdminQueryHistoryRow = typeof dbAdminQueryHistory.$inferSelect;

export type NewDbAdminQueryHistory = typeof dbAdminQueryHistory.$inferInsert;

// ─── 数据库管理 SQL 查询收藏夹 ───────────────────────────────────────────────────
export const dbQueryFavorites = pgTable('db_query_favorites', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  sql: text().notNull(),
  description: text(),
  tags: text().array().notNull().default([]),
  ...timestampColumns(),
}, (t) => [index('db_query_favorites_user_idx').on(t.userId)]);

export type DbQueryFavoriteRow = typeof dbQueryFavorites.$inferSelect;

export type NewDbQueryFavorite = typeof dbQueryFavorites.$inferInsert;
