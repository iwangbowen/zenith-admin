import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb, index } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export const channelTypeEnum = pgEnum('channel_type', ['system', 'business']);

export const channelAudienceEnum = pgEnum('channel_audience', ['broadcast', 'targeted']);

export const channelMessageTypeEnum = pgEnum('channel_message_type', ['text', 'card', 'image', 'news']);

export const channelMessageStatusEnum = pgEnum('channel_message_status', ['sent', 'draft', 'scheduled']);

export const channelMessageDirectionEnum = pgEnum('channel_message_direction', ['out', 'in']);

export const channelMenuTypeEnum = pgEnum('channel_menu_type', ['click', 'view']);

export const channelAutoReplyMatchEnum = pgEnum('channel_auto_reply_match', ['subscribe', 'keyword', 'default']);

export const channelAutoReplyKeywordModeEnum = pgEnum('channel_auto_reply_keyword_mode', ['exact', 'contains']);

export const channelConversationStatusEnum = pgEnum('channel_conversation_status', ['open', 'processing', 'resolved']);

export const channels = pgTable('channels', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  code: varchar({ length: 64 }).notNull().unique(),
  name: varchar({ length: 64 }).notNull(),
  avatar: varchar({ length: 256 }),
  description: varchar({ length: 255 }),
  type: channelTypeEnum().notNull().default('system'),
  builtin: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('channels_tenant_idx').on(t.tenantId)]);

export type ChannelRow = typeof channels.$inferSelect;

export type NewChannel = typeof channels.$inferInsert;

export const channelMessages = pgTable('channel_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  channelId: integer().notNull().references(() => channels.id, { onDelete: 'cascade' }),
  audienceType: channelAudienceEnum().notNull().default('broadcast'),
  type: channelMessageTypeEnum().notNull().default('text'),
  title: varchar({ length: 200 }),
  content: text().notNull(),
  extra: jsonb(),
  publishedById: integer().references(() => users.id, { onDelete: 'set null' }),
  direction: channelMessageDirectionEnum().notNull().default('out'),
  senderUserId: integer().references(() => users.id, { onDelete: 'set null' }),
  status: channelMessageStatusEnum().notNull().default('sent'),
  scheduledAt: timestamp({ withTimezone: true }),
  retractedAt: timestamp({ withTimezone: true }),
  targetSpec: jsonb(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('channel_messages_channel_idx').on(t.channelId)]);

export type ChannelMessageRow = typeof channelMessages.$inferSelect;

export type NewChannelMessage = typeof channelMessages.$inferInsert;

export const channelSubscriptions = pgTable('channel_subscriptions', {
  channelId: integer().notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp({ withTimezone: true }),
  isMuted: boolean().notNull().default(false),
  subscribedAt: timestamp().defaultNow().notNull(),
}, (t) => [index('channel_subscriptions_user_idx').on(t.userId), primaryKey({ columns: [t.channelId, t.userId] })]);

export type ChannelSubscriptionRow = typeof channelSubscriptions.$inferSelect;

export const channelMessageTargets = pgTable('channel_message_targets', {
  messageId: integer().notNull().references(() => channelMessages.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp({ withTimezone: true }),
}, (t) => [index('channel_message_targets_user_idx').on(t.userId), primaryKey({ columns: [t.messageId, t.userId] })]);

export type ChannelMessageTargetRow = typeof channelMessageTargets.$inferSelect;

// ─── Channel 公众号菜单（运营号底部菜单） ──────────────────────────────────────
export const channelMenus = pgTable('channel_menus', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  channelId: integer().notNull().references(() => channels.id, { onDelete: 'cascade' }),
  parentId: integer(),
  name: varchar({ length: 32 }).notNull(),
  type: channelMenuTypeEnum().notNull().default('click'),
  value: varchar({ length: 500 }),
  sort: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [index('channel_menus_channel_idx').on(t.channelId)]);

export type ChannelMenuRow = typeof channelMenus.$inferSelect;

// ─── Channel 自动回复规则 ──────────────────────────────────────────────────────
export const channelAutoReplies = pgTable('channel_auto_replies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  channelId: integer().notNull().references(() => channels.id, { onDelete: 'cascade' }),
  matchType: channelAutoReplyMatchEnum().notNull().default('keyword'),
  keyword: varchar({ length: 100 }),
  keywordMode: channelAutoReplyKeywordModeEnum().notNull().default('contains'),
  replyType: channelMessageTypeEnum().notNull().default('text'),
  replyContent: text().notNull(),
  replyExtra: jsonb(),
  hitCount: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [index('channel_auto_replies_channel_idx').on(t.channelId)]);

export type ChannelAutoReplyRow = typeof channelAutoReplies.$inferSelect;

// ─── Channel 客服快捷回复库（D：channelId 为 null 表示全局，所有运营号可用） ────
export const channelQuickReplies = pgTable('channel_quick_replies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  channelId: integer().references(() => channels.id, { onDelete: 'cascade' }),
  title: varchar({ length: 100 }).notNull(),
  content: text().notNull(),
  sort: integer().notNull().default(0),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('channel_quick_replies_channel_idx').on(t.channelId)]);

export type ChannelQuickReplyRow = typeof channelQuickReplies.$inferSelect;

export type NewChannelQuickReply = typeof channelQuickReplies.$inferInsert;

// ─── Channel 客服会话治理（G：状态机 / 指派转接 / 标签；属性表 left join 到消息聚合） ──
export const channelConversations = pgTable('channel_conversations', {
  channelId: integer().notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: channelConversationStatusEnum().notNull().default('open'),
  assigneeId: integer().references(() => users.id, { onDelete: 'set null' }),
  tags: jsonb().$type<string[]>().notNull().default([]),
  resolvedAt: timestamp({ withTimezone: true }),
  rating: integer(),
  ratingComment: text(),
  ratedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('channel_conversations_user_idx').on(t.userId), primaryKey({ columns: [t.channelId, t.userId] })]);

export type ChannelConversationRow = typeof channelConversations.$inferSelect;

export type NewChannelConversation = typeof channelConversations.$inferInsert;

// ─── Channel 群发消息模板（运营常用群发内容保存复用） ──────────────────────────
export const channelMessageTemplates = pgTable('channel_message_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  type: channelMessageTypeEnum().notNull().default('text'),
  title: varchar({ length: 200 }),
  content: text().notNull().default(''),
  extra: jsonb(),
  ...auditColumns(),
  ...timestampColumns(),
});

export type ChannelMessageTemplateRow = typeof channelMessageTemplates.$inferSelect;

export type NewChannelMessageTemplate = typeof channelMessageTemplates.$inferInsert;
