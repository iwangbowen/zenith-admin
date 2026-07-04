import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, text, uniqueIndex, index, jsonb, smallint, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';
import { members } from './member';

// ─── 公众号管理 ────────────────────────────────────────────────────────────────
// 微信公众号账号（多公众号 + 租户隔离）。子实体（粉丝/标签/消息/菜单/素材/图文等）
// 在后续阶段加入，均通过 account_id 外键挂到此表。
export const mpAccountTypeEnum = pgEnum('mp_account_type', ['subscribe', 'service', 'test']);

export const mpEncryptModeEnum = pgEnum('mp_encrypt_mode', ['plaintext', 'compatible', 'safe']);

export const mpAccounts = pgTable('mp_accounts', {
  id: serial('id').primaryKey(),
  /** 公众号名称 */
  name: varchar('name', { length: 100 }).notNull(),
  /** 微信号 / 原始 ID（gh_xxx） */
  account: varchar('account', { length: 100 }),
  /** 公众号 AppID（全局唯一） */
  appId: varchar('app_id', { length: 64 }).notNull().unique(),
  /** 公众号 AppSecret（响应中脱敏） */
  appSecret: varchar('app_secret', { length: 128 }).notNull().default(''),
  /** 服务器配置 Token（回调签名校验用） */
  token: varchar('token', { length: 64 }).notNull().default(''),
  /** 消息加解密密钥（安全模式 / 兼容模式需要） */
  encodingAesKey: varchar('encoding_aes_key', { length: 64 }),
  /** 消息加解密方式：明文 / 兼容 / 安全 */
  encryptMode: mpEncryptModeEnum('encrypt_mode').notNull().default('plaintext'),
  /** 账号类型：订阅号 / 服务号 / 测试号 */
  type: mpAccountTypeEnum('type').notNull().default('service'),
  /** 二维码图片地址 */
  qrCodeUrl: varchar('qr_code_url', { length: 500 }),
  /** 是否默认公众号（同租户内唯一） */
  isDefault: boolean('is_default').notNull().default(false),
  /** 关注即注册会员：粉丝关注时自动创建并绑定会员 */
  autoCreateMember: boolean('auto_create_member').notNull().default(false),
  /** 是否对群发/客服消息启用内容安全校验（msg_sec_check） */
  contentCheckEnabled: boolean('content_check_enabled').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  remark: text('remark'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_accounts_tenant_idx').on(t.tenantId),
]);

export type MpAccountRow = typeof mpAccounts.$inferSelect;

export type NewMpAccount = typeof mpAccounts.$inferInsert;

// 公众号粉丝标签（与微信标签同步；wechat_tag_id 同步后回填）
export const mpTags = pgTable('mp_tags', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信侧标签 id（从微信同步后回填，本地新建时为空） */
  wechatTagId: integer('wechat_tag_id'),
  name: varchar('name', { length: 30 }).notNull(),
  /** 该标签下粉丝数（同步时更新） */
  fansCount: integer('fans_count').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_tags_account_name_uq').on(t.accountId, t.name),
  index('mp_tags_account_idx').on(t.accountId),
]);

export type MpTagRow = typeof mpTags.$inferSelect;

export type NewMpTag = typeof mpTags.$inferInsert;

// 公众号粉丝（关注者；从微信同步，本地可备注/打标签）
export const mpFanSubscribeEnum = pgEnum('mp_fan_subscribe', ['subscribed', 'unsubscribed']);

export const mpFans = pgTable('mp_fans', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  nickname: varchar('nickname', { length: 128 }),
  avatar: varchar('avatar', { length: 512 }),
  /** 性别：0 未知 / 1 男 / 2 女 */
  sex: smallint('sex').notNull().default(0),
  country: varchar('country', { length: 64 }),
  province: varchar('province', { length: 64 }),
  city: varchar('city', { length: 64 }),
  language: varchar('language', { length: 16 }),
  subscribe: mpFanSubscribeEnum('subscribe').notNull().default('subscribed'),
  subscribeTime: timestamp('subscribe_time', { withTimezone: true }),
  /** 本地备注 */
  remark: varchar('remark', { length: 128 }),
  /** 本地标签 id 列表（指向 mp_tags.id） */
  tagIds: jsonb('tag_ids').$type<number[]>().notNull().default([]),
  /** 微信 unionid（账号绑定开放平台时可获取，用于跨应用打通会员） */
  unionid: varchar('unionid', { length: 64 }),
  /** 关联的会员 id（公众号粉丝 ↔ 会员体系打通） */
  memberId: integer('member_id').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  /** 是否已加入黑名单（微信 batchblacklist） */
  blacklisted: boolean('blacklisted').notNull().default(false),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_fans_account_openid_uq').on(t.accountId, t.openid),
  index('mp_fans_account_idx').on(t.accountId),
  index('mp_fans_member_idx').on(t.memberId),
]);

export type MpFanRow = typeof mpFans.$inferSelect;

export type NewMpFan = typeof mpFans.$inferInsert;

// 公众号消息（追加型：入站用户消息 / 出站客服消息）。作者天然为粉丝或当前管理员，故不加审计列。
export const mpMessageDirectionEnum = pgEnum('mp_message_direction', ['in', 'out']);

export const mpMessageTypeEnum = pgEnum('mp_message_type', ['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event']);

export const mpMessageStatusEnum = pgEnum('mp_message_status', ['received', 'sent', 'failed']);

export const mpMessages = pgTable('mp_messages', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  /** in=用户发来 out=客服回复 */
  direction: mpMessageDirectionEnum('direction').notNull(),
  msgType: mpMessageTypeEnum('msg_type').notNull().default('text'),
  /** 文本内容 / 链接地址 / 事件 EventKey */
  content: text('content'),
  /** 媒体素材 id（图片/语音/视频） */
  mediaId: varchar('media_id', { length: 128 }),
  /** 媒体 URL（图片 PicUrl 等） */
  mediaUrl: varchar('media_url', { length: 1000 }),
  /** 事件类型（msgType=event 时：subscribe/unsubscribe/CLICK/VIEW/SCAN…） */
  event: varchar('event', { length: 32 }),
  /** 微信消息 id（入站去重用） */
  msgId: varchar('msg_id', { length: 64 }),
  status: mpMessageStatusEnum('status').notNull().default('received'),
  errorMsg: text('error_msg'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_messages_account_openid_idx').on(t.accountId, t.openid),
  index('mp_messages_account_idx').on(t.accountId),
  // 入站消息去重：同一账号下 msg_id 唯一（仅对非空 msg_id 生效），保证微信重试不产生重复记录
  uniqueIndex('mp_messages_account_msgid_uq').on(t.accountId, t.msgId).where(sql`${t.msgId} IS NOT NULL`),
]);

export type MpMessageRow = typeof mpMessages.$inferSelect;

export type NewMpMessage = typeof mpMessages.$inferInsert;

// 公众号自动回复（关注回复 / 关键词回复 / 默认回复）
export const mpAutoReplyTypeEnum = pgEnum('mp_auto_reply_type', ['subscribe', 'keyword', 'default']);

export const mpAutoReplyMatchEnum = pgEnum('mp_auto_reply_match', ['exact', 'contain', 'regex']);

export const mpReplyContentTypeEnum = pgEnum('mp_reply_content_type', ['text', 'image', 'voice', 'video', 'news']);

export const mpAutoReplies = pgTable('mp_auto_replies', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  replyType: mpAutoReplyTypeEnum('reply_type').notNull(),
  /** 关键词（仅 replyType=keyword） */
  keyword: varchar('keyword', { length: 64 }),
  /** 匹配方式（仅 keyword）：exact=全匹配 contain=包含 */
  matchType: mpAutoReplyMatchEnum('match_type').notNull().default('contain'),
  contentType: mpReplyContentTypeEnum('content_type').notNull().default('text'),
  /** 文本回复内容（也用于视频标题） */
  content: text('content'),
  /** 图片/语音/视频回复素材 id（contentType=image/voice/video） */
  mediaId: varchar('media_id', { length: 128 }),
  /** 图文回复文章列表（contentType=news） */
  newsArticles: jsonb('news_articles').$type<{ title: string; description?: string; picUrl?: string; url: string }[]>(),
  /** 命中后是否转人工客服（接入多客服会话） */
  transferToKf: boolean('transfer_to_kf').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  /** 关键词优先级（小在前） */
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_auto_replies_account_type_idx').on(t.accountId, t.replyType),
]);

export type MpAutoReplyRow = typeof mpAutoReplies.$inferSelect;

export type NewMpAutoReply = typeof mpAutoReplies.$inferInsert;

// 自动回复未命中关键词收集（用于优化关键词库；按 account+keyword 累计命中次数）
export const mpUnmatchedKeywords = pgTable('mp_unmatched_keywords', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  keyword: varchar('keyword', { length: 128 }).notNull(),
  count: integer('count').notNull().default(1),
  lastAt: timestamp('last_at').defaultNow().notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('mp_unmatched_keywords_account_kw_uq').on(t.accountId, t.keyword),
]);

export type MpUnmatchedKeywordRow = typeof mpUnmatchedKeywords.$inferSelect;

export type NewMpUnmatchedKeyword = typeof mpUnmatchedKeywords.$inferInsert;

// 公众号自定义菜单（每账号一份，buttons 为微信菜单按钮树 JSON）
export const mpMenuStatusEnum = pgEnum('mp_menu_status', ['draft', 'published']);

export const mpMenus = pgTable('mp_menus', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().unique().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信菜单按钮树（最多 3 个一级，每个最多 5 个二级） */
  buttons: jsonb('buttons').$type<unknown[]>().notNull().default([]),
  status: mpMenuStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MpMenuRow = typeof mpMenus.$inferSelect;

export type NewMpMenu = typeof mpMenus.$inferInsert;

// 个性化菜单（按标签/性别/地区等匹配规则向不同人群下发不同菜单）
export const mpConditionalMenus = pgTable('mp_conditional_menus', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 本地名称（便于管理识别） */
  name: varchar('name', { length: 64 }).notNull(),
  /** 菜单按钮树（结构同普通自定义菜单） */
  buttons: jsonb('buttons').$type<unknown[]>().notNull().default([]),
  /** 匹配规则：tag_id/sex/country/province/city/client_platform_type/language */
  matchRule: jsonb('match_rule').$type<Record<string, string>>().notNull().default({}),
  /** 微信返回的 menuid（发布后写入） */
  menuId: varchar('menu_id', { length: 64 }),
  status: mpMenuStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_conditional_menus_account_idx').on(t.accountId),
]);

export type MpConditionalMenuRow = typeof mpConditionalMenus.$inferSelect;

export type NewMpConditionalMenu = typeof mpConditionalMenus.$inferInsert;

// 公众号素材（图片 / 语音 / 视频 / 缩略图），本地登记 + 与微信永久素材同步
export const mpMaterialTypeEnum = pgEnum('mp_material_type', ['image', 'voice', 'video', 'thumb']);

export const mpMaterials = pgTable('mp_materials', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpMaterialTypeEnum('type').notNull().default('image'),
  name: varchar('name', { length: 200 }).notNull(),
  /** 微信永久素材 media_id（同步 / 推送后回填） */
  wechatMediaId: varchar('wechat_media_id', { length: 128 }),
  /** 素材 URL（图片可直接预览） */
  url: varchar('url', { length: 1000 }),
  /** 文件大小（字节） */
  fileSize: integer('file_size'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_materials_account_type_idx').on(t.accountId, t.type),
]);

export type MpMaterialRow = typeof mpMaterials.$inferSelect;

export type NewMpMaterial = typeof mpMaterials.$inferInsert;

// 公众号图文草稿（articles 为图文消息数组，可多图文）
export const mpDraftStatusEnum = pgEnum('mp_draft_status', ['draft', 'published']);

export const mpDrafts = pgTable('mp_drafts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 草稿标题（内部标识，取首篇文章标题） */
  title: varchar('title', { length: 200 }).notNull(),
  /** 图文文章数组 */
  articles: jsonb('articles').$type<unknown[]>().notNull().default([]),
  /** 微信草稿 media_id（推送后回填） */
  wechatMediaId: varchar('wechat_media_id', { length: 128 }),
  status: mpDraftStatusEnum('status').notNull().default('draft'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_drafts_account_idx').on(t.accountId),
]);

export type MpDraftRow = typeof mpDrafts.$inferSelect;

export type NewMpDraft = typeof mpDrafts.$inferInsert;

// 公众号模板消息：模板库（与微信同步）
export const mpMessageTemplates = pgTable('mp_message_templates', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信模板 id */
  templateId: varchar('template_id', { length: 128 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content'),
  example: text('example'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_message_templates_account_tpl_uq').on(t.accountId, t.templateId),
]);

export type MpMessageTemplateRow = typeof mpMessageTemplates.$inferSelect;

export type NewMpMessageTemplate = typeof mpMessageTemplates.$inferInsert;

// 公众号模板消息发送记录（追加型）
export const mpTemplateSendStatusEnum = pgEnum('mp_template_send_status', ['success', 'failed']);

export const mpTemplateSendLogs = pgTable('mp_template_send_logs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  templateId: varchar('template_id', { length: 128 }).notNull(),
  openid: varchar('openid', { length: 64 }).notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  url: varchar('url', { length: 1000 }),
  status: mpTemplateSendStatusEnum('status').notNull().default('success'),
  errorMsg: text('error_msg'),
  /** 微信返回的 msgid */
  msgId: varchar('msg_id', { length: 64 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_template_send_logs_account_idx').on(t.accountId),
]);

export type MpTemplateSendLogRow = typeof mpTemplateSendLogs.$inferSelect;

export type NewMpTemplateSendLog = typeof mpTemplateSendLogs.$inferInsert;

// 公众号群发消息（按全部粉丝 / 按标签群发，支持文本 / 图片 / 图文）
export const mpBroadcastTypeEnum = pgEnum('mp_broadcast_type', ['text', 'image', 'mpnews']);

export const mpBroadcastTargetEnum = pgEnum('mp_broadcast_target', ['all', 'tag']);

export const mpBroadcastStatusEnum = pgEnum('mp_broadcast_status', ['draft', 'sent', 'failed']);

export const mpBroadcasts = pgTable('mp_broadcasts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  msgType: mpBroadcastTypeEnum('msg_type').notNull().default('text'),
  /** 群发对象：all=全部粉丝 tag=指定标签 */
  target: mpBroadcastTargetEnum('target').notNull().default('all'),
  /** 指定标签（target=tag 时），关联本地标签 id */
  tagId: integer('tag_id').references((): AnyPgColumn => mpTags.id, { onDelete: 'set null' }),
  /** 文本内容（msgType=text） */
  content: text('content'),
  /** 素材 media_id（msgType=image 用图片素材 / mpnews 用图文草稿） */
  mediaId: varchar('media_id', { length: 128 }),
  status: mpBroadcastStatusEnum('status').notNull().default('draft'),
  /** 微信返回的群发 msg_id（发送成功后回填） */
  wechatMsgId: varchar('wechat_msg_id', { length: 64 }),
  /** 定时群发时间（为空表示立即发送，由 mp-broadcast-tick 扫描到期发送） */
  scheduledAt: timestamp('scheduled_at'),
  errorMsg: text('error_msg'),
  sentAt: timestamp('sent_at'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_broadcasts_account_idx').on(t.accountId),
  index('mp_broadcasts_account_status_idx').on(t.accountId, t.status),
]);

export type MpBroadcastRow = typeof mpBroadcasts.$inferSelect;

export type NewMpBroadcast = typeof mpBroadcasts.$inferInsert;

// 公众号带参数二维码（临时 / 永久），扫码事件计数
export const mpQrcodeTypeEnum = pgEnum('mp_qrcode_type', ['temporary', 'permanent']);

export const mpQrcodes = pgTable('mp_qrcodes', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpQrcodeTypeEnum('type').notNull().default('permanent'),
  /** 场景值（字符串型 scene_str，用于渠道来源标识） */
  sceneStr: varchar('scene_str', { length: 64 }).notNull(),
  /** 备注名称 */
  name: varchar('name', { length: 100 }).notNull(),
  /** 微信返回的 ticket（换取二维码图片） */
  ticket: varchar('ticket', { length: 256 }),
  /** 二维码图片展示 URL */
  url: varchar('url', { length: 512 }),
  /** 有效期秒数（仅临时二维码） */
  expireSeconds: integer('expire_seconds'),
  /** 累计扫码次数（回调事件累加） */
  scanCount: integer('scan_count').notNull().default(0),
  /** 扫码关注奖励积分（粉丝已绑定会员时自动入账，0=不奖励） */
  rewardPoints: integer('reward_points').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('mp_qrcodes_account_idx').on(t.accountId),
  index('mp_qrcodes_account_scene_idx').on(t.accountId, t.sceneStr),
]);

export type MpQrcodeRow = typeof mpQrcodes.$inferSelect;

export type NewMpQrcode = typeof mpQrcodes.$inferInsert;

// 公众号多客服账号（与微信多客服 kf_account 对应）
export const mpKfAccounts = pgTable('mp_kf_accounts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信客服账号（形如 kf2001@gh_xxx） */
  kfAccount: varchar('kf_account', { length: 64 }).notNull(),
  nickname: varchar('nickname', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 512 }),
  /** 微信侧客服 id（kf_id） */
  kfId: varchar('kf_id', { length: 64 }),
  /** 绑定微信号邀请状态：none/inviting/bound */
  inviteStatus: varchar('invite_status', { length: 32 }).notNull().default('none'),
  /** 绑定的微信号 */
  inviteWx: varchar('invite_wx', { length: 64 }),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_kf_accounts_account_kf_uq').on(t.accountId, t.kfAccount),
  index('mp_kf_accounts_account_idx').on(t.accountId),
]);

export type MpKfAccountRow = typeof mpKfAccounts.$inferSelect;

export type NewMpKfAccount = typeof mpKfAccounts.$inferInsert;

// ─── 公众号多客服会话治理（实时状态机：接入/转接/超时自动路由/会话分配）──────────────
export const mpKfSessionStatusEnum = pgEnum('mp_kf_session_status', ['waiting', 'active', 'closed']);

export const mpKfSessionCloseReasonEnum = pgEnum('mp_kf_session_close_reason', ['manual', 'wait_timeout', 'idle_timeout', 'system']);

export const mpKfRoutingStrategyEnum = pgEnum('mp_kf_routing_strategy', ['manual', 'round_robin', 'least_active']);

export const mpKfSessionEventTypeEnum = pgEnum('mp_kf_session_event_type', ['create', 'assign', 'accept', 'transfer', 'reroute', 'close']);

// 多客服会话：一名粉丝（openid）与一个客服账号的一次会话，含排队(waiting)/进行(active)/结束(closed)状态机
export const mpKfSessions = pgTable('mp_kf_sessions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar('openid', { length: 64 }).notNull(),
  /** 当前承接的客服账号；waiting 时为 null */
  kfId: integer('kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  status: mpKfSessionStatusEnum('status').notNull().default('waiting'),
  /** 优先级（越大越靠前），超时未接入时自动提升 */
  priority: integer('priority').notNull().default(0),
  /** 会话来源（首条消息类型，如 text/event） */
  source: varchar('source', { length: 32 }),
  /** 未读（粉丝发来但客服未回复）条数 */
  unreadCount: integer('unread_count').notNull().default(0),
  lastFanMsgAt: timestamp('last_fan_msg_at'),
  lastKfMsgAt: timestamp('last_kf_msg_at'),
  lastMsgAt: timestamp('last_msg_at').defaultNow().notNull(),
  /** 进入排队的时间（用于等待超时计算） */
  waitingSince: timestamp('waiting_since'),
  acceptedAt: timestamp('accepted_at'),
  closedAt: timestamp('closed_at'),
  closeReason: mpKfSessionCloseReasonEnum('close_reason'),
  /** 满意度评分（1-5，结束后由粉丝/客服记录） */
  rating: integer('rating'),
  ratingRemark: varchar('rating_remark', { length: 255 }),
  remark: varchar('remark', { length: 255 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 同一公众号下，一个粉丝至多存在一个未结束会话
  uniqueIndex('mp_kf_sessions_open_uq').on(t.accountId, t.openid).where(sql`${t.status} <> 'closed'`),
  index('mp_kf_sessions_account_status_idx').on(t.accountId, t.status),
  index('mp_kf_sessions_kf_idx').on(t.kfId),
]);

export type MpKfSessionRow = typeof mpKfSessions.$inferSelect;

export type NewMpKfSession = typeof mpKfSessions.$inferInsert;

// 会话事件流水：创建/分配/接入/转接/重路由/结束，支撑时间线与转接历史审计
export const mpKfSessionEvents = pgTable('mp_kf_session_events', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references((): AnyPgColumn => mpKfSessions.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpKfSessionEventTypeEnum('type').notNull(),
  fromKfId: integer('from_kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  toKfId: integer('to_kf_id').references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  /** 操作人（人工操作时为后台用户；系统自动时为 null） */
  operatorId: integer('operator_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  detail: varchar('detail', { length: 255 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mp_kf_session_events_session_idx').on(t.sessionId),
]);

export type MpKfSessionEventRow = typeof mpKfSessionEvents.$inferSelect;

export type NewMpKfSessionEvent = typeof mpKfSessionEvents.$inferInsert;

// 多客服路由治理配置：每公众号一份，决定会话分配策略与超时阈值
export const mpKfRoutingConfigs = pgTable('mp_kf_routing_configs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 是否启用会话治理（关闭则回调不再建会话） */
  enabled: boolean('enabled').notNull().default(true),
  strategy: mpKfRoutingStrategyEnum('strategy').notNull().default('least_active'),
  /** 单客服最大并发会话数（容量上限） */
  maxConcurrent: integer('max_concurrent').notNull().default(5),
  /** 排队等待超时（分钟）：超时自动重新路由 */
  waitTimeoutMinutes: integer('wait_timeout_minutes').notNull().default(3),
  /** 会话空闲超时（分钟）：超时自动结束 */
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(15),
  autoCloseEnabled: boolean('auto_close_enabled').notNull().default(true),
  /** 接入后自动发送的欢迎语（可空） */
  welcomeText: varchar('welcome_text', { length: 500 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('mp_kf_routing_configs_account_uq').on(t.accountId),
]);

export type MpKfRoutingConfigRow = typeof mpKfRoutingConfigs.$inferSelect;

export type NewMpKfRoutingConfig = typeof mpKfRoutingConfigs.$inferInsert;
