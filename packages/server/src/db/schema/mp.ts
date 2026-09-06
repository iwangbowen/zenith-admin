import { pgTable, varchar, timestamp, pgEnum, integer, boolean, text, uniqueIndex, index, jsonb, smallint, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { members } from './member';

// ─── 公众号管理 ────────────────────────────────────────────────────────────────
// 微信公众号账号（多公众号 + 租户隔离）。子实体（粉丝/标签/消息/菜单/素材/图文等）
// 在后续阶段加入，均通过 account_id 外键挂到此表。
export const mpAccountTypeEnum = pgEnum('mp_account_type', ['subscribe', 'service', 'test']);

export const mpEncryptModeEnum = pgEnum('mp_encrypt_mode', ['plaintext', 'compatible', 'safe']);

export const mpAccounts = pgTable('mp_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 公众号名称 */
  name: varchar({ length: 100 }).notNull(),
  /** 微信号 / 原始 ID（gh_xxx） */
  account: varchar({ length: 100 }),
  /** 公众号 AppID（全局唯一） */
  appId: varchar({ length: 64 }).notNull().unique('mp_accounts_app_id_unique'),
  /** 公众号 AppSecret（响应中脱敏） */
  appSecret: varchar({ length: 128 }).notNull().default(''),
  /** 服务器配置 Token（回调签名校验用） */
  token: varchar({ length: 64 }).notNull().default(''),
  /** 消息加解密密钥（安全模式 / 兼容模式需要） */
  encodingAesKey: varchar({ length: 64 }),
  /** 消息加解密方式：明文 / 兼容 / 安全 */
  encryptMode: mpEncryptModeEnum().notNull().default('plaintext'),
  /** 账号类型：订阅号 / 服务号 / 测试号 */
  type: mpAccountTypeEnum().notNull().default('service'),
  /** 二维码图片地址 */
  qrCodeUrl: varchar({ length: 500 }),
  /** 是否默认公众号（同租户内唯一） */
  isDefault: boolean().notNull().default(false),
  /** 关注即注册会员：粉丝关注时自动创建并绑定会员 */
  autoCreateMember: boolean().notNull().default(false),
  /** 是否对群发/客服消息启用内容安全校验（msg_sec_check） */
  contentCheckEnabled: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  remark: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('mp_accounts_tenant_idx').on(t.tenantId),
]);

export type MpAccountRow = typeof mpAccounts.$inferSelect;

export type NewMpAccount = typeof mpAccounts.$inferInsert;

// 公众号粉丝标签（与微信标签同步；wechat_tag_id 同步后回填）
export const mpTags = pgTable('mp_tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信侧标签 id（从微信同步后回填，本地新建时为空） */
  wechatTagId: integer(),
  name: varchar({ length: 30 }).notNull(),
  /** 该标签下粉丝数（同步时更新） */
  fansCount: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_tags_tenant_idx').on(t.tenantId), 
  uniqueIndex('mp_tags_account_name_uq').on(t.accountId, t.name),
  index('mp_tags_account_idx').on(t.accountId),
]);

export type MpTagRow = typeof mpTags.$inferSelect;

export type NewMpTag = typeof mpTags.$inferInsert;

// 公众号粉丝（关注者；从微信同步，本地可备注/打标签）
export const mpFanSubscribeEnum = pgEnum('mp_fan_subscribe', ['subscribed', 'unsubscribed']);

export const mpFans = pgTable('mp_fans', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar({ length: 64 }).notNull(),
  nickname: varchar({ length: 128 }),
  avatar: varchar({ length: 512 }),
  /** 性别：0 未知 / 1 男 / 2 女 */
  sex: smallint().notNull().default(0),
  country: varchar({ length: 64 }),
  province: varchar({ length: 64 }),
  city: varchar({ length: 64 }),
  language: varchar({ length: 16 }),
  subscribe: mpFanSubscribeEnum().notNull().default('subscribed'),
  subscribeTime: timestamp({ withTimezone: true }),
  /** 本地备注 */
  remark: varchar({ length: 128 }),
  /** 本地标签 id 列表（指向 mp_tags.id） */
  tagIds: jsonb().$type<number[]>().notNull().default([]),
  /** 微信 unionid（账号绑定开放平台时可获取，用于跨应用打通会员） */
  unionid: varchar({ length: 64 }),
  /** 关联的会员 id（公众号粉丝 ↔ 会员体系打通） */
  memberId: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  /** 是否已加入黑名单（微信 batchblacklist） */
  blacklisted: boolean().notNull().default(false),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_fans_tenant_idx').on(t.tenantId), 
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar({ length: 64 }).notNull(),
  /** in=用户发来 out=客服回复 */
  direction: mpMessageDirectionEnum().notNull(),
  msgType: mpMessageTypeEnum().notNull().default('text'),
  /** 文本内容 / 链接地址 / 事件 EventKey */
  content: text(),
  /** 媒体素材 id（图片/语音/视频） */
  mediaId: varchar({ length: 128 }),
  /** 媒体 URL（图片 PicUrl 等） */
  mediaUrl: varchar({ length: 1000 }),
  /** 事件类型（msgType=event 时：subscribe/unsubscribe/CLICK/VIEW/SCAN…） */
  event: varchar({ length: 32 }),
  /** 微信消息 id（入站去重用） */
  msgId: varchar({ length: 64 }),
  status: mpMessageStatusEnum().notNull().default('received'),
  errorMsg: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('mp_messages_tenant_idx').on(t.tenantId), 
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  replyType: mpAutoReplyTypeEnum().notNull(),
  /** 关键词（仅 replyType=keyword） */
  keyword: varchar({ length: 64 }),
  /** 匹配方式（仅 keyword）：exact=全匹配 contain=包含 */
  matchType: mpAutoReplyMatchEnum().notNull().default('contain'),
  contentType: mpReplyContentTypeEnum().notNull().default('text'),
  /** 文本回复内容（也用于视频标题） */
  content: text(),
  /** 图片/语音/视频回复素材 id（contentType=image/voice/video） */
  mediaId: varchar({ length: 128 }),
  /** 图文回复文章列表（contentType=news） */
  newsArticles: jsonb().$type<{ title: string; description?: string; picUrl?: string; url: string }[]>(),
  /** 命中后是否转人工客服（接入多客服会话） */
  transferToKf: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  /** 关键词优先级（小在前） */
  sort: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_auto_replies_tenant_idx').on(t.tenantId), 
  index('mp_auto_replies_account_type_idx').on(t.accountId, t.replyType),
]);

export type MpAutoReplyRow = typeof mpAutoReplies.$inferSelect;

export type NewMpAutoReply = typeof mpAutoReplies.$inferInsert;

// 自动回复未命中关键词收集（用于优化关键词库；按 account+keyword 累计命中次数）
export const mpUnmatchedKeywords = pgTable('mp_unmatched_keywords', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  keyword: varchar({ length: 128 }).notNull(),
  count: integer().notNull().default(1),
  lastAt: timestamp().defaultNow().notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('mp_unmatched_keywords_tenant_idx').on(t.tenantId), 
  uniqueIndex('mp_unmatched_keywords_account_kw_uq').on(t.accountId, t.keyword),
]);

export type MpUnmatchedKeywordRow = typeof mpUnmatchedKeywords.$inferSelect;

export type NewMpUnmatchedKeyword = typeof mpUnmatchedKeywords.$inferInsert;

// 公众号自定义菜单（每账号一份，buttons 为微信菜单按钮树 JSON）
export const mpMenuStatusEnum = pgEnum('mp_menu_status', ['draft', 'published']);

export const mpMenus = pgTable('mp_menus', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().unique('mp_menus_account_id_unique').references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信菜单按钮树（最多 3 个一级，每个最多 5 个二级） */
  buttons: jsonb().$type<unknown[]>().notNull().default([]),
  status: mpMenuStatusEnum().notNull().default('draft'),
  publishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_menus_tenant_idx').on(t.tenantId)]);

export type MpMenuRow = typeof mpMenus.$inferSelect;

export type NewMpMenu = typeof mpMenus.$inferInsert;

// 个性化菜单（按标签/性别/地区等匹配规则向不同人群下发不同菜单）
export const mpConditionalMenus = pgTable('mp_conditional_menus', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 本地名称（便于管理识别） */
  name: varchar({ length: 64 }).notNull(),
  /** 菜单按钮树（结构同普通自定义菜单） */
  buttons: jsonb().$type<unknown[]>().notNull().default([]),
  /** 匹配规则：tag_id/sex/country/province/city/client_platform_type/language */
  matchRule: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** 微信返回的 menuid（发布后写入） */
  menuId: varchar({ length: 64 }),
  status: mpMenuStatusEnum().notNull().default('draft'),
  publishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_conditional_menus_tenant_idx').on(t.tenantId), 
  index('mp_conditional_menus_account_idx').on(t.accountId),
]);

export type MpConditionalMenuRow = typeof mpConditionalMenus.$inferSelect;

export type NewMpConditionalMenu = typeof mpConditionalMenus.$inferInsert;

// 公众号素材（图片 / 语音 / 视频 / 缩略图），本地登记 + 与微信永久素材同步
export const mpMaterialTypeEnum = pgEnum('mp_material_type', ['image', 'voice', 'video', 'thumb']);

export const mpMaterials = pgTable('mp_materials', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpMaterialTypeEnum().notNull().default('image'),
  name: varchar({ length: 200 }).notNull(),
  /** 微信永久素材 media_id（同步 / 推送后回填） */
  wechatMediaId: varchar({ length: 128 }),
  /** 素材 URL（图片可直接预览） */
  url: varchar({ length: 1000 }),
  /** 文件大小（字节） */
  fileSize: integer(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_materials_tenant_idx').on(t.tenantId), 
  index('mp_materials_account_type_idx').on(t.accountId, t.type),
  // 同步 upsert 的冲突目标：微信 media_id 在同一公众号内唯一（本地上传未回填时为 null，故用部分索引）
  uniqueIndex('mp_materials_account_media_uq').on(t.accountId, t.wechatMediaId).where(sql`${t.wechatMediaId} is not null`),
]);

export type MpMaterialRow = typeof mpMaterials.$inferSelect;

export type NewMpMaterial = typeof mpMaterials.$inferInsert;

// 公众号图文草稿（articles 为图文消息数组，可多图文）
export const mpDraftStatusEnum = pgEnum('mp_draft_status', ['draft', 'published']);

export const mpDrafts = pgTable('mp_drafts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 草稿标题（内部标识，取首篇文章标题） */
  title: varchar({ length: 200 }).notNull(),
  /** 图文文章数组 */
  articles: jsonb().$type<unknown[]>().notNull().default([]),
  /** 微信草稿 media_id（推送后回填） */
  wechatMediaId: varchar({ length: 128 }),
  status: mpDraftStatusEnum().notNull().default('draft'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_drafts_tenant_idx').on(t.tenantId), 
  index('mp_drafts_account_idx').on(t.accountId),
]);

export type MpDraftRow = typeof mpDrafts.$inferSelect;

export type NewMpDraft = typeof mpDrafts.$inferInsert;

// 公众号模板消息：模板库（与微信同步）
export const mpMessageTemplates = pgTable('mp_message_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信模板 id */
  templateId: varchar({ length: 128 }).notNull(),
  title: varchar({ length: 200 }).notNull(),
  content: text(),
  example: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_message_templates_tenant_idx').on(t.tenantId), 
  uniqueIndex('mp_message_templates_account_tpl_uq').on(t.accountId, t.templateId),
]);

export type MpMessageTemplateRow = typeof mpMessageTemplates.$inferSelect;

export type NewMpMessageTemplate = typeof mpMessageTemplates.$inferInsert;

// 公众号模板消息发送记录（追加型）
export const mpTemplateSendStatusEnum = pgEnum('mp_template_send_status', ['success', 'failed']);

export const mpTemplateSendLogs = pgTable('mp_template_send_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  templateId: varchar({ length: 128 }).notNull(),
  openid: varchar({ length: 64 }).notNull(),
  data: jsonb().$type<Record<string, unknown>>(),
  url: varchar({ length: 1000 }),
  status: mpTemplateSendStatusEnum().notNull().default('success'),
  errorMsg: text(),
  /** 微信返回的 msgid */
  msgId: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('mp_template_send_logs_tenant_idx').on(t.tenantId), 
  index('mp_template_send_logs_account_idx').on(t.accountId),
]);

export type MpTemplateSendLogRow = typeof mpTemplateSendLogs.$inferSelect;

export type NewMpTemplateSendLog = typeof mpTemplateSendLogs.$inferInsert;

// 公众号群发消息（按全部粉丝 / 按标签群发，支持文本 / 图片 / 图文）
export const mpBroadcastTypeEnum = pgEnum('mp_broadcast_type', ['text', 'image', 'mpnews']);

export const mpBroadcastTargetEnum = pgEnum('mp_broadcast_target', ['all', 'tag']);

export const mpBroadcastStatusEnum = pgEnum('mp_broadcast_status', ['draft', 'sent', 'failed']);

export const mpBroadcasts = pgTable('mp_broadcasts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  msgType: mpBroadcastTypeEnum().notNull().default('text'),
  /** 群发对象：all=全部粉丝 tag=指定标签 */
  target: mpBroadcastTargetEnum().notNull().default('all'),
  /** 指定标签（target=tag 时），关联本地标签 id */
  tagId: integer().references((): AnyPgColumn => mpTags.id, { onDelete: 'set null' }),
  /** 文本内容（msgType=text） */
  content: text(),
  /** 素材 media_id（msgType=image 用图片素材 / mpnews 用图文草稿） */
  mediaId: varchar({ length: 128 }),
  status: mpBroadcastStatusEnum().notNull().default('draft'),
  /** 微信返回的群发 msg_id（发送成功后回填） */
  wechatMsgId: varchar({ length: 64 }),
  /** 定时群发时间（为空表示立即发送，由 mp-broadcast-tick 扫描到期发送） */
  scheduledAt: timestamp(),
  errorMsg: text(),
  sentAt: timestamp(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_broadcasts_tenant_idx').on(t.tenantId), 
  index('mp_broadcasts_account_idx').on(t.accountId),
  index('mp_broadcasts_account_status_idx').on(t.accountId, t.status),
]);

export type MpBroadcastRow = typeof mpBroadcasts.$inferSelect;

export type NewMpBroadcast = typeof mpBroadcasts.$inferInsert;

// 公众号带参数二维码（临时 / 永久），扫码事件计数
export const mpQrcodeTypeEnum = pgEnum('mp_qrcode_type', ['temporary', 'permanent']);

export const mpQrcodes = pgTable('mp_qrcodes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpQrcodeTypeEnum().notNull().default('permanent'),
  /** 场景值（字符串型 scene_str，用于渠道来源标识） */
  sceneStr: varchar({ length: 64 }).notNull(),
  /** 备注名称 */
  name: varchar({ length: 100 }).notNull(),
  /** 微信返回的 ticket（换取二维码图片） */
  ticket: varchar({ length: 256 }),
  /** 二维码图片展示 URL */
  url: varchar({ length: 512 }),
  /** 有效期秒数（仅临时二维码） */
  expireSeconds: integer(),
  /** 累计扫码次数（回调事件累加） */
  scanCount: integer().notNull().default(0),
  /** 扫码关注奖励积分（粉丝已绑定会员时自动入账，0=不奖励） */
  rewardPoints: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_qrcodes_tenant_idx').on(t.tenantId), 
  index('mp_qrcodes_account_idx').on(t.accountId),
  index('mp_qrcodes_account_scene_idx').on(t.accountId, t.sceneStr),
]);

export type MpQrcodeRow = typeof mpQrcodes.$inferSelect;

export type NewMpQrcode = typeof mpQrcodes.$inferInsert;

// 公众号多客服账号（与微信多客服 kf_account 对应）
export const mpKfAccounts = pgTable('mp_kf_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 微信客服账号（形如 kf2001@gh_xxx） */
  kfAccount: varchar({ length: 64 }).notNull(),
  nickname: varchar({ length: 64 }).notNull(),
  avatar: varchar({ length: 512 }),
  /** 微信侧客服 id（kf_id） */
  kfId: varchar({ length: 64 }),
  /** 绑定微信号邀请状态：none/inviting/bound */
  inviteStatus: varchar({ length: 32 }).notNull().default('none'),
  /** 绑定的微信号 */
  inviteWx: varchar({ length: 64 }),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_kf_accounts_tenant_idx').on(t.tenantId), 
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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  openid: varchar({ length: 64 }).notNull(),
  /** 当前承接的客服账号；waiting 时为 null */
  kfId: integer().references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  status: mpKfSessionStatusEnum().notNull().default('waiting'),
  /** 优先级（越大越靠前），超时未接入时自动提升 */
  priority: integer().notNull().default(0),
  /** 会话来源（首条消息类型，如 text/event） */
  source: varchar({ length: 32 }),
  /** 未读（粉丝发来但客服未回复）条数 */
  unreadCount: integer().notNull().default(0),
  lastFanMsgAt: timestamp(),
  lastKfMsgAt: timestamp(),
  lastMsgAt: timestamp().defaultNow().notNull(),
  /** 进入排队的时间（用于等待超时计算） */
  waitingSince: timestamp(),
  acceptedAt: timestamp(),
  closedAt: timestamp(),
  closeReason: mpKfSessionCloseReasonEnum(),
  /** 满意度评分（1-5，结束后由粉丝/客服记录） */
  rating: integer(),
  ratingRemark: varchar({ length: 255 }),
  remark: varchar({ length: 255 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_kf_sessions_tenant_idx').on(t.tenantId), 
  // 同一公众号下，一个粉丝至多存在一个未结束会话
  uniqueIndex('mp_kf_sessions_open_uq').on(t.accountId, t.openid).where(sql`${t.status} <> 'closed'`),
  index('mp_kf_sessions_account_status_idx').on(t.accountId, t.status),
  index('mp_kf_sessions_kf_idx').on(t.kfId),
]);

export type MpKfSessionRow = typeof mpKfSessions.$inferSelect;

export type NewMpKfSession = typeof mpKfSessions.$inferInsert;

// 会话事件流水：创建/分配/接入/转接/重路由/结束，支撑时间线与转接历史审计
export const mpKfSessionEvents = pgTable('mp_kf_session_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer().notNull().references((): AnyPgColumn => mpKfSessions.id, { onDelete: 'cascade' }),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  type: mpKfSessionEventTypeEnum().notNull(),
  fromKfId: integer().references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  toKfId: integer().references((): AnyPgColumn => mpKfAccounts.id, { onDelete: 'set null' }),
  /** 操作人（人工操作时为后台用户；系统自动时为 null） */
  operatorId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  detail: varchar({ length: 255 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('mp_kf_session_events_operator_idx').on(t.operatorId), index('mp_kf_session_events_tenant_idx').on(t.tenantId), 
  index('mp_kf_session_events_session_idx').on(t.sessionId),
]);

export type MpKfSessionEventRow = typeof mpKfSessionEvents.$inferSelect;

export type NewMpKfSessionEvent = typeof mpKfSessionEvents.$inferInsert;

// 多客服路由治理配置：每公众号一份，决定会话分配策略与超时阈值
export const mpKfRoutingConfigs = pgTable('mp_kf_routing_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer().notNull().references((): AnyPgColumn => mpAccounts.id, { onDelete: 'cascade' }),
  /** 是否启用会话治理（关闭则回调不再建会话） */
  enabled: boolean().notNull().default(true),
  strategy: mpKfRoutingStrategyEnum().notNull().default('least_active'),
  /** 单客服最大并发会话数（容量上限） */
  maxConcurrent: integer().notNull().default(5),
  /** 排队等待超时（分钟）：超时自动重新路由 */
  waitTimeoutMinutes: integer().notNull().default(3),
  /** 会话空闲超时（分钟）：超时自动结束 */
  idleTimeoutMinutes: integer().notNull().default(15),
  autoCloseEnabled: boolean().notNull().default(true),
  /** 接入后自动发送的欢迎语（可空） */
  welcomeText: varchar({ length: 500 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('mp_kf_routing_configs_tenant_idx').on(t.tenantId), 
  uniqueIndex('mp_kf_routing_configs_account_uq').on(t.accountId),
]);

export type MpKfRoutingConfigRow = typeof mpKfRoutingConfigs.$inferSelect;

export type NewMpKfRoutingConfig = typeof mpKfRoutingConfigs.$inferInsert;
