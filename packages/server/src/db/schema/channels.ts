import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';
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
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  description: varchar('description', { length: 255 }),
  type: channelTypeEnum('type').notNull().default('system'),
  builtin: boolean('builtin').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChannelRow = typeof channels.$inferSelect;

export type NewChannel = typeof channels.$inferInsert;

export const channelMessages = pgTable('channel_messages', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  audienceType: channelAudienceEnum('audience_type').notNull().default('broadcast'),
  type: channelMessageTypeEnum('type').notNull().default('text'),
  title: varchar('title', { length: 200 }),
  content: text('content').notNull(),
  extra: jsonb('extra'),
  publishedById: integer('published_by_id').references(() => users.id, { onDelete: 'set null' }),
  direction: channelMessageDirectionEnum('direction').notNull().default('out'),
  senderUserId: integer('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: channelMessageStatusEnum('status').notNull().default('sent'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
  targetSpec: jsonb('target_spec'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ChannelMessageRow = typeof channelMessages.$inferSelect;

export type NewChannelMessage = typeof channelMessages.$inferInsert;

export const channelSubscriptions = pgTable('channel_subscriptions', {
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  isMuted: boolean('is_muted').notNull().default(false),
  subscribedAt: timestamp('subscribed_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);

export type ChannelSubscriptionRow = typeof channelSubscriptions.$inferSelect;

export const channelMessageTargets = pgTable('channel_message_targets', {
  messageId: integer('message_id').notNull().references(() => channelMessages.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] })]);

export type ChannelMessageTargetRow = typeof channelMessageTargets.$inferSelect;

// ─── Channel 公众号菜单（运营号底部菜单） ──────────────────────────────────────
export const channelMenus = pgTable('channel_menus', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id'),
  name: varchar('name', { length: 32 }).notNull(),
  type: channelMenuTypeEnum('type').notNull().default('click'),
  value: varchar('value', { length: 500 }),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChannelMenuRow = typeof channelMenus.$inferSelect;

// ─── Channel 自动回复规则 ──────────────────────────────────────────────────────
export const channelAutoReplies = pgTable('channel_auto_replies', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  matchType: channelAutoReplyMatchEnum('match_type').notNull().default('keyword'),
  keyword: varchar('keyword', { length: 100 }),
  keywordMode: channelAutoReplyKeywordModeEnum('keyword_mode').notNull().default('contains'),
  replyType: channelMessageTypeEnum('reply_type').notNull().default('text'),
  replyContent: text('reply_content').notNull(),
  replyExtra: jsonb('reply_extra'),
  hitCount: integer('hit_count').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChannelAutoReplyRow = typeof channelAutoReplies.$inferSelect;

// ─── Channel 客服快捷回复库（D：channelId 为 null 表示全局，所有运营号可用） ────
export const channelQuickReplies = pgTable('channel_quick_replies', {
  id: serial('id').primaryKey(),
  channelId: integer('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 100 }).notNull(),
  content: text('content').notNull(),
  sort: integer('sort').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChannelQuickReplyRow = typeof channelQuickReplies.$inferSelect;

export type NewChannelQuickReply = typeof channelQuickReplies.$inferInsert;

// ─── Channel 客服会话治理（G：状态机 / 指派转接 / 标签；属性表 left join 到消息聚合） ──
export const channelConversations = pgTable('channel_conversations', {
  channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: channelConversationStatusEnum('status').notNull().default('open'),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  rating: integer('rating'),
  ratingComment: text('rating_comment'),
  ratedAt: timestamp('rated_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);

export type ChannelConversationRow = typeof channelConversations.$inferSelect;

export type NewChannelConversation = typeof channelConversations.$inferInsert;

// ─── Channel 群发消息模板（运营常用群发内容保存复用） ──────────────────────────
export const channelMessageTemplates = pgTable('channel_message_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: channelMessageTypeEnum('type').notNull().default('text'),
  title: varchar('title', { length: 200 }),
  content: text('content').notNull().default(''),
  extra: jsonb('extra'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChannelMessageTemplateRow = typeof channelMessageTemplates.$inferSelect;

export type NewChannelMessageTemplate = typeof channelMessageTemplates.$inferInsert;
