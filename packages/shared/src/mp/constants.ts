import { createLabelOptionsFromMap } from '../core/enum-options';

// ─── 公众号账号 ──────────────────────────────────────────────────────────────
export const MP_ACCOUNT_TYPES = ['subscribe', 'service', 'test'] as const;

export type MpAccountType = (typeof MP_ACCOUNT_TYPES)[number];

export const MP_ENCRYPT_MODES = ['plaintext', 'compatible', 'safe'] as const;

export type MpEncryptMode = (typeof MP_ENCRYPT_MODES)[number];

// ─── 粉丝 ────────────────────────────────────────────────────────────────────
export const MP_FAN_SUBSCRIBES = ['subscribed', 'unsubscribed'] as const;

export type MpFanSubscribe = (typeof MP_FAN_SUBSCRIBES)[number];

// ─── 消息 ────────────────────────────────────────────────────────────────────
export const MP_MESSAGE_DIRECTIONS = ['in', 'out'] as const;

export type MpMessageDirection = (typeof MP_MESSAGE_DIRECTIONS)[number];

export const MP_MESSAGE_TYPES = ['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event'] as const;

export type MpMessageType = (typeof MP_MESSAGE_TYPES)[number];

export const MP_MESSAGE_TYPE_LABELS: Record<MpMessageType, string> = {
  text: '文本',
  image: '图片',
  voice: '语音',
  video: '视频',
  shortvideo: '视频',
  location: '位置',
  link: '链接',
  event: '事件',
};

export const MP_MESSAGE_STATUSES = ['received', 'sent', 'failed'] as const;

export type MpMessageStatus = (typeof MP_MESSAGE_STATUSES)[number];

/** 客服消息（主动下发）支持的消息类型 */
export const MP_CUSTOM_MSG_TYPES = ['text', 'image', 'voice', 'video', 'news'] as const;

export type MpCustomMsgType = (typeof MP_CUSTOM_MSG_TYPES)[number];

// ─── 自动回复 ────────────────────────────────────────────────────────────────
export const MP_AUTO_REPLY_TYPES = ['subscribe', 'keyword', 'default'] as const;

export type MpAutoReplyType = (typeof MP_AUTO_REPLY_TYPES)[number];

export const MP_AUTO_REPLY_MATCH_TYPES = ['exact', 'contain', 'regex'] as const;

export type MpAutoReplyMatch = (typeof MP_AUTO_REPLY_MATCH_TYPES)[number];

export const MP_REPLY_CONTENT_TYPES = ['text', 'image', 'voice', 'video', 'news'] as const;

export type MpReplyContentType = (typeof MP_REPLY_CONTENT_TYPES)[number];

export const MP_REPLY_CONTENT_TYPE_LABELS: Record<MpReplyContentType, string> = {
  text: '文本',
  image: '图片',
  voice: '语音',
  video: '视频',
  news: '图文',
};

export const MP_REPLY_CONTENT_TYPE_OPTIONS: Array<{ value: MpReplyContentType; label: string }> =
  createLabelOptionsFromMap(MP_REPLY_CONTENT_TYPE_LABELS);

// ─── 自定义菜单 / 图文草稿 ───────────────────────────────────────────────────
export const MP_MENU_STATUSES = ['draft', 'published'] as const;

export type MpMenuStatus = (typeof MP_MENU_STATUSES)[number];

export const MP_DRAFT_STATUSES = ['draft', 'published'] as const;

export type MpDraftStatus = (typeof MP_DRAFT_STATUSES)[number];

// ─── 素材 ────────────────────────────────────────────────────────────────────
export const MP_MATERIAL_TYPES = ['image', 'voice', 'video', 'thumb'] as const;

export type MpMaterialType = (typeof MP_MATERIAL_TYPES)[number];

export const MP_MATERIAL_TYPE_LABELS: Record<MpMaterialType, string> = {
  image: '图片',
  voice: '语音',
  video: '视频',
  thumb: '缩略图',
};

export const MP_MATERIAL_TYPE_OPTIONS: Array<{ value: MpMaterialType; label: string }> =
  createLabelOptionsFromMap(MP_MATERIAL_TYPE_LABELS);

// ─── 模板消息 ────────────────────────────────────────────────────────────────
export const MP_TEMPLATE_SEND_STATUSES = ['success', 'failed'] as const;

export type MpTemplateSendStatus = (typeof MP_TEMPLATE_SEND_STATUSES)[number];

// ─── 群发 ────────────────────────────────────────────────────────────────────
export const MP_BROADCAST_TYPES = ['text', 'image', 'mpnews'] as const;

export type MpBroadcastType = (typeof MP_BROADCAST_TYPES)[number];

export const MP_BROADCAST_TYPE_LABELS: Record<MpBroadcastType, string> = {
  text: '文本',
  image: '图片',
  mpnews: '图文',
};

export const MP_BROADCAST_TYPE_OPTIONS: Array<{ value: MpBroadcastType; label: string }> =
  createLabelOptionsFromMap(MP_BROADCAST_TYPE_LABELS);

export const MP_BROADCAST_TARGETS = ['all', 'tag'] as const;

export type MpBroadcastTarget = (typeof MP_BROADCAST_TARGETS)[number];

export const MP_BROADCAST_STATUSES = ['draft', 'sent', 'failed'] as const;

export type MpBroadcastStatus = (typeof MP_BROADCAST_STATUSES)[number];

// ─── 带参数二维码 ────────────────────────────────────────────────────────────
export const MP_QRCODE_TYPES = ['temporary', 'permanent'] as const;

export type MpQrcodeType = (typeof MP_QRCODE_TYPES)[number];

// ─── 网页授权（OAuth2） ──────────────────────────────────────────────────────
export const MP_OAUTH_SCOPES = ['snsapi_base', 'snsapi_userinfo'] as const;

export type MpOAuthScope = (typeof MP_OAUTH_SCOPES)[number];

// ─── 多客服会话治理 ──────────────────────────────────────────────────────────
export const MP_KF_SESSION_STATUSES = ['waiting', 'active', 'closed'] as const;

export type MpKfSessionStatus = (typeof MP_KF_SESSION_STATUSES)[number];

export const MP_KF_SESSION_CLOSE_REASONS = ['manual', 'wait_timeout', 'idle_timeout', 'system'] as const;

export type MpKfSessionCloseReason = (typeof MP_KF_SESSION_CLOSE_REASONS)[number];

export const MP_KF_ROUTING_STRATEGIES = ['manual', 'round_robin', 'least_active'] as const;

export type MpKfRoutingStrategy = (typeof MP_KF_ROUTING_STRATEGIES)[number];

export const MP_KF_SESSION_EVENT_TYPES = ['create', 'assign', 'accept', 'transfer', 'reroute', 'close'] as const;

export type MpKfSessionEventType = (typeof MP_KF_SESSION_EVENT_TYPES)[number];
