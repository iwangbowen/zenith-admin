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
    autoCreateMember: z.boolean(),
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
    unionid: z.string().nullable(),
    memberId: z.number().int().nullable(),
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

export const MpKfAccountDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    kfAccount: z.string(),
    nickname: z.string(),
    avatar: z.string().nullable(),
    kfId: z.string().nullable(),
    inviteStatus: z.string(),
    inviteWx: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpKfAccount');

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

export const MpDatacubeDTO = z
  .object({
    beginDate: z.string(),
    endDate: z.string(),
    userSummary: z.array(z.object({ refDate: z.string(), newUser: z.number().int(), cancelUser: z.number().int() })),
    userCumulate: z.array(z.object({ refDate: z.string(), cumulateUser: z.number().int() })),
    upstreamMsg: z.array(z.object({ refDate: z.string(), msgUser: z.number().int(), msgCount: z.number().int() })),
    articleSummary: z.array(z.object({ refDate: z.string(), pageReadCount: z.number().int() })),
  })
  .openapi('MpDatacube');

// ─── 多客服会话治理 ───────────────────────────────────────────────────────────
const MP_KF_SESSION_STATUS = z.enum(['waiting', 'active', 'closed']);

export const MpKfSessionDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    openid: z.string(),
    kfId: z.number().int().nullable(),
    kfNickname: z.string().nullable(),
    fanNickname: z.string().nullable(),
    fanAvatar: z.string().nullable(),
    status: MP_KF_SESSION_STATUS,
    priority: z.number().int(),
    source: z.string().nullable(),
    unreadCount: z.number().int(),
    lastFanMsgAt: z.string().nullable(),
    lastKfMsgAt: z.string().nullable(),
    lastMsgAt: z.string().nullable(),
    waitingSince: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    closeReason: z.enum(['manual', 'wait_timeout', 'idle_timeout', 'system']).nullable(),
    remark: z.string().nullable(),
    waitSeconds: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MpKfSession');

export const MpKfSessionEventDTO = z
  .object({
    id: z.number().int(),
    sessionId: z.number().int(),
    accountId: z.number().int(),
    type: z.enum(['create', 'assign', 'accept', 'transfer', 'reroute', 'close']),
    fromKfId: z.number().int().nullable(),
    toKfId: z.number().int().nullable(),
    fromKfNickname: z.string().nullable(),
    toKfNickname: z.string().nullable(),
    operatorId: z.number().int().nullable(),
    operatorName: z.string().nullable(),
    detail: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('MpKfSessionEvent');

export const MpKfSessionDetailDTO = MpKfSessionDTO
  .extend({
    events: z.array(MpKfSessionEventDTO),
    messages: z.array(MpMessageDTO),
  })
  .openapi('MpKfSessionDetail');

export const MpKfRoutingConfigDTO = z
  .object({
    id: z.number().int(),
    accountId: z.number().int(),
    enabled: z.boolean(),
    strategy: z.enum(['manual', 'round_robin', 'least_active']),
    maxConcurrent: z.number().int(),
    waitTimeoutMinutes: z.number().int(),
    idleTimeoutMinutes: z.number().int(),
    autoCloseEnabled: z.boolean(),
    welcomeText: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('MpKfRoutingConfig');

export const MpKfSessionStatsDTO = z
  .object({
    waiting: z.number().int(),
    active: z.number().int(),
    closedToday: z.number().int(),
    avgWaitSeconds: z.number().int(),
    agents: z.array(z.object({
      kfId: z.number().int(),
      kfAccount: z.string(),
      nickname: z.string(),
      status: z.enum(['enabled', 'disabled']),
      activeCount: z.number().int(),
    })),
  })
  .openapi('MpKfSessionStats');
