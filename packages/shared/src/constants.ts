import type { WorkflowApproverDedupMode } from './types';

export const API_PREFIX = '/api';
export const TOKEN_KEY = 'zenith_token';
export const REFRESH_TOKEN_KEY = 'zenith_refresh_token';
export const PREFERENCES_KEY = 'zenith_preferences';
export const TABS_STORAGE_KEY = 'zenith_tabs';
export const USER_ROLES = ['admin', 'user'] as const;
export const USER_STATUSES = ['enabled', 'disabled'] as const;
export const SUPER_ADMIN_CODE = 'super_admin';
export const TENANT_ADMIN_CODE = 'tenant_admin';
export const FILE_STORAGE_PROVIDERS = ['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp'] as const;
export const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export const CRON_JOB_STATUSES = ['enabled', 'disabled'] as const;
export const CRON_RUN_STATUSES = ['success', 'fail', 'running'] as const;
export const OAUTH_PROVIDERS = ['github', 'dingtalk', 'wechat_work'] as const;
export const BACKUP_TYPES = ['pg_dump', 'drizzle_export'] as const;
export const BACKUP_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export const BUSINESS_TYPES = ['announcement'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];
export const WORKFLOW_DEFINITION_STATUSES = ['draft', 'published', 'disabled'] as const;
export const WORKFLOW_INSTANCE_STATUSES = ['draft', 'running', 'approved', 'rejected', 'withdrawn'] as const;
export const WORKFLOW_TASK_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const;
export const WORKFLOW_NODE_TYPES = ['start', 'approve', 'end', 'exclusiveGateway', 'parallelGateway', 'ccNode'] as const;
export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;

/** 流程级「自动去重」三模式选项（同一审批人在流程中重复出现时） */
export const WORKFLOW_APPROVER_DEDUP_OPTIONS: ReadonlyArray<{ value: WorkflowApproverDedupMode; label: string }> = [
  { value: 'none',        label: '不自动通过' },
  { value: 'all',         label: '仅审批一次，后续重复的审批节点均自动通过' },
  { value: 'consecutive', label: '仅针对连续审批的节点自动通过' },
];

/**
 * 解析流程级「自动去重」模式，向后兼容旧布尔字段 autoApproveIfSameUser（true→all / false→none）。
 * 新流程在两者都缺省时默认 'all'（保持系统既有的「审批一次后续自动通过」行为）。
 */
export function resolveApproverDedupMode(
  settings: { approverDedupMode?: WorkflowApproverDedupMode; autoApproveIfSameUser?: boolean } | null | undefined,
): WorkflowApproverDedupMode {
  if (settings?.approverDedupMode) return settings.approverDedupMode;
  if (typeof settings?.autoApproveIfSameUser === 'boolean') {
    return settings.autoApproveIfSameUser ? 'all' : 'none';
  }
  return 'all';
}

/** 流程表单类型：designer=表单库可视化设计器，custom=用户自定义业务页面，external=业务系统主导（businessKey 关联） */
export const WORKFLOW_FORM_TYPES = ['designer', 'custom', 'external'] as const;
export type WorkflowFormType = typeof WORKFLOW_FORM_TYPES[number];
export const WORKFLOW_FORM_TYPE_LABELS: Record<WorkflowFormType, string> = {
  designer: '表单库设计器',
  custom: '自定义业务表单',
  external: '业务系统主导',
};

// OAuth2 服务端常量
export const OAUTH2_GRANT_TYPES = ['authorization_code', 'client_credentials', 'implicit', 'refresh_token'] as const;
export type OAuth2GrantType = typeof OAUTH2_GRANT_TYPES[number];

export const OAUTH2_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export type OAuth2Scope = typeof OAUTH2_SCOPES[number];

export const OAUTH2_SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '确认您的身份（用户 ID）',
  profile: '读取您的基本信息（昵称、头像）',
  email: '读取您的邮箱地址',
  offline_access: '允许在您离线时保持访问（续签令牌）',
};

export const OAUTH2_CODE_CHALLENGE_METHODS = ['S256', 'plain'] as const;
export type OAuth2CodeChallengeMethod = typeof OAUTH2_CODE_CHALLENGE_METHODS[number];

export const OAUTH2_TOKEN_EXPIRY = {
  accessToken: 2 * 60 * 60, // 2 小时（秒）
  refreshToken: 30 * 24 * 60 * 60, // 30 天（秒）
  authorizationCode: 10 * 60, // 10 分钟（秒）
} as const;

// ─── 支付中心 ────────────────────────────────────────────────────────
export const PAYMENT_CHANNELS = ['wechat', 'alipay'] as const;
export type PaymentChannel = typeof PAYMENT_CHANNELS[number];

export const PAYMENT_METHODS = [
  'wechat_native', 'wechat_jsapi', 'wechat_h5',
  'alipay_page', 'alipay_wap', 'alipay_app',
] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const PAYMENT_ORDER_STATUSES = ['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed'] as const;
export type PaymentOrderStatus = typeof PAYMENT_ORDER_STATUSES[number];

export const PAYMENT_REFUND_STATUSES = ['pending', 'processing', 'success', 'failed'] as const;
export type PaymentRefundStatus = typeof PAYMENT_REFUND_STATUSES[number];

/** 各支付方式所属渠道映射 */
export const PAYMENT_METHOD_CHANNEL: Record<PaymentMethod, PaymentChannel> = {
  wechat_native: 'wechat',
  wechat_jsapi: 'wechat',
  wechat_h5: 'wechat',
  alipay_page: 'alipay',
  alipay_wap: 'alipay',
  alipay_app: 'alipay',
};

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wechat_native: '微信扫码',
  wechat_jsapi: '微信 JSAPI',
  wechat_h5: '微信 H5',
  alipay_page: '支付宝电脑网站',
  alipay_wap: '支付宝手机网站',
  alipay_app: '支付宝 APP',
};

export const PAYMENT_ORDER_STATUS_LABELS: Record<PaymentOrderStatus, string> = {
  pending: '待支付',
  paying: '支付中',
  success: '支付成功',
  closed: '已关闭',
  refunding: '退款中',
  refunded: '已退款',
  failed: '支付失败',
};

export const PAYMENT_REFUND_STATUS_LABELS: Record<PaymentRefundStatus, string> = {
  pending: '待处理',
  processing: '退款中',
  success: '退款成功',
  failed: '退款失败',
};

// ─── 支付中心扩展 · A 档（退款审批 / 对账 / Webhook / 资金台账）────────────────
export const PAYMENT_REFUND_APPROVAL_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type PaymentRefundApprovalStatus = typeof PAYMENT_REFUND_APPROVAL_STATUSES[number];
export const PAYMENT_REFUND_APPROVAL_STATUS_LABELS: Record<PaymentRefundApprovalStatus, string> = {
  none: '无需审批', pending: '待审批', approved: '已批准', rejected: '已驳回',
};

export const PAYMENT_RECON_STATUSES = ['pending', 'comparing', 'done', 'failed'] as const;
export type PaymentReconStatus = typeof PAYMENT_RECON_STATUSES[number];
export const PAYMENT_RECON_STATUS_LABELS: Record<PaymentReconStatus, string> = {
  pending: '待对账', comparing: '比对中', done: '已完成', failed: '失败',
};

export const PAYMENT_RECON_RESULTS = ['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff'] as const;
export type PaymentReconResult = typeof PAYMENT_RECON_RESULTS[number];
export const PAYMENT_RECON_RESULT_LABELS: Record<PaymentReconResult, string> = {
  matched: '一致', local_only: '本地有渠道无', channel_only: '渠道有本地无', amount_diff: '金额不一致', status_diff: '状态不一致',
};

export const PAYMENT_WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed'] as const;
export type PaymentWebhookDeliveryStatus = typeof PAYMENT_WEBHOOK_DELIVERY_STATUSES[number];
export const PAYMENT_WEBHOOK_DELIVERY_STATUS_LABELS: Record<PaymentWebhookDeliveryStatus, string> = {
  pending: '待投递', success: '成功', failed: '失败',
};

export const PAYMENT_LEDGER_DIRECTIONS = ['in', 'out'] as const;
export type PaymentLedgerDirection = typeof PAYMENT_LEDGER_DIRECTIONS[number];
export const PAYMENT_LEDGER_DIRECTION_LABELS: Record<PaymentLedgerDirection, string> = {
  in: '收入', out: '支出',
};

export const PAYMENT_LEDGER_TYPES = ['payment', 'refund', 'fee', 'settlement', 'adjust'] as const;
export type PaymentLedgerType = typeof PAYMENT_LEDGER_TYPES[number];
export const PAYMENT_LEDGER_TYPE_LABELS: Record<PaymentLedgerType, string> = {
  payment: '收款', refund: '退款', fee: '手续费', settlement: '结算', adjust: '调整',
};

// ─── 支付中心扩展 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）──
export const PAYMENT_SETTLEMENT_STATUSES = ['pending', 'settling', 'settled', 'failed'] as const;
export type PaymentSettlementStatus = typeof PAYMENT_SETTLEMENT_STATUSES[number];
export const PAYMENT_SETTLEMENT_STATUS_LABELS: Record<PaymentSettlementStatus, string> = {
  pending: '待结算', settling: '结算中', settled: '已结算', failed: '结算失败',
};

export const PAYMENT_SHARING_RECEIVER_TYPES = ['merchant', 'personal'] as const;
export type PaymentSharingReceiverType = typeof PAYMENT_SHARING_RECEIVER_TYPES[number];
export const PAYMENT_SHARING_RECEIVER_TYPE_LABELS: Record<PaymentSharingReceiverType, string> = {
  merchant: '商户', personal: '个人',
};

export const PAYMENT_SHARING_ORDER_STATUSES = ['pending', 'processing', 'success', 'failed'] as const;
export type PaymentSharingOrderStatus = typeof PAYMENT_SHARING_ORDER_STATUSES[number];
export const PAYMENT_SHARING_ORDER_STATUS_LABELS: Record<PaymentSharingOrderStatus, string> = {
  pending: '待分账', processing: '分账中', success: '分账成功', failed: '分账失败',
};

export const PAYMENT_LINK_STATUSES = ['active', 'disabled', 'expired'] as const;
export type PaymentLinkStatus = typeof PAYMENT_LINK_STATUSES[number];
export const PAYMENT_LINK_STATUS_LABELS: Record<PaymentLinkStatus, string> = {
  active: '生效中', disabled: '已停用', expired: '已过期',
};

export const PAYMENT_RISK_SCOPES = ['global', 'channel', 'bizType'] as const;
export type PaymentRiskScope = typeof PAYMENT_RISK_SCOPES[number];
export const PAYMENT_RISK_SCOPE_LABELS: Record<PaymentRiskScope, string> = {
  global: '全局', channel: '按渠道', bizType: '按业务类型',
};

export const PAYMENT_REPORT_GROUP_BYS = ['bizType', 'channel', 'day'] as const;
export type PaymentReportGroupBy = typeof PAYMENT_REPORT_GROUP_BYS[number];
export const PAYMENT_REPORT_GROUP_BY_LABELS: Record<PaymentReportGroupBy, string> = {
  bizType: '业务类型', channel: '支付渠道', day: '按日',
};

// ─── 会员中心（Member Center）────────────────────────────────────────
/** 会员前台 token 的 localStorage key（与管理员 zenith_token 隔离）*/
export const MEMBER_TOKEN_KEY = 'zenith_member_token';
export const MEMBER_REFRESH_TOKEN_KEY = 'zenith_member_refresh_token';

export const MEMBER_STATUSES = ['active', 'inactive', 'banned'] as const;
export type MemberStatus = typeof MEMBER_STATUSES[number];

export const POINT_TX_TYPES = ['earn', 'redeem', 'expire', 'adjust', 'refund'] as const;
export type PointTxType = typeof POINT_TX_TYPES[number];

export const WALLET_TX_TYPES = ['recharge', 'consume', 'refund', 'adjust'] as const;
export type WalletTxType = typeof WALLET_TX_TYPES[number];

export const COUPON_TYPES = ['amount', 'percent'] as const;
export type CouponType = typeof COUPON_TYPES[number];

export const COUPON_VALID_TYPES = ['fixed', 'relative'] as const;
export type CouponValidType = typeof COUPON_VALID_TYPES[number];

export const COUPON_TEMPLATE_STATUSES = ['draft', 'active', 'paused', 'expired'] as const;
export type CouponTemplateStatus = typeof COUPON_TEMPLATE_STATUSES[number];

export const MEMBER_COUPON_STATUSES = ['unused', 'used', 'expired', 'frozen'] as const;
export type MemberCouponStatus = typeof MEMBER_COUPON_STATUSES[number];

export const MEMBER_REGISTER_SOURCES = ['web', 'h5', 'app', 'admin'] as const;
export type MemberRegisterSource = typeof MEMBER_REGISTER_SOURCES[number];

export const CHECKIN_MILESTONE_REWARD_TYPES = ['points', 'coupon'] as const;
export const CHECKIN_MILESTONE_REWARD_TYPE_LABELS: Record<typeof CHECKIN_MILESTONE_REWARD_TYPES[number], string> = {
  points: '积分',
  coupon: '优惠券',
};

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export const CHANNEL_TYPES = ['system', 'business'] as const;
export const CHANNEL_AUDIENCE_TYPES = ['broadcast', 'targeted'] as const;
export const CHANNEL_MESSAGE_TYPES = ['text', 'card', 'image', 'news'] as const;
export const CHANNEL_MESSAGE_STATUSES = ['sent', 'draft', 'scheduled'] as const;
export const CHANNEL_PUBLISH_AUDIENCE_MODES = ['all', 'users', 'departments', 'roles'] as const;
export const CHANNEL_SEND_MODES = ['now', 'scheduled', 'draft'] as const;
export const CHANNEL_MESSAGE_DIRECTIONS = ['out', 'in'] as const;
export const CHANNEL_MENU_TYPES = ['click', 'view'] as const;
export const CHANNEL_AUTO_REPLY_MATCH_TYPES = ['subscribe', 'keyword', 'default'] as const;
export const CHANNEL_AUTO_REPLY_KEYWORD_MODES = ['exact', 'contains'] as const;
export const CHANNEL_CONVERSATION_STATUSES = ['open', 'processing', 'resolved'] as const;
/** 内置「Zenith 助手」系统号 code（全局唯一、内置不可删、全员订阅） */
export const SYSTEM_CHANNEL_CODE = 'system-assistant';

export const CHANNEL_MENU_TYPE_LABELS: Record<(typeof CHANNEL_MENU_TYPES)[number], string> = {
  click: '点击关键词',
  view: '跳转链接',
};

export const CHANNEL_AUTO_REPLY_MATCH_LABELS: Record<(typeof CHANNEL_AUTO_REPLY_MATCH_TYPES)[number], string> = {
  subscribe: '关注欢迎语',
  keyword: '关键词回复',
  default: '默认兜底回复',
};

export const CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS: Record<(typeof CHANNEL_AUTO_REPLY_KEYWORD_MODES)[number], string> = {
  exact: '完全匹配',
  contains: '包含匹配',
};

export const CHANNEL_MESSAGE_TYPE_LABELS: Record<(typeof CHANNEL_MESSAGE_TYPES)[number], string> = {
  text: '文本',
  image: '图片',
  news: '图文',
  card: '卡片',
};

export const CHANNEL_MESSAGE_STATUS_LABELS: Record<(typeof CHANNEL_MESSAGE_STATUSES)[number], string> = {
  sent: '已发送',
  draft: '草稿',
  scheduled: '定时待发',
};

export const CHANNEL_PUBLISH_AUDIENCE_MODE_LABELS: Record<(typeof CHANNEL_PUBLISH_AUDIENCE_MODES)[number], string> = {
  all: '全体成员',
  users: '指定用户',
  departments: '按部门',
  roles: '按角色',
};

export const CHANNEL_SEND_MODE_LABELS: Record<(typeof CHANNEL_SEND_MODES)[number], string> = {
  now: '立即发送',
  scheduled: '定时发送',
  draft: '存草稿',
};

export const CHANNEL_CONVERSATION_STATUS_LABELS: Record<(typeof CHANNEL_CONVERSATION_STATUSES)[number], string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: '正常',
  inactive: '未激活',
  banned: '已封禁',
};

export const POINT_TX_TYPE_LABELS: Record<PointTxType, string> = {
  earn: '获得',
  redeem: '兑换消耗',
  expire: '过期',
  adjust: '调整',
  refund: '退还',
};

export const WALLET_TX_TYPE_LABELS: Record<WalletTxType, string> = {
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  adjust: '调整',
};

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  amount: '满减券',
  percent: '折扣券',
};

export const COUPON_TEMPLATE_STATUS_LABELS: Record<CouponTemplateStatus, string> = {
  draft: '草稿',
  active: '生效中',
  paused: '已暂停',
  expired: '已过期',
};

export const MEMBER_COUPON_STATUS_LABELS: Record<MemberCouponStatus, string> = {
  unused: '未使用',
  used: '已使用',
  expired: '已过期',
  frozen: '已冻结',
};
