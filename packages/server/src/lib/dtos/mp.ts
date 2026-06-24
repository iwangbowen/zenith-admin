/**
 * 公众号管理 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const MpAccountDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    account: z.string().nullable(),
    appId: z.string(),
    appSecret: z.string().optional(), // 脱敏：列表返回 '******'，编辑返回 ''
    token: z.string(),
    encodingAesKey: z.string().nullable(),
    encryptMode: z.enum(['plaintext', 'compatible', 'safe']),
    type: z.enum(['subscribe', 'service', 'test']),
    qrCodeUrl: z.string().nullable(),
    isDefault: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpAccount');

export const MpConnectionTestDTO = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .openapi('MpConnectionTest');

export const MpTagDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    wechatTagId: z.number().int().nullable(),
    name: z.string(),
    fansCount: z.number().int(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpTag');

export const MpTagSyncResultDTO = z
  .object({
    success: z.boolean(),
    created: z.number().int(),
    updated: z.number().int(),
    total: z.number().int(),
  })
  .openapi('MpTagSyncResult');

export const MpFanDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    openid: z.string(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    sex: z.number().int(),
    country: z.string().nullable(),
    province: z.string().nullable(),
    city: z.string().nullable(),
    language: z.string().nullable(),
    subscribe: z.enum(['subscribed', 'unsubscribed']),
    subscribeTime: z.string().nullable(),
    remark: z.string().nullable(),
    tagIds: z.array(z.number().int()),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpFan');

export const MpFanSyncResultDTO = z
  .object({
    success: z.boolean(),
    synced: z.number().int(),
    total: z.number().int(),
  })
  .openapi('MpFanSyncResult');

const MP_MSG_TYPE = z.enum(['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event']);
const MP_MSG_DIRECTION = z.enum(['in', 'out']);

export const MpMessageDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    openid: z.string(),
    direction: MP_MSG_DIRECTION,
    msgType: MP_MSG_TYPE,
    content: z.string().nullable(),
    mediaId: z.string().nullable(),
    mediaUrl: z.string().nullable(),
    event: z.string().nullable(),
    msgId: z.string().nullable(),
    status: z.enum(['received', 'sent', 'failed']),
    errorMsg: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('MpMessage');

export const MpConversationDTO = z
  .object({
    openid: z.string(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    lastContent: z.string().nullable(),
    lastMsgType: MP_MSG_TYPE,
    lastDirection: MP_MSG_DIRECTION,
    lastTime: z.string(),
    messageCount: z.number().int(),
  })
  .openapi('MpConversation');

export const MpAutoReplyDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    replyType: z.enum(['subscribe', 'keyword', 'default']),
    keyword: z.string().nullable(),
    matchType: z.enum(['exact', 'contain']),
    contentType: z.enum(['text', 'image', 'voice', 'video', 'news']),
    content: z.string().nullable(),
    mediaId: z.string().nullable(),
    newsArticles: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      picUrl: z.string().optional(),
      url: z.string(),
    })).nullable(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpAutoReply');

export const MpMenuDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    buttons: z.array(z.any()),
    status: z.enum(['draft', 'published']),
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpMenu');

export const MpMaterialDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    type: z.enum(['image', 'voice', 'video', 'thumb']),
    name: z.string(),
    wechatMediaId: z.string().nullable(),
    url: z.string().nullable(),
    fileSize: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpMaterial');

export const MpDraftDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    title: z.string(),
    articles: z.array(z.any()),
    wechatMediaId: z.string().nullable(),
    status: z.enum(['draft', 'published']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpDraft');

export const MpMessageTemplateDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    templateId: z.string(),
    title: z.string(),
    content: z.string().nullable(),
    example: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpMessageTemplate');

export const MpTemplateSendLogDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    templateId: z.string(),
    openid: z.string(),
    data: z.any().nullable(),
    url: z.string().nullable(),
    status: z.enum(['success', 'failed']),
    errorMsg: z.string().nullable(),
    msgId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('MpTemplateSendLog');

export const MpBroadcastDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    msgType: z.enum(['text', 'image', 'mpnews']),
    target: z.enum(['all', 'tag']),
    tagId: z.number().int().nullable(),
    content: z.string().nullable(),
    mediaId: z.string().nullable(),
    status: z.enum(['draft', 'sent', 'failed']),
    wechatMsgId: z.string().nullable(),
    errorMsg: z.string().nullable(),
    sentAt: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpBroadcast');

export const MpQrcodeDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    type: z.enum(['temporary', 'permanent']),
    sceneStr: z.string(),
    name: z.string(),
    ticket: z.string().nullable(),
    url: z.string().nullable(),
    expireSeconds: z.number().int().nullable(),
    scanCount: z.number().int(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpQrcode');

export const MpOAuthUrlDTO = z
  .object({ url: z.string() })
  .openapi('MpOAuthUrl');

export const MpOAuthResultDTO = z
  .object({
    openid: z.string(),
    unionid: z.string().nullable(),
    scope: z.string(),
    userInfo: z.object({
      nickname: z.string().optional(),
      sex: z.number().optional(),
      province: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      headimgurl: z.string().optional(),
    }).nullable(),
  })
  .openapi('MpOAuthResult');

export const MpStatsDTO = z
  .object({
    fanTotal: z.number().int(),
    fanSubscribed: z.number().int(),
    fanUnsubscribed: z.number().int(),
    tagTotal: z.number().int(),
    materialTotal: z.number().int(),
    draftTotal: z.number().int(),
    messageIn: z.number().int(),
    messageOut: z.number().int(),
    autoReplyTotal: z.number().int(),
    fanTrend: z.array(z.object({ date: z.string(), count: z.number().int() })),
    messageTrend: z.array(z.object({ date: z.string(), in: z.number().int(), out: z.number().int() })),
  })
  .openapi('MpStats');
