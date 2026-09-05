import * as z from 'zod';
import { lazyRecursive, partialForUpdate } from '../core/validation';
import { channelPublishAudienceSchema } from '../messaging/validation';
import {
  MP_ACCOUNT_TYPES,
  MP_AUTO_REPLY_MATCH_TYPES,
  MP_AUTO_REPLY_TYPES,
  MP_BROADCAST_TARGETS,
  MP_BROADCAST_TYPES,
  MP_ENCRYPT_MODES,
  MP_KF_ROUTING_STRATEGIES,
  MP_MATERIAL_TYPES,
  MP_QRCODE_TYPES,
  MP_REPLY_CONTENT_TYPES,
} from './constants';
import type { MpMenuButton } from './types';

/** 管理端群发（文本 / 图片 / 图文 + 受众 + 立即/定时/草稿） */
export const publishChannelSchema = z
  .object({
    type: z.enum(['text', 'image', 'news']).default('text'),
    title: z.string().max(200).nullable().optional(),
    content: z.string().max(10000).default(''),
    /** 图文正文富文本 HTML（服务端净化后随卡片投递） */
    bodyHtml: z.string().max(200000).nullable().optional(),
    imageUrl: z.string().max(1000).nullable().optional(),
    cover: z.string().max(1000).nullable().optional(),
    summary: z.string().max(500).nullable().optional(),
    linkUrl: z.string().max(1000).nullable().optional(),
    audience: channelPublishAudienceSchema.default({ mode: 'all' }),
    sendMode: z.enum(['now', 'scheduled', 'draft']).default('now'),
    scheduledAt: z.string().max(32).nullable().optional(),
  })
  .refine((v) => v.type !== 'text' || v.content.trim().length > 0, { message: '文本内容不能为空', path: ['content'] })
  .refine((v) => v.type !== 'image' || (v.imageUrl?.trim().length ?? 0) > 0, { message: '请上传图片', path: ['imageUrl'] })
  .refine((v) => v.type !== 'news' || (v.title?.trim().length ?? 0) > 0, { message: '图文消息必须填写标题', path: ['title'] })
  .refine((v) => v.sendMode !== 'scheduled' || (v.scheduledAt?.trim().length ?? 0) > 0, { message: '定时发送必须选择发送时间', path: ['scheduledAt'] })
  .refine((v) => v.audience.mode !== 'users' || (v.audience.userIds?.length ?? 0) > 0, { message: '请选择目标用户', path: ['audience', 'userIds'] })
  .refine((v) => v.audience.mode !== 'departments' || (v.audience.departmentIds?.length ?? 0) > 0, { message: '请选择目标部门', path: ['audience', 'departmentIds'] })
  .refine((v) => v.audience.mode !== 'roles' || (v.audience.roleIds?.length ?? 0) > 0, { message: '请选择目标角色', path: ['audience', 'roleIds'] });


export type PublishChannelInput = z.infer<typeof publishChannelSchema>;


/** 公众号底部菜单 —— 单个菜单节点 */
const channelMenuNodeSchema = z.object({
  name: z.string().min(1, '菜单名称不能为空').max(32),
  type: z.enum(['click', 'view']).default('click'),
  value: z.string().max(500).nullable().optional(),
  children: z
    .array(
      z.object({
        name: z.string().min(1, '子菜单名称不能为空').max(32),
        type: z.enum(['click', 'view']).default('click'),
        value: z.string().max(500).nullable().optional(),
      }),
    )
    .max(5, '每个一级菜单最多 5 个子菜单')
    .optional(),
});


/** 批量保存公众号底部菜单（整体替换） */
export const saveChannelMenusSchema = z.object({
  menus: z.array(channelMenuNodeSchema).max(3, '最多 3 个一级菜单'),
});


export type SaveChannelMenusInput = z.infer<typeof saveChannelMenusSchema>;


/** 指派 / 转接会话（assigneeId 为 null = 取消指派） */
export const assignConversationSchema = z.object({
  assigneeId: z.number().int().positive().nullable(),
});


export type AssignConversationInput = z.infer<typeof assignConversationSchema>;


/** 设置会话标签（整体替换） */
export const setConversationTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(20)).max(10, '最多 10 个标签'),
});


export type SetConversationTagsInput = z.infer<typeof setConversationTagsSchema>;


/** 群发受众预估请求（复用群发受众定义） */
export const audienceEstimateSchema = z.object({
  audience: channelPublishAudienceSchema,
});


export type AudienceEstimateInput = z.infer<typeof audienceEstimateSchema>;


/** 添加订阅者（运营号批量加订阅用户） */
export const addChannelSubscribersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '请选择用户'),
});


export type AddChannelSubscribersInput = z.infer<typeof addChannelSubscribersSchema>;


/** 用户对客服会话评价 */
export const rateConversationSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).nullable().optional(),
});


export type RateConversationInput = z.infer<typeof rateConversationSchema>;


// ─── 公众号管理 ────────────────────────────────────────────────────────────────
/** 仅携带所属公众号的请求体（同步 / 菜单发布等按账号触发的操作） */
export const mpAccountIdBody = z.object({
  accountId: z.number().int().positive(),
});


export type MpAccountIdInput = z.infer<typeof mpAccountIdBody>;


export const createMpAccountSchema = z.object({
  name: z.string().min(1, '公众号名称不能为空').max(100),
  account: z.string().max(100).optional(),
  appId: z.string().min(1, 'AppID 不能为空').max(64),
  appSecret: z.string().min(1, 'AppSecret 不能为空').max(128),
  token: z.string().min(1, 'Token 不能为空').max(64).regex(/^[A-Za-z0-9]+$/, 'Token 只能包含字母和数字'),
  encodingAesKey: z.string().max(64).optional(),
  encryptMode: z.enum(MP_ENCRYPT_MODES).default('plaintext'),
  type: z.enum(MP_ACCOUNT_TYPES).default('service'),
  qrCodeUrl: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  autoCreateMember: z.boolean().default(false),
  contentCheckEnabled: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});


export const updateMpAccountSchema = partialForUpdate(createMpAccountSchema).extend({
  appSecret: z.string().max(128).optional(), // 更新时留空表示保持原值
});


export type CreateMpAccountInput = z.infer<typeof createMpAccountSchema>;


export type UpdateMpAccountInput = z.infer<typeof updateMpAccountSchema>;


// 公众号标签
export const createMpTagSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1, '标签名称不能为空').max(30),
});


export const updateMpTagSchema = z.object({
  name: z.string().min(1, '标签名称不能为空').max(30),
});


export type CreateMpTagInput = z.infer<typeof createMpTagSchema>;


export type UpdateMpTagInput = z.infer<typeof updateMpTagSchema>;


// 公众号粉丝（本地备注 / 标签）
export const updateMpFanSchema = z.object({
  remark: z.string().max(128).optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
});


export type UpdateMpFanInput = z.infer<typeof updateMpFanSchema>;


/** 绑定粉丝到已有会员 */
export const bindMpFanMemberSchema = z.object({
  memberId: z.number().int().positive(),
});


export type BindMpFanMemberInput = z.infer<typeof bindMpFanMemberSchema>;


// 公众号自动回复
export const mpReplyArticleSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(120),
  description: z.string().max(300).optional(),
  picUrl: z.string().max(1024).optional(),
  url: z.string().min(1, '图文链接不能为空').max(1024),
});


export type MpReplyArticle = z.infer<typeof mpReplyArticleSchema>;


const mpAutoReplyBase = z.object({
  accountId: z.number().int().positive(),
  replyType: z.enum(MP_AUTO_REPLY_TYPES),
  keyword: z.string().max(64).optional(),
  matchType: z.enum(MP_AUTO_REPLY_MATCH_TYPES).default('contain'),
  contentType: z.enum(MP_REPLY_CONTENT_TYPES).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
  newsArticles: z.array(mpReplyArticleSchema).max(8).optional(),
  transferToKf: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
});


export const createMpAutoReplySchema = mpAutoReplyBase
  .refine((d) => d.replyType !== 'keyword' || !!d.keyword, { message: '关键词回复必须填写关键词', path: ['keyword'] })
  .refine((d) => d.contentType !== 'text' || !!d.content, { message: '请填写回复内容', path: ['content'] })
  .refine((d) => !(['image', 'voice', 'video'] as string[]).includes(d.contentType) || !!d.mediaId, { message: '请选择素材', path: ['mediaId'] })
  .refine((d) => d.contentType !== 'news' || (d.newsArticles?.length ?? 0) > 0, { message: '请至少添加一篇图文', path: ['newsArticles'] });


export const updateMpAutoReplySchema = partialForUpdate(mpAutoReplyBase.omit({ accountId: true, replyType: true }));


export type CreateMpAutoReplyInput = z.infer<typeof createMpAutoReplySchema>;


export type UpdateMpAutoReplyInput = z.infer<typeof updateMpAutoReplySchema>;


// 公众号自定义菜单
/** 递归 schema：按钮可嵌套 sub_button，注册组件名后 OpenAPI 以 $ref 终止展开 */
export const mpMenuButtonSchema: z.ZodType<MpMenuButton, MpMenuButton> = lazyRecursive(() => z.object({
  name: z.string().min(1, '按钮名称不能为空').max(60),
  type: z.string().max(32).optional(),
  key: z.string().max(128).optional(),
  url: z.string().max(1024).optional(),
  appid: z.string().max(64).optional(),
  pagepath: z.string().max(256).optional(),
  media_id: z.string().max(128).optional(),
  article_id: z.string().max(128).optional(),
  sub_button: z.array(mpMenuButtonSchema).max(5).optional(),
})).meta({ id: 'MpMenuButton' });


export const saveMpMenuSchema = z.object({
  accountId: z.number().int().positive(),
  buttons: z.array(mpMenuButtonSchema).max(3, '一级菜单最多 3 个'),
});


export type SaveMpMenuInput = z.infer<typeof saveMpMenuSchema>;


// 个性化菜单（按匹配规则下发）
/** 个性化菜单匹配规则（字段值均为字符串，对齐微信 matchrule） */
export const mpMenuMatchRuleSchema = z.object({
  tagId: z.string().max(16).optional(),
  sex: z.string().max(4).optional(),
  country: z.string().max(64).optional(),
  province: z.string().max(64).optional(),
  city: z.string().max(64).optional(),
  clientPlatformType: z.string().max(4).optional(),
  language: z.string().max(16).optional(),
});


export type MpMenuMatchRule = z.infer<typeof mpMenuMatchRuleSchema>;


export const createMpConditionalMenuSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1, '名称不能为空').max(64),
  buttons: z.array(mpMenuButtonSchema).min(1, '至少一个一级菜单').max(3, '一级菜单最多 3 个'),
  matchRule: mpMenuMatchRuleSchema.refine((r) => Object.values(r).some((v) => v && v.length > 0), { message: '至少设置一个匹配条件' }),
});


export const updateMpConditionalMenuSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  buttons: z.array(mpMenuButtonSchema).min(1).max(3).optional(),
  matchRule: mpMenuMatchRuleSchema.optional(),
});


export const tryMatchMpMenuSchema = z.object({
  accountId: z.number().int().positive(),
  userId: z.string().min(1, '请输入 openid 或微信号').max(128),
});


export type CreateMpConditionalMenuInput = z.infer<typeof createMpConditionalMenuSchema>;


export type UpdateMpConditionalMenuInput = z.infer<typeof updateMpConditionalMenuSchema>;


export type TryMatchMpMenuInput = z.infer<typeof tryMatchMpMenuSchema>;


// 粉丝黑名单 + 内容安全校验
export const blacklistMpFansSchema = z.object({
  accountId: z.number().int().positive(),
  openids: z.array(z.string().min(1)).min(1, '请选择粉丝').max(20, '每次最多 20 个'),
});


export const checkMpContentSchema = z.object({
  accountId: z.number().int().positive(),
  content: z.string().min(1, '内容不能为空').max(2500),
});


export type BlacklistMpFansInput = z.infer<typeof blacklistMpFansSchema>;


export type CheckMpContentInput = z.infer<typeof checkMpContentSchema>;


// 公众号素材
export const createMpMaterialSchema = z.object({
  accountId: z.number().int().positive(),
  type: z.enum(MP_MATERIAL_TYPES).default('image'),
  name: z.string().min(1, '素材名称不能为空').max(200),
  url: z.string().max(1000).optional(),
  fileSize: z.number().int().nonnegative().optional(),
});


export const updateMpMaterialSchema = z.object({
  name: z.string().min(1, '素材名称不能为空').max(200),
});


export type CreateMpMaterialInput = z.infer<typeof createMpMaterialSchema>;


export type UpdateMpMaterialInput = z.infer<typeof updateMpMaterialSchema>;


// 公众号图文草稿
/** 图文消息单篇文章 */
export const mpArticleSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(120),
  author: z.string().max(60).optional(),
  digest: z.string().max(200).optional(),
  content: z.string().min(1, '正文不能为空'),
  thumbUrl: z.string().max(1000).optional(),
  thumbMediaId: z.string().max(128).optional(),
  contentSourceUrl: z.string().max(1000).optional(),
  showCoverPic: z.boolean().optional(),
});


export type MpArticle = z.infer<typeof mpArticleSchema>;


export const createMpDraftSchema = z.object({
  accountId: z.number().int().positive(),
  articles: z.array(mpArticleSchema).min(1, '至少需要一篇图文'),
});


export const updateMpDraftSchema = z.object({
  articles: z.array(mpArticleSchema).min(1, '至少需要一篇图文'),
});


export type CreateMpDraftInput = z.infer<typeof createMpDraftSchema>;


export type UpdateMpDraftInput = z.infer<typeof updateMpDraftSchema>;


// 公众号群发消息
const mpBroadcastBase = z.object({
  accountId: z.number().int().positive(),
  msgType: z.enum(MP_BROADCAST_TYPES).default('text'),
  target: z.enum(MP_BROADCAST_TARGETS).default('all'),
  tagId: z.number().int().positive().optional(),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
  scheduledAt: z.string().max(32).nullish(),
});


export const createMpBroadcastSchema = mpBroadcastBase
  .refine((d) => d.msgType !== 'text' || !!d.content, { message: '请填写群发文本内容', path: ['content'] })
  .refine((d) => d.msgType === 'text' || !!d.mediaId, { message: '请选择图片素材或图文草稿', path: ['mediaId'] })
  .refine((d) => d.target !== 'tag' || !!d.tagId, { message: '按标签群发时请选择标签', path: ['tagId'] });


export const updateMpBroadcastSchema = partialForUpdate(mpBroadcastBase.omit({ accountId: true }))
  .refine((d) => d.target !== 'tag' || d.tagId == null || d.tagId > 0, { message: '标签不合法', path: ['tagId'] });


export type CreateMpBroadcastInput = z.infer<typeof createMpBroadcastSchema>;


export type UpdateMpBroadcastInput = z.infer<typeof updateMpBroadcastSchema>;


export const previewMpBroadcastSchema = z.object({ openid: z.string().min(1, '请输入预览 openid').max(64) });


export type PreviewMpBroadcastInput = z.infer<typeof previewMpBroadcastSchema>;


// 模板消息：行业设置 + 批量发送
export const setMpTemplateIndustrySchema = z.object({
  accountId: z.number().int().positive(),
  industryId1: z.string().min(1, '请选择主营行业').max(8),
  industryId2: z.string().min(1, '请选择副营行业').max(8),
});


export type SetMpTemplateIndustryInput = z.infer<typeof setMpTemplateIndustrySchema>;


// JS-SDK 配置签名
export const getMpJsConfigSchema = z.object({
  accountId: z.number().int().positive(),
  url: z.string().min(1, '请输入页面 URL').max(1000),
});


export type GetMpJsConfigInput = z.infer<typeof getMpJsConfigSchema>;


// 公众号带参数二维码
export const createMpQrcodeSchema = z.object({
  accountId: z.number().int().positive(),
  type: z.enum(MP_QRCODE_TYPES).default('permanent'),
  sceneStr: z.string().min(1, '场景值不能为空').max(64).regex(/^[A-Za-z0-9_-]+$/, '场景值仅支持字母、数字、下划线、连字符'),
  name: z.string().min(1, '名称不能为空').max(100),
  /** 临时二维码有效期（秒），最长 30 天 */
  expireSeconds: z.number().int().min(60).max(2592000).optional(),
  /** 扫码关注奖励积分（粉丝已绑定会员时入账），0=不奖励 */
  rewardPoints: z.number().int().min(0).max(100000).default(0),
}).refine((d) => d.type !== 'temporary' || !!d.expireSeconds, { message: '临时二维码请设置有效期', path: ['expireSeconds'] });


export type CreateMpQrcodeInput = z.infer<typeof createMpQrcodeSchema>;


// 公众号多客服账号
export const createMpKfAccountSchema = z.object({
  accountId: z.number().int().positive(),
  kfAccount: z.string().min(1, '客服账号不能为空').max(64),
  nickname: z.string().min(1, '客服昵称不能为空').max(64),
});


export const updateMpKfAccountSchema = z.object({
  nickname: z.string().min(1, '客服昵称不能为空').max(64),
});


export type CreateMpKfAccountInput = z.infer<typeof createMpKfAccountSchema>;


export type UpdateMpKfAccountInput = z.infer<typeof updateMpKfAccountSchema>;


export const transferMpKfSessionSchema = z.object({
  toKfId: z.number().int().positive(),
  remark: z.string().max(255).optional(),
});


export const updateMpKfRoutingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: z.enum(MP_KF_ROUTING_STRATEGIES).optional(),
  maxConcurrent: z.number().int().min(1).max(100).optional(),
  waitTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  autoCloseEnabled: z.boolean().optional(),
  welcomeText: z.string().max(500).nullable().optional(),
});


export type TransferMpKfSessionInput = z.infer<typeof transferMpKfSessionSchema>;


export type UpdateMpKfRoutingConfigInput = z.infer<typeof updateMpKfRoutingConfigSchema>;
