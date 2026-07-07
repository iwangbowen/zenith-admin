import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, text, jsonb, index } from 'drizzle-orm/pg-core';
import { auditColumns, tenants, users } from './core';

// ─── 聊天会话表 ───────────────────────────────────────────────────────────────
export const chatConversationTypeEnum = pgEnum('chat_conversation_type', ['direct', 'group']);

export const chatMemberRoleEnum = pgEnum('chat_member_role', ['owner', 'admin', 'member']);

export const chatConversations = pgTable('chat_conversations', {
  id: serial('id').primaryKey(),
  type: chatConversationTypeEnum('type').notNull().default('direct'),
  name: varchar('name', { length: 64 }),
  announcement: varchar('announcement', { length: 500 }),
  /** 全员禁言开关（群主/管理员不受限） */
  muteAll: boolean('mute_all').notNull().default(false),
  /** 入群审批开关：开启后通过邀请链接加群需群主/管理员审批 */
  joinApproval: boolean('join_approval').notNull().default(false),
  ...auditColumns(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChatConversationRow = typeof chatConversations.$inferSelect;

export type NewChatConversation = typeof chatConversations.$inferInsert;

// ─── 聊天会话成员表 ───────────────────────────────────────────────────────────
export const chatConversationMembers = pgTable('chat_conversation_members', {
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: chatMemberRoleEnum('role').notNull().default('member'),
  isPinned: boolean('is_pinned').notNull().default(false),
  isStarred: boolean('is_starred').notNull().default(false),
  isMuted: boolean('is_muted').notNull().default(false),
  /** 会话归档（收进「已归档」折叠分组，不影响未读计数） */
  isArchived: boolean('is_archived').notNull().default(false),
  /** 被禁言至（null = 未禁言；9999 年 = 永久禁言） */
  mutedUntil: timestamp('muted_until', { withTimezone: true }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  // 反查“我参与的所有会话”（listConversations），PK 前缀无法覆盖 user_id 查询
  index('chat_conversation_members_user_idx').on(t.userId),
]);

export type ChatConversationMemberRow = typeof chatConversationMembers.$inferSelect;

// ─── 聊天消息表 ───────────────────────────────────────────────────────────────
export const chatMessageTypeEnum = pgEnum('chat_message_type', ['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']);

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: integer('sender_id').references(() => users.id, { onDelete: 'set null' }),
  type: chatMessageTypeEnum('type').notNull().default('text'),
  content: text('content').notNull(),
  replyToId: integer('reply_to_id'),
  isRecalled: boolean('is_recalled').notNull().default(false),
  isEdited: boolean('is_edited').notNull().default(false),
  extra: jsonb('extra'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 会话消息游标分页（WHERE conversation_id = ? AND id < ? ORDER BY id DESC）及最新消息聚合
  index('chat_messages_conversation_id_idx').on(t.conversationId, t.id),
  // sender FK 无自动索引：加速按发送者过滤搜索及用户删除时的 ON DELETE SET NULL
  index('chat_messages_sender_idx').on(t.senderId),
]);

export type ChatMessageRow = typeof chatMessages.$inferSelect;

export type NewChatMessage = typeof chatMessages.$inferInsert;

export const chatMessageReactions = pgTable('chat_message_reactions', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 10 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.messageId, table.userId, table.emoji),
]);

export type ChatMessageReactionRow = typeof chatMessageReactions.$inferSelect;

// ─── 聊天入站 Webhook 机器人 ────────────────────────────────────────────────
export const chatWebhooks = pgTable('chat_webhooks', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  description: varchar('description', { length: 255 }),
  /** 入站推送令牌（明文存储，随机生成） */
  token: varchar('token', { length: 128 }).notNull().unique(),
  /** 消息投递的目标会话 */
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...auditColumns(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ChatWebhookRow = typeof chatWebhooks.$inferSelect;

export type NewChatWebhook = typeof chatWebhooks.$inferInsert;

// ─── 个人快捷回复（常用语） ───────────────────────────────────────────────────
export const chatQuickReplies = pgTable('chat_quick_replies', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: varchar('content', { length: 500 }).notNull(),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('chat_quick_replies_user_idx').on(t.userId),
]);

export type ChatQuickReplyRow = typeof chatQuickReplies.$inferSelect;

// ─── 定时消息 ─────────────────────────────────────────────────────────────────
export const chatScheduledStatusEnum = pgEnum('chat_scheduled_status', ['pending', 'sent', 'canceled', 'failed']);

export const chatScheduledMessages = pgTable('chat_scheduled_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: integer('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: chatMessageTypeEnum('type').notNull().default('text'),
  content: text('content').notNull(),
  extra: jsonb('extra'),
  /** 计划发送时间 */
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status: chatScheduledStatusEnum('status').notNull().default('pending'),
  failReason: varchar('fail_reason', { length: 255 }),
  /** 发送成功后关联的正式消息 ID */
  sentMessageId: integer('sent_message_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 派发器扫描到期任务
  index('chat_scheduled_messages_due_idx').on(t.status, t.scheduledAt),
  index('chat_scheduled_messages_sender_idx').on(t.senderId),
]);

export type ChatScheduledMessageRow = typeof chatScheduledMessages.$inferSelect;

// ─── 自定义表情（个人收藏） ───────────────────────────────────────────────────
export const chatCustomEmojis = pgTable('chat_custom_emojis', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 图片访问 URL */
  url: varchar('url', { length: 512 }).notNull(),
  /** 托管文件 ID（认证预览用，可空） */
  fileId: varchar('file_id', { length: 64 }),
  name: varchar('name', { length: 64 }),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('chat_custom_emojis_user_idx').on(t.userId),
]);

export type ChatCustomEmojiRow = typeof chatCustomEmojis.$inferSelect;

// ─── 群邀请链接 ───────────────────────────────────────────────────────────────
export const chatGroupInvites = pgTable('chat_group_invites', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  /** 邀请令牌（链接/二维码携带） */
  token: varchar('token', { length: 64 }).notNull().unique(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** 过期时间（null = 永久有效） */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** 最大使用次数（null = 不限） */
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('chat_group_invites_conv_idx').on(t.conversationId),
]);

export type ChatGroupInviteRow = typeof chatGroupInvites.$inferSelect;

// ─── 入群申请 ─────────────────────────────────────────────────────────────────
export const chatJoinRequestStatusEnum = pgEnum('chat_join_request_status', ['pending', 'approved', 'rejected']);

export const chatGroupJoinRequests = pgTable('chat_group_join_requests', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inviteId: integer('invite_id').references(() => chatGroupInvites.id, { onDelete: 'set null' }),
  status: chatJoinRequestStatusEnum('status').notNull().default('pending'),
  /** 申请附言 */
  message: varchar('message', { length: 255 }),
  handledBy: integer('handled_by').references(() => users.id, { onDelete: 'set null' }),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('chat_group_join_requests_conv_status_idx').on(t.conversationId, t.status),
  index('chat_group_join_requests_user_idx').on(t.userId),
]);

export type ChatGroupJoinRequestRow = typeof chatGroupJoinRequests.$inferSelect;
