import { timestampColumns, idColumn, timestamptz } from './common';
import { pgTable, varchar, integer, unique, text, index } from 'drizzle-orm/pg-core';
import { auditColumns, tenantIdColumn } from './core';

// ─── 公告表 ─────────────────────────────────────────────────────────────────
export const announcements = pgTable('announcements', {
  id: idColumn(),
  title: varchar({ length: 128 }).notNull(),
  content: text().notNull(),
  type: varchar({ length: 32 }).notNull().default('notice'),
  publishStatus: varchar({ length: 32 }).notNull().default('draft'),
  priority: varchar({ length: 32 }).notNull().default('medium'),
  targetType: varchar({ length: 16 }).notNull().default('all'),
  publishTime: timestamptz(),
  createById: integer(),
  createByName: varchar({ length: 32 }),
  tenantId: tenantIdColumn(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('announcements_tenant_idx').on(t.tenantId)]);

export type AnnouncementRow = typeof announcements.$inferSelect;

export type NewAnnouncement = typeof announcements.$inferInsert;

// ─── 公告已读记录表 ───────────────────────────────────────────────────────────
export const announcementReads = pgTable('announcement_reads', {
  id: idColumn(),
  announcementId: integer().notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId: integer().notNull(),
  readAt: timestamptz().notNull().defaultNow(),
}, (t) => [unique('uniq_announcement_user').on(t.announcementId, t.userId)]);

export type AnnouncementReadRow = typeof announcementReads.$inferSelect;

// ─── 公告收件人表 ─────────────────────────────────────────────────────────────
export const announcementRecipients = pgTable('announcement_recipients', {
  id: idColumn(),
  announcementId: integer().notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  recipientType: varchar({ length: 16 }).notNull(), // 'user' | 'role' | 'dept'
  recipientId: integer().notNull(),
}, (t) => [unique('uniq_announcement_recipient').on(t.announcementId, t.recipientType, t.recipientId)]);

export type AnnouncementRecipientRow = typeof announcementRecipients.$inferSelect;
