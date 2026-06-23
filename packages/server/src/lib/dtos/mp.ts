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
    contentType: z.enum(['text', 'image']),
    content: z.string().nullable(),
    mediaId: z.string().nullable(),
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
