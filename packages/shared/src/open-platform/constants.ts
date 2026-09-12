import { createLabelOptions, createLabelOptionsFromMap } from '../core/enum-options';
// OAuth2 服务端常量
export const OAUTH2_GRANT_TYPES = ['authorization_code', 'client_credentials', 'refresh_token'] as const;

export type OAuth2GrantType = typeof OAUTH2_GRANT_TYPES[number];

export const OAUTH2_GRANT_TYPE_LABELS: Record<OAuth2GrantType, string> = {
  authorization_code: '授权码',
  client_credentials: '客户端凭证',
  refresh_token: '刷新令牌',
};

export const OAUTH2_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export type OAuth2Scope = typeof OAUTH2_SCOPES[number];

export const OAUTH2_SCOPE_LABELS: Record<OAuth2Scope, string> = {
  openid: 'OpenID（确认身份）',
  profile: 'Profile（基本信息）',
  email: 'Email（邮箱）',
  offline_access: 'Offline Access（离线访问）',
};

export const OAUTH2_SCOPE_OPTIONS: Array<{ value: OAuth2Scope; label: string }> =
  createLabelOptions(OAUTH2_SCOPES, OAUTH2_SCOPE_LABELS);

export const OAUTH2_SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '确认您的身份（用户 ID）',
  profile: '读取您的基本信息（昵称、头像）',
  email: '读取您的邮箱地址',
  offline_access: '允许在您离线时保持访问（续签令牌）',
};

export const OAUTH2_CODE_CHALLENGE_METHODS = ['S256'] as const;

export type OAuth2CodeChallengeMethod = typeof OAUTH2_CODE_CHALLENGE_METHODS[number];

export const OAUTH2_TOKEN_TYPES = ['access', 'refresh'] as const;

export type OAuth2TokenType = typeof OAUTH2_TOKEN_TYPES[number];

/** 管理端审核开发者应用的动作 */
export const OAUTH2_REVIEW_ACTIONS = ['approve', 'reject'] as const;

export type OAuth2ReviewAction = typeof OAUTH2_REVIEW_ACTIONS[number];

export const OPEN_APP_ENVIRONMENTS = ['production', 'sandbox'] as const;

export type OpenAppEnvironment = typeof OPEN_APP_ENVIRONMENTS[number];

export const OPEN_APP_ENVIRONMENT_LABELS: Record<OpenAppEnvironment, string> = {
  production: '生产环境',
  sandbox: '沙箱环境',
};

export const OPEN_APP_ENVIRONMENT_OPTIONS = createLabelOptions(OPEN_APP_ENVIRONMENTS, OPEN_APP_ENVIRONMENT_LABELS);

export const OPEN_APP_REVIEW_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;

export type OpenAppReviewStatus = typeof OPEN_APP_REVIEW_STATUSES[number];

export const OPEN_APP_REVIEW_STATUS_LABELS: Record<OpenAppReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export const OPEN_APP_REVIEW_STATUS_OPTIONS = createLabelOptions(OPEN_APP_REVIEW_STATUSES, OPEN_APP_REVIEW_STATUS_LABELS);

export const OAUTH2_TOKEN_EXPIRY = {
  accessToken: 2 * 60 * 60, // 2 小时（秒）
  refreshToken: 30 * 24 * 60 * 60, // 30 天（秒）
  authorizationCode: 10 * 60, // 10 分钟（秒）
} as const;

// ─── 开放平台 / 开发者门户 ────────────────────────────────────────────────────

/** HMAC 签名所用请求头名称 */
export const OPEN_SIGNATURE_HEADERS = {
  appKey: 'X-App-Key',
  timestamp: 'X-Timestamp',
  nonce: 'X-Nonce',
  signature: 'X-Signature',
} as const;

/** 签名算法标识 */
export const OPEN_SIGNATURE_ALGORITHM = 'HMAC-SHA256';

/** 允许的时间戳偏移窗口（秒），超出视为过期，防重放 */
export const OPEN_SIGNATURE_TIMESTAMP_WINDOW = 300;

/** 开放网关鉴权通道：bearer = OAuth2 令牌；signature = AppKey + HMAC */
export const OPEN_AUTH_CHANNELS = ['bearer', 'signature'] as const;

export type OpenAuthChannel = (typeof OPEN_AUTH_CHANNELS)[number];

/** API 调试台可发起的请求方法 */
export const OPEN_API_DEBUG_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

export type OpenApiDebugMethod = (typeof OPEN_API_DEBUG_METHODS)[number];

/** 调用趋势的聚合粒度 */
export const OPEN_API_STATS_GRANULARITIES = ['hour', 'day'] as const;

export type OpenApiStatsGranularity = (typeof OPEN_API_STATS_GRANULARITIES)[number];

/** API Scope 推荐分组（scopeGroup 为自由文本，此处仅供界面下拉建议） */
export const API_SCOPE_GROUPS = ['general', 'user', 'order', 'payment', 'member', 'data', 'system'] as const;

export type ApiScopeGroup = (typeof API_SCOPE_GROUPS)[number];

export const API_SCOPE_GROUP_LABELS: Record<string, string> = {
  general: '通用',
  user: '用户',
  order: '订单',
  payment: '支付',
  member: '会员',
  data: '数据',
  system: '系统',
};

// ─── 开放平台：Webhook 订阅 ───────────────────────────────────────────────────
export const OPEN_WEBHOOK_SIGN_MODES = ['hmacSha256', 'none'] as const;

export type OpenWebhookSignMode = (typeof OPEN_WEBHOOK_SIGN_MODES)[number];

export const OPEN_WEBHOOK_SIGN_MODE_LABELS: Record<OpenWebhookSignMode, string> = {
  hmacSha256: 'HMAC-SHA256（推荐）',
  none: '不签名（仅非支付事件）',
};

export const OPEN_WEBHOOK_SIGN_MODE_OPTIONS: Array<{ value: OpenWebhookSignMode; label: string }> =
  createLabelOptions(OPEN_WEBHOOK_SIGN_MODES, OPEN_WEBHOOK_SIGN_MODE_LABELS);

export const OPEN_WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'retrying'] as const;

export type OpenWebhookDeliveryStatus = (typeof OPEN_WEBHOOK_DELIVERY_STATUSES)[number];

export const OPEN_WEBHOOK_DELIVERY_STATUS_LABELS: Record<OpenWebhookDeliveryStatus, string> = {
  pending: '投递中',
  success: '成功',
  failed: '失败',
  retrying: '重试中',
};

export const OPEN_WEBHOOK_DELIVERY_STATUS_OPTIONS = createLabelOptionsFromMap(OPEN_WEBHOOK_DELIVERY_STATUS_LABELS);

/** 支付域可订阅事件；支付中心 Webhook 视图只允许这些显式事件。 */
export const PAYMENT_WEBHOOK_EVENTS = [
  'payment.succeeded', 'payment.closed', 'payment.failed', 'refund.succeeded', 'refund.failed',
] as const;

export type PaymentWebhookEvent = (typeof PAYMENT_WEBHOOK_EVENTS)[number];

/** 可订阅的开放平台事件类型 */
export const OPEN_WEBHOOK_EVENTS = [
  'app.test', 'app.call.failed', 'app.quota.warning', 'app.quota.exceeded', 'app.scope.denied',
  ...PAYMENT_WEBHOOK_EVENTS,
  'iot.device.online', 'iot.device.offline', 'iot.alarm.triggered', 'iot.alarm.resolved', 'iot.ota.task_completed',
  'drive.node.created', 'drive.node.version_created', 'drive.node.updated', 'drive.node.deleted', 'drive.node.restored', 'drive.node.purged',
  'drive.share.created', 'drive.share.revoked', 'drive.collect.received',
] as const;

export type OpenWebhookEvent = (typeof OPEN_WEBHOOK_EVENTS)[number];

export const OPEN_WEBHOOK_EVENT_LABELS: Record<string, string> = {
  'app.test': '测试事件',
  'app.call.failed': '调用失败',
  'app.quota.exceeded': '配额超限',
  'app.quota.warning': '配额预警',
  'app.scope.denied': 'Scope 未授权',
  'payment.succeeded': '支付成功',
  'payment.closed': '支付关闭',
  'payment.failed': '支付失败',
  'refund.succeeded': '退款成功',
  'refund.failed': '退款失败',
  'iot.device.online': 'IoT 设备上线',
  'iot.device.offline': 'IoT 设备离线',
  'iot.alarm.triggered': 'IoT 告警触发',
  'iot.alarm.resolved': 'IoT 告警恢复',
  'iot.ota.task_completed': 'IoT 升级任务完成',
  'drive.node.created': '网盘文件上传',
  'drive.node.version_created': '网盘文件新版本',
  'drive.node.updated': '网盘文件变更',
  'drive.node.deleted': '网盘文件删除到回收站',
  'drive.node.restored': '网盘文件还原',
  'drive.node.purged': '网盘文件彻底删除',
  'drive.share.created': '网盘外链创建',
  'drive.share.revoked': '网盘外链撤销',
  'drive.collect.received': '网盘收集到新文件',
};

/** Webhook 投递签名请求头 */
export const OPEN_WEBHOOK_SIGNATURE_HEADER = 'X-Zenith-Signature';

/** 阶梯重试间隔（分钟） */
export const OPEN_WEBHOOK_RETRY_STAGES_MINUTES = [1, 5, 30, 180, 720] as const;
