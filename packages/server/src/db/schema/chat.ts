import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, text, jsonb, index } from 'drizzle-orm/pg-core';
import { auditColumns, tenants, users } from './core';

// ─── 聊天会话表 ───────────────────────────────────────────────────────────────
export const chatConversationTypeEnum = pgEnum('chat_conversation_type', ['direct', 'group']);

export const chatMemberRoleEnum = pgEnum('chat_member_role', ['owner', 'admin', 'member']);

export const chatConversations = pgTable('chat_conversations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  type: chatConversationTypeEnum().notNull().default('direct'),
  name: varchar({ length: 64 }),
  announcement: varchar({ length: 500 }),
  /** 全员禁言开关（群主/管理员不受限） */
  muteAll: boolean().notNull().default(false),
  /** 入群审批开关：开启后通过邀请链接加群需群主/管理员审批 */
  joinApproval: boolean().notNull().default(false),
  ...auditColumns(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [index('chat_conversations_tenant_idx').on(t.tenantId)]);

export type ChatConversationRow = typeof chatConversations.$inferSelect;

export type NewChatConversation = typeof chatConversations.$inferInsert;

// ─── 聊天会话成员表 ───────────────────────────────────────────────────────────
export const chatConversationMembers = pgTable('chat_conversation_members', {
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: chatMemberRoleEnum().notNull().default('member'),
  isPinned: boolean().notNull().default(false),
  isStarred: boolean().notNull().default(false),
  isMuted: boolean().notNull().default(false),
  /** 会话归档（收进「已归档」折叠分组，不影响未读计数） */
  isArchived: boolean().notNull().default(false),
  /** 被禁言至（null = 未禁言；9999 年 = 永久禁言） */
  mutedUntil: timestamp({ withTimezone: true }),
  lastReadAt: timestamp({ withTimezone: true }),
  joinedAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  // 反查“我参与的所有会话”（listConversations），PK 前缀无法覆盖 user_id 查询
  index('chat_conversation_members_user_idx').on(t.userId),
]);

export type ChatConversationMemberRow = typeof chatConversationMembers.$inferSelect;

// ─── 聊天消息表 ───────────────────────────────────────────────────────────────
export const chatMessageTypeEnum = pgEnum('chat_message_type', ['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']);

export const chatMessages = pgTable('chat_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: integer().references(() => users.id, { onDelete: 'set null' }),
  type: chatMessageTypeEnum().notNull().default('text'),
  content: text().notNull(),
  replyToId: integer(),
  isRecalled: boolean().notNull().default(false),
  isEdited: boolean().notNull().default(false),
  extra: jsonb(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  // 会话消息游标分页（WHERE conversation_id = ? AND id < ? ORDER BY id DESC）及最新消息聚合
  index('chat_messages_conversation_id_idx').on(t.conversationId, t.id),
  // 未读统计（listConversations）：按会话只扫 created_at > last_read_at 的消息，(conversation_id, id) 不覆盖时间比较
  index('chat_messages_conversation_created_idx').on(t.conversationId, t.createdAt),
  // sender FK 无自动索引：加速按发送者过滤搜索及用户删除时的 ON DELETE SET NULL
  index('chat_messages_sender_idx').on(t.senderId),
]);

export type ChatMessageRow = typeof chatMessages.$inferSelect;

export type NewChatMessage = typeof chatMessages.$inferInsert;

export const chatMessageReactions = pgTable('chat_message_reactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  messageId: integer().notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar({ length: 10 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('chat_message_reactions_user_idx').on(table.userId), 
  unique('chat_message_reactions_message_id_user_id_emoji_unique').on(table.messageId, table.userId, table.emoji),
]);

export type ChatMessageReactionRow = typeof chatMessageReactions.$inferSelect;

// ─── 消息收藏（按用户隔离；置顶是会话级共享，收藏是个人行为） ─────────────────
export const chatMessageFavorites = pgTable('chat_message_favorites', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  messageId: integer().notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // 全局收藏列表按收藏时间倒序分页
  index('chat_message_favorites_user_idx').on(t.userId, t.createdAt),
  unique('chat_message_favorites_message_id_user_id_unique').on(t.messageId, t.userId),
]);

export type ChatMessageFavoriteRow = typeof chatMessageFavorites.$inferSelect;

// ─── 聊天入站 Webhook 机器人 ────────────────────────────────────────────────
export const chatWebhooks = pgTable('chat_webhooks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  avatar: varchar({ length: 256 }),
  description: varchar({ length: 255 }),
  /** 入站推送令牌（明文存储，随机生成） */
  token: varchar({ length: 128 }).notNull().unique(),
  /** 消息投递的目标会话 */
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  enabled: boolean().notNull().default(true),
  lastUsedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [index('chat_webhooks_conversation_idx').on(t.conversationId), index('chat_webhooks_tenant_idx').on(t.tenantId)]);

export type ChatWebhookRow = typeof chatWebhooks.$inferSelect;

export type NewChatWebhook = typeof chatWebhooks.$inferInsert;

// ─── 个人快捷回复（常用语） ───────────────────────────────────────────────────
export const chatQuickReplies = pgTable('chat_quick_replies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: varchar({ length: 500 }).notNull(),
  sort: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [
  index('chat_quick_replies_user_idx').on(t.userId),
]);

export type ChatQuickReplyRow = typeof chatQuickReplies.$inferSelect;

// ─── 定时消息 ─────────────────────────────────────────────────────────────────
export const chatScheduledStatusEnum = pgEnum('chat_scheduled_status', ['pending', 'sent', 'canceled', 'failed']);

export const chatScheduledMessages = pgTable('chat_scheduled_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: chatMessageTypeEnum().notNull().default('text'),
  content: text().notNull(),
  extra: jsonb(),
  /** 计划发送时间 */
  scheduledAt: timestamp({ withTimezone: true }).notNull(),
  status: chatScheduledStatusEnum().notNull().default('pending'),
  failReason: varchar({ length: 255 }),
  /** 发送成功后关联的正式消息 ID */
  sentMessageId: integer(),
  ...timestampColumns(),
}, (t) => [index('chat_scheduled_messages_conversation_idx').on(t.conversationId), 
  // 派发器扫描到期任务
  index('chat_scheduled_messages_due_idx').on(t.status, t.scheduledAt),
  index('chat_scheduled_messages_sender_idx').on(t.senderId),
]);

export type ChatScheduledMessageRow = typeof chatScheduledMessages.$inferSelect;

// ─── 自定义表情（个人收藏） ───────────────────────────────────────────────────
export const chatCustomEmojis = pgTable('chat_custom_emojis', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 图片访问 URL */
  url: varchar({ length: 512 }).notNull(),
  /** 托管文件 ID（认证预览用，可空） */
  fileId: varchar({ length: 64 }),
  name: varchar({ length: 64 }),
  width: integer(),
  height: integer(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('chat_custom_emojis_user_idx').on(t.userId),
]);

export type ChatCustomEmojiRow = typeof chatCustomEmojis.$inferSelect;

// ─── 群邀请链接 ───────────────────────────────────────────────────────────────
export const chatGroupInvites = pgTable('chat_group_invites', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  /** 邀请令牌（链接/二维码携带） */
  token: varchar({ length: 64 }).notNull().unique(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 过期时间（null = 永久有效） */
  expiresAt: timestamp({ withTimezone: true }),
  /** 最大使用次数（null = 不限） */
  maxUses: integer(),
  usedCount: integer().notNull().default(0),
  enabled: boolean().notNull().default(true),
  ...timestampColumns(),
}, (t) => [
  index('chat_group_invites_conv_idx').on(t.conversationId),
]);

export type ChatGroupInviteRow = typeof chatGroupInvites.$inferSelect;

// ─── 入群申请 ─────────────────────────────────────────────────────────────────
export const chatJoinRequestStatusEnum = pgEnum('chat_join_request_status', ['pending', 'approved', 'rejected']);

export const chatGroupJoinRequests = pgTable('chat_group_join_requests', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  conversationId: integer().notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  inviteId: integer().references(() => chatGroupInvites.id, { onDelete: 'set null' }),
  status: chatJoinRequestStatusEnum().notNull().default('pending'),
  /** 申请附言 */
  message: varchar({ length: 255 }),
  handledBy: integer().references(() => users.id, { onDelete: 'set null' }),
  handledAt: timestamp({ withTimezone: true }),
  ...timestampColumns(),
}, (t) => [
  index('chat_group_join_requests_conv_status_idx').on(t.conversationId, t.status),
  index('chat_group_join_requests_user_idx').on(t.userId),
]);

export type ChatGroupJoinRequestRow = typeof chatGroupJoinRequests.$inferSelect;
