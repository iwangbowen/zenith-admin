import { createLabelOptions, createLabelOptionsFromMap } from '../core/enum-options';

// ─── 公众号账号 ──────────────────────────────────────────────────────────────
export const MP_ACCOUNT_TYPES = ['subscribe', 'service', 'test'] as const;

export type MpAccountType = (typeof MP_ACCOUNT_TYPES)[number];

export const MP_ACCOUNT_TYPE_LABELS: Record<MpAccountType, string> = {
  subscribe: '订阅号',
  service: '服务号',
  test: '测试号',
};

export const MP_ACCOUNT_TYPE_OPTIONS: Array<{ value: MpAccountType; label: string }> =
  createLabelOptions(MP_ACCOUNT_TYPES, MP_ACCOUNT_TYPE_LABELS);

export const MP_ENCRYPT_MODES = ['plaintext', 'compatible', 'safe'] as const;

export type MpEncryptMode = (typeof MP_ENCRYPT_MODES)[number];

export const MP_ENCRYPT_MODE_LABELS: Record<MpEncryptMode, string> = {
  plaintext: '明文模式',
  compatible: '兼容模式',
  safe: '安全模式',
};

export const MP_ENCRYPT_MODE_OPTIONS: Array<{ value: MpEncryptMode; label: string }> =
  createLabelOptions(MP_ENCRYPT_MODES, MP_ENCRYPT_MODE_LABELS);

// ─── 粉丝 ────────────────────────────────────────────────────────────────────
export const MP_FAN_SUBSCRIBES = ['subscribed', 'unsubscribed'] as const;

export type MpFanSubscribe = (typeof MP_FAN_SUBSCRIBES)[number];

export const MP_FAN_SUBSCRIBE_LABELS: Record<MpFanSubscribe, string> = {
  subscribed: '已关注',
  unsubscribed: '已取关',
};

export const MP_FAN_SUBSCRIBE_OPTIONS: Array<{ value: MpFanSubscribe; label: string }> =
  createLabelOptions(MP_FAN_SUBSCRIBES, MP_FAN_SUBSCRIBE_LABELS);

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

export const MP_AUTO_REPLY_TYPE_LABELS: Record<MpAutoReplyType, string> = {
  subscribe: '关注回复',
  keyword: '关键词回复',
  default: '默认回复',
};

export const MP_AUTO_REPLY_TYPE_OPTIONS: Array<{ value: MpAutoReplyType; label: string }> =
  createLabelOptions(MP_AUTO_REPLY_TYPES, MP_AUTO_REPLY_TYPE_LABELS);

export const MP_AUTO_REPLY_MATCH_TYPES = ['exact', 'contain', 'regex'] as const;

export type MpAutoReplyMatch = (typeof MP_AUTO_REPLY_MATCH_TYPES)[number];

export const MP_AUTO_REPLY_MATCH_LABELS: Record<MpAutoReplyMatch, string> = {
  exact: '全匹配',
  contain: '包含匹配',
  regex: '正则匹配',
};

export const MP_AUTO_REPLY_MATCH_OPTIONS: Array<{ value: MpAutoReplyMatch; label: string }> =
  createLabelOptions(MP_AUTO_REPLY_MATCH_TYPES, MP_AUTO_REPLY_MATCH_LABELS);

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

export const MP_BROADCAST_STATUS_LABELS: Record<MpBroadcastStatus, string> = {
  draft: '草稿',
  sent: '已发送',
  failed: '失败',
};

export const MP_BROADCAST_STATUS_OPTIONS: Array<{ value: MpBroadcastStatus; label: string }> =
  createLabelOptions(MP_BROADCAST_STATUSES, MP_BROADCAST_STATUS_LABELS);

// ─── 带参数二维码 ────────────────────────────────────────────────────────────
export const MP_QRCODE_TYPES = ['temporary', 'permanent'] as const;

export type MpQrcodeType = (typeof MP_QRCODE_TYPES)[number];

export const MP_QRCODE_TYPE_LABELS: Record<MpQrcodeType, string> = {
  temporary: '临时二维码',
  permanent: '永久二维码',
};

export const MP_QRCODE_TYPE_OPTIONS: Array<{ value: MpQrcodeType; label: string }> =
  createLabelOptions(MP_QRCODE_TYPES, MP_QRCODE_TYPE_LABELS);

// ─── 网页授权（OAuth2） ──────────────────────────────────────────────────────
export const MP_OAUTH_SCOPES = ['snsapi_base', 'snsapi_userinfo'] as const;

export type MpOAuthScope = (typeof MP_OAUTH_SCOPES)[number];

export const MP_OAUTH_SCOPE_LABELS: Record<MpOAuthScope, string> = {
  snsapi_base: 'snsapi_base（静默授权，仅取 openid）',
  snsapi_userinfo: 'snsapi_userinfo（弹窗授权，取用户信息）',
};

export const MP_OAUTH_SCOPE_OPTIONS: Array<{ value: MpOAuthScope; label: string }> =
  createLabelOptions(MP_OAUTH_SCOPES, MP_OAUTH_SCOPE_LABELS);

// ─── 多客服会话治理 ──────────────────────────────────────────────────────────
export const MP_KF_SESSION_STATUSES = ['waiting', 'active', 'closed'] as const;

export type MpKfSessionStatus = (typeof MP_KF_SESSION_STATUSES)[number];

export const MP_KF_SESSION_STATUS_LABELS: Record<MpKfSessionStatus, string> = {
  waiting: '排队中',
  active: '进行中',
  closed: '已结束',
};

export const MP_KF_SESSION_STATUS_OPTIONS: Array<{ value: MpKfSessionStatus; label: string }> =
  createLabelOptions(MP_KF_SESSION_STATUSES, MP_KF_SESSION_STATUS_LABELS);

export const MP_KF_SESSION_CLOSE_REASONS = ['manual', 'wait_timeout', 'idle_timeout', 'system'] as const;

export type MpKfSessionCloseReason = (typeof MP_KF_SESSION_CLOSE_REASONS)[number];

export const MP_KF_SESSION_CLOSE_REASON_LABELS: Record<MpKfSessionCloseReason, string> = {
  manual: '手动结束',
  wait_timeout: '等待超时',
  idle_timeout: '空闲超时',
  system: '系统结束',
};

export const MP_KF_SESSION_CLOSE_REASON_OPTIONS: Array<{ value: MpKfSessionCloseReason; label: string }> =
  createLabelOptions(MP_KF_SESSION_CLOSE_REASONS, MP_KF_SESSION_CLOSE_REASON_LABELS);

export const MP_KF_ROUTING_STRATEGIES = ['manual', 'round_robin', 'least_active'] as const;

export type MpKfRoutingStrategy = (typeof MP_KF_ROUTING_STRATEGIES)[number];

export const MP_KF_ROUTING_STRATEGY_LABELS: Record<MpKfRoutingStrategy, string> = {
  manual: '人工抢单',
  round_robin: '轮询分配',
  least_active: '负载最小',
};

export const MP_KF_ROUTING_STRATEGY_OPTIONS: Array<{ value: MpKfRoutingStrategy; label: string }> =
  createLabelOptions(MP_KF_ROUTING_STRATEGIES, MP_KF_ROUTING_STRATEGY_LABELS);

export const MP_KF_SESSION_EVENT_TYPES = ['create', 'assign', 'accept', 'transfer', 'reroute', 'close'] as const;

export type MpKfSessionEventType = (typeof MP_KF_SESSION_EVENT_TYPES)[number];

export const MP_KF_SESSION_EVENT_TYPE_LABELS: Record<MpKfSessionEventType, string> = {
  create: '粉丝发起',
  assign: '自动分配',
  accept: '人工接入',
  transfer: '转接',
  reroute: '超时重路由',
  close: '结束',
};

export const MP_KF_SESSION_EVENT_TYPE_OPTIONS: Array<{ value: MpKfSessionEventType; label: string }> =
  createLabelOptions(MP_KF_SESSION_EVENT_TYPES, MP_KF_SESSION_EVENT_TYPE_LABELS);
