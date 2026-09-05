import * as z from 'zod';
import { dateTimeStringSchema, optionalLinkUrl, partialForUpdate } from '../core/validation';
import { MP_CUSTOM_MSG_TYPES } from '../mp/constants';
import {
  ANNOUNCEMENT_PUBLISH_STATUSES,
  ANNOUNCEMENT_RECIPIENT_TYPES,
  ANNOUNCEMENT_TARGET_TYPES,
  BROADCAST_AUDIENCE_TYPES,
  BROADCAST_CHANNELS,
  CHANNEL_AUTO_REPLY_KEYWORD_MODES,
  CHANNEL_AUTO_REPLY_MATCH_TYPES,
  CHANNEL_PUBLISH_AUDIENCE_MODES,
  EMAIL_ENCRYPTIONS,
  IN_APP_MESSAGE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DIGEST_MODES,
  PUSH_PROVIDERS,
  SMS_PROVIDERS,
} from './constants';

// ─── 公告 Schema ─────────────────────────────────────────────────────────────
export const announcementRecipientInputSchema = z.object({
  recipientType: z.enum(ANNOUNCEMENT_RECIPIENT_TYPES),
  recipientId: z.number().int().positive(),
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128),
  content: z.string().min(1, '内容不能为空').max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(ANNOUNCEMENT_PUBLISH_STATUSES).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(ANNOUNCEMENT_TARGET_TYPES).default('all'),
  recipients: z.array(announcementRecipientInputSchema).default([]),
  publishTime: dateTimeStringSchema.optional().nullable(),
  fileIds: z.array(z.uuid()).default([]),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128).optional(),
  content: z.string().min(1, '内容不能为空').max(4096).optional(),
  type: z.string().min(1).max(32).optional(),
  publishStatus: z.enum(ANNOUNCEMENT_PUBLISH_STATUSES).optional(),
  priority: z.string().min(1).max(32).optional(),
  targetType: z.enum(ANNOUNCEMENT_TARGET_TYPES).optional(),
  recipients: z.array(announcementRecipientInputSchema).optional(),
  publishTime: dateTimeStringSchema.optional().nullable(),
  fileIds: z.array(z.uuid()).optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

export type AnnouncementRecipientInput = z.infer<typeof announcementRecipientInputSchema>;

// ─── 邮件配置 Schema（单例配置整体保存） ──────────────────────────────────────
export const saveEmailConfigSchema = z.object({
  smtpHost: z.string().min(1, 'SMTP 服务器地址不能为空').max(128).optional(),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpUser: z.string().min(1, 'SMTP 用户名不能为空').max(128).optional(),
  smtpPassword: z.string().max(256).optional(),
  fromName: z.string().max(64).default('Zenith Admin'),
  fromEmail: z.string().max(128).optional(),
  encryption: z.enum(EMAIL_ENCRYPTIONS).default('ssl'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export type SaveEmailConfigInput = z.infer<typeof saveEmailConfigSchema>;

/** 发送测试邮件（邮件配置页「测试连接」） */
export const testEmailConfigSchema = z.object({
  email: z.string(),
});

export type TestEmailConfigInput = z.infer<typeof testEmailConfigSchema>;

// ─── 通知模块（邮件 / 短信 / 站内信）─────────────────────────────────────────

// ── 邮件模板 ────────────────────────────────────────────────────────────────
export const createEmailTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  subject: z.string().min(1, '邮件主题不能为空').max(200),
  content: z.string().min(1, '邮件内容不能为空'),
  variables: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updateEmailTemplateSchema = partialForUpdate(createEmailTemplateSchema);

export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;

export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

// ── 邮件发送（手动 / 测试）─────────────────────────────────────────────────
export const sendEmailSchema = z.object({
  templateId: z.number().int().positive().optional(),
  toEmail: z.email('邮箱格式不正确'),
  subject: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ── 短信服务商配置 ──────────────────────────────────────────────────────────
export const createSmsConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(100),
  provider: z.enum(SMS_PROVIDERS, { error: '请选择短信服务商' }),
  accessKeyId: z.string().min(1, 'AccessKeyId 不能为空').max(256),
  accessKeySecret: z.string().min(1, 'AccessKeySecret 不能为空').max(512),
  region: z.string().max(64).optional(),
  signName: z.string().min(1, '签名不能为空').max(64),
  isDefault: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updateSmsConfigSchema = partialForUpdate(createSmsConfigSchema).extend({
  accessKeySecret: z.string().max(512).optional(), // 更新时允许不传（保持原值）
});

export type CreateSmsConfigInput = z.infer<typeof createSmsConfigSchema>;

export type UpdateSmsConfigInput = z.infer<typeof updateSmsConfigSchema>;

// ── 短信模板 ────────────────────────────────────────────────────────────────
export const createSmsTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  templateCode: z.string().min(1, '厂商模板ID不能为空').max(100),
  signName: z.string().max(64).optional(),
  content: z.string().min(1, '模板内容不能为空'),
  variables: z.string().optional(),
  provider: z.enum(SMS_PROVIDERS, { error: '请选择适用服务商' }),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updateSmsTemplateSchema = partialForUpdate(createSmsTemplateSchema);

export type CreateSmsTemplateInput = z.infer<typeof createSmsTemplateSchema>;

export type UpdateSmsTemplateInput = z.infer<typeof updateSmsTemplateSchema>;

// ── 短信发送（手动 / 测试）─────────────────────────────────────────────────
export const sendSmsSchema = z.object({
  templateId: z.number().int().positive(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
  variables: z.record(z.string(), z.string()).optional(),
});

export type SendSmsInput = z.infer<typeof sendSmsSchema>;

// ── 站内信模板 ──────────────────────────────────────────────────────────────
export const createInAppTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  code: z.string().min(1, '模板编码不能为空').max(100).regex(/^[a-zA-Z]\w*$/, '编码只能包含字母、数字和下划线，且以字母开头'),
  title: z.string().min(1, '标题不能为空').max(200),
  content: z.string().min(1, '内容不能为空'),
  type: z.enum(IN_APP_MESSAGE_TYPES).default('info'),
  variables: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updateInAppTemplateSchema = partialForUpdate(createInAppTemplateSchema);

export type CreateInAppTemplateInput = z.infer<typeof createInAppTemplateSchema>;

export type UpdateInAppTemplateInput = z.infer<typeof updateInAppTemplateSchema>;

// ── 站内信发送 ──────────────────────────────────────────────────────────────
export const sendInAppSchema = z.object({
  templateId: z.number().int().positive().optional(),
  userIds: z.array(z.number().int().positive()).min(1, '至少选择一名收件人'),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(IN_APP_MESSAGE_TYPES).default('info'),
  variables: z.record(z.string(), z.string()).optional(),
});

export type SendInAppInput = z.infer<typeof sendInAppSchema>;

// ─── Channel（站内公众号）管理 ────────────────────────────────────────────────
export const createChannelSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'code 只能包含小写字母、数字和连字符'),
  name: z.string().min(1).max(64),
  avatar: z.string().max(256).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  avatar: z.string().max(256).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/** 群发受众范围定义（mode=all 时其余字段忽略） */
export const channelPublishAudienceSchema = z.object({
  mode: z.enum(CHANNEL_PUBLISH_AUDIENCE_MODES).default('all'),
  userIds: z.array(z.number().int().positive()).optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

export type ChannelPublishAudienceInput = z.infer<typeof channelPublishAudienceSchema>;

/** 用户向运营号发送一条消息 */
export const sendChannelMessageSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(2000),
});

export type SendChannelMessageInput = z.infer<typeof sendChannelMessageSchema>;

/** 客服回复用户 */
export const channelReplySchema = z.object({
  content: z.string().min(1, '回复内容不能为空').max(2000),
});

export type ChannelReplyInput = z.infer<typeof channelReplySchema>;

/** 富内容自动回复扩展（image: imageUrl；news: title/cover/summary/linkUrl） */
const channelRichReplyExtraSchema = z.object({
  imageUrl: optionalLinkUrl().max(1000).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  cover: optionalLinkUrl().max(1000).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
  linkUrl: optionalLinkUrl().max(1000).nullable().optional(),
  bodyHtml: z.string().max(200000).nullable().optional(),
});

/** 新建频道自动回复规则 */
export const createChannelAutoReplySchema = z
  .object({
    matchType: z.enum(CHANNEL_AUTO_REPLY_MATCH_TYPES),
    keyword: z.string().max(100).nullable().optional(),
    keywordMode: z.enum(CHANNEL_AUTO_REPLY_KEYWORD_MODES).default('contains'),
    replyType: z.enum(['text', 'image', 'news']).default('text'),
    replyContent: z.string().max(10000).default(''),
    replyExtra: channelRichReplyExtraSchema.nullable().optional(),
    status: z.enum(['enabled', 'disabled']).default('enabled'),
    sort: z.number().int().min(0).default(0),
  })
  .refine((v) => v.matchType !== 'keyword' || (v.keyword != null && v.keyword.trim().length > 0), {
    message: '关键词回复必须填写关键词',
    path: ['keyword'],
  })
  .refine((v) => v.replyType !== 'text' || v.replyContent.trim().length > 0, {
    message: '文本回复内容不能为空',
    path: ['replyContent'],
  })
  .refine((v) => v.replyType !== 'image' || (v.replyExtra?.imageUrl?.trim().length ?? 0) > 0, {
    message: '图片回复必须上传图片',
    path: ['replyExtra', 'imageUrl'],
  })
  .refine((v) => v.replyType !== 'news' || (v.replyExtra?.title?.trim().length ?? 0) > 0, {
    message: '图文回复必须填写标题',
    path: ['replyExtra', 'title'],
  });

export type CreateChannelAutoReplyInput = z.infer<typeof createChannelAutoReplySchema>;

/** 更新频道自动回复规则 */
export const updateChannelAutoReplySchema = z
  .object({
    keyword: z.string().max(100).nullable().optional(),
    keywordMode: z.enum(CHANNEL_AUTO_REPLY_KEYWORD_MODES).optional(),
    replyType: z.enum(['text', 'image', 'news']).optional(),
    replyContent: z.string().max(10000).optional(),
    replyExtra: channelRichReplyExtraSchema.nullable().optional(),
    status: z.enum(['enabled', 'disabled']).optional(),
    sort: z.number().int().min(0).optional(),
  });

export type UpdateChannelAutoReplyInput = z.infer<typeof updateChannelAutoReplySchema>;

/** 新建客服快捷回复（channelId 为 null = 全局，所有运营号通用） */
export const createChannelQuickReplySchema = z.object({
  channelId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1, '标题不能为空').max(100),
  content: z.string().min(1, '内容不能为空').max(2000),
  sort: z.number().int().min(0).default(0),
});

export type CreateChannelQuickReplyInput = z.infer<typeof createChannelQuickReplySchema>;

/** 更新客服快捷回复 */
export const updateChannelQuickReplySchema = partialForUpdate(createChannelQuickReplySchema);

export type UpdateChannelQuickReplyInput = z.infer<typeof updateChannelQuickReplySchema>;

/** 新建群发消息模板 */
export const createChannelTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  type: z.enum(['text', 'image', 'news']).default('text'),
  title: z.string().max(200).nullable().optional(),
  content: z.string().max(10000).default(''),
  extra: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CreateChannelTemplateInput = z.infer<typeof createChannelTemplateSchema>;

/** 更新群发消息模板 */
export const updateChannelTemplateSchema = partialForUpdate(createChannelTemplateSchema);

export type UpdateChannelTemplateInput = z.infer<typeof updateChannelTemplateSchema>;

export const sendAiMessageSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(8192),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

export const sendMpMessageSchema = z.object({
  accountId: z.number().int().positive(),
  openid: z.string().min(1, '请选择粉丝').max(64),
  msgType: z.enum(MP_CUSTOM_MSG_TYPES).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
})
  .refine((d) => d.msgType !== 'text' || !!d.content, { message: '消息内容不能为空', path: ['content'] })
  .refine((d) => d.msgType === 'text' || !!d.mediaId, { message: '请选择素材', path: ['mediaId'] });

export type SendMpMessageInput = z.infer<typeof sendMpMessageSchema>;

// 公众号模板消息发送
export const sendMpTemplateSchema = z.object({
  accountId: z.number().int().positive(),
  templateId: z.string().min(1, '请选择模板').max(128),
  openid: z.string().min(1, '请选择粉丝').max(64),
  url: optionalLinkUrl().max(1000).optional(),
  data: z.record(z.string(), z.object({ value: z.string(), color: z.string().optional() })),
});

export type SendMpTemplateInput = z.infer<typeof sendMpTemplateSchema>;

export const batchSendMpTemplateSchema = z.object({
  accountId: z.number().int().positive(),
  templateId: z.string().min(1, '请选择模板').max(128),
  openids: z.array(z.string().min(1)).min(1, '请选择粉丝').max(500, '单次最多 500 个'),
  url: optionalLinkUrl().max(1000).optional(),
  data: z.record(z.string(), z.object({ value: z.string(), color: z.string().optional() })),
});

export type BatchSendMpTemplateInput = z.infer<typeof batchSendMpTemplateSchema>;

// ─── 通知中心（Notification Center）─────────────────────────────────────────
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm');

export const saveNotificationPreferenceItemSchema = z.object({
  eventKey: z.string().min(1).max(100),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export const saveNotificationPreferencesSchema = z.object({
  items: z.array(saveNotificationPreferenceItemSchema).min(1, '至少提交一项变更').max(500),
});

export const saveNotificationSettingsSchema = z.object({
  globalMuted: z.boolean(),
  timezone: z.string().min(1).max(64),
  quietStart: clockSchema.nullable(),
  quietEnd: clockSchema.nullable(),
  digestMode: z.enum(NOTIFICATION_DIGEST_MODES),
  digestHour: z.number().int().min(0).max(23),
}).refine(
  (v) => (v.quietStart === null) === (v.quietEnd === null),
  { message: '免打扰起止时间需同时设置或同时留空', path: ['quietEnd'] },
).refine(
  (v) => v.quietStart === null || v.quietStart !== v.quietEnd,
  { message: '免打扰起止时间不能相同', path: ['quietEnd'] },
);

export const saveNotificationOverrideSchema = z.object({
  eventKey: z.string().min(1).max(100),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
  locked: z.boolean().default(false),
});

export const resetNotificationOverrideSchema = z.object({
  eventKey: z.string().min(1).max(100),
  channel: z.enum(NOTIFICATION_CHANNELS),
});

export type SaveNotificationPreferenceItem = z.infer<typeof saveNotificationPreferenceItemSchema>;
export type SaveNotificationPreferencesInput = z.infer<typeof saveNotificationPreferencesSchema>;
export type SaveNotificationSettingsInput = z.infer<typeof saveNotificationSettingsSchema>;
export type SaveNotificationOverrideInput = z.infer<typeof saveNotificationOverrideSchema>;
export type ResetNotificationOverrideInput = z.infer<typeof resetNotificationOverrideSchema>;

// ── App 推送配置 ─────────────────────────────────────────────────────────────
export const createPushConfigSchema = z.object({
  /** 凭证一对一挂应用（供应商侧凭证按 App 发放） */
  appId: z.number().int().positive({ message: '请选择所属应用' }),
  name: z.string().min(1, '配置名称不能为空').max(100),
  provider: z.enum(PUSH_PROVIDERS).default('jpush'),
  appKey: z.string().min(1, 'AppKey 不能为空').max(128),
  masterSecret: z.string().min(1, 'MasterSecret 不能为空').max(256),
  apnsProduction: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});

export const updatePushConfigSchema = partialForUpdate(createPushConfigSchema).extend({
  masterSecret: z.string().max(256).optional(), // 更新时允许不传（保持原值）
});

export type CreatePushConfigInput = z.infer<typeof createPushConfigSchema>;

export type UpdatePushConfigInput = z.infer<typeof updatePushConfigSchema>;

/** 测试发送:直发 registrationId,不依赖设备登记 */
export const testPushSendSchema = z.object({
  registrationId: z.string().min(1, 'RegistrationID 不能为空').max(128),
  title: z.string().max(200).default('Zenith 推送测试'),
  content: z.string().max(1000).default('这是一条测试推送,收到说明通道配置正确'),
});

export type TestPushSendInput = z.infer<typeof testPushSendSchema>;

// ── App 推送送达回执（供应商回调，公开）──────────────────────────────────────
/** 极光单条回执事件：type 兼容字符串与数字编码（received/0=送达，click/opened/1=点击） */
export const jpushReceiptEventSchema = z.looseObject({
  msg_id: z.union([z.string(), z.number()]),
  type: z.union([z.string(), z.number()]).optional(),
  registration_id: z.string().optional(),
  /** 事件发生时间（秒级时间戳） */
  itime: z.number().optional(),
});

export type JPushReceiptEvent = z.infer<typeof jpushReceiptEventSchema>;

/** 极光回调报文：data 支持单事件或事件数组 */
export const jpushCallbackSchema = z.object({
  appKey: z.string().optional(),
  token: z.string().optional(),
  data: z.union([jpushReceiptEventSchema, z.array(jpushReceiptEventSchema)]),
}).meta({ id: 'JPushCallbackBody' });

export type JPushCallbackInput = z.infer<typeof jpushCallbackSchema>;

/** 通知策略页「测试触发」:真实走一遍 notify(),收件人为当前管理员 */
export const testFireNotificationSchema = z.object({
  eventKey: z.string().min(1).max(128),
});

export type TestFireNotificationInput = z.infer<typeof testFireNotificationSchema>;

// ─── 运营群发 Schema ──────────────────────────────────────────────────────────

export const createBroadcastSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  content: z.string().min(1, '内容不能为空').max(2000),
  link: z.string().max(500).optional().nullable(),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1, '至少选择一个投递渠道'),
  audienceType: z.enum(BROADCAST_AUDIENCE_TYPES),
  audienceIds: z.array(z.number().int().positive()).max(10000).default([]),
  remark: z.string().max(500).optional().nullable(),
}).superRefine((val, ctx) => {
  if ((val.audienceType === 'user_ids' || val.audienceType === 'member_ids') && val.audienceIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audienceIds'], message: '指定名单时至少填写一个 ID' });
  }
});

export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const updateBroadcastSchema = createBroadcastSchema;
export type UpdateBroadcastInput = z.infer<typeof updateBroadcastSchema>;
