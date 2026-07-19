import type {
  AnalyticsDeviceType,
  AnalyticsEnvironment,
  AnalyticsEventOverrideStatus,
  AnalyticsEventSource,
  AnalyticsCampaignChannel,
  AnalyticsCampaignStatus,
  AnalyticsExperimentStatus,
  AnalyticsIdentityType,
  InAppMessageType,
  MpBroadcastType,
  MpMaterialType,
  MpMessageType,
  MpReplyContentType,
  ReportAlertAggregate,
  ReportDeliveryStatus,
  ReportDeliveryTriggerType,
  ReportChatbiSessionStatus,
  ReportDatasourceType,
  ReportFieldType,
  ReportFillRecordStatus,
  ReportFillSyncStatus,
  ReportFillTemplateStatus,
  ReportScheduleMisfirePolicy,
  SendSource,
  SendStatus,
  SmsProvider,
  UserFeedbackCategory,
  UserFeedbackStatus,
  WorkflowApproveMethod,
  WorkflowApproverDedupMode,
} from './types';

export const API_PREFIX = '/api';
export const TOKEN_KEY = 'zenith_token';
export const REFRESH_TOKEN_KEY = 'zenith_refresh_token';
export const PREFERENCES_KEY = 'zenith_preferences';
export const TABS_STORAGE_KEY = 'zenith_tabs';
export const SOURCE_MAP_MAX_BYTES = 20 * 1024 * 1024;
export const ANALYTICS_PROPERTIES_MAX_BYTES = 16 * 1024;
export const ANALYTICS_CONTEXT_MAX_BYTES = 32 * 1024;
export const ANALYTICS_BREADCRUMB_DATA_MAX_BYTES = 4 * 1024;
/** 埋点配置版本号存储 key（localStorage），跨标签页广播采集配置已更新，触发其他标签重新拉取 */
export const ANALYTICS_CONFIG_VERSION_KEY = 'zenith_analytics_config_version';
export const USER_ROLES = ['admin', 'user'] as const;
export const USER_STATUSES = ['enabled', 'disabled'] as const;
/** 通用启用/禁用状态标签（与 common_status 字典种子文案一致；server 导出等无法走字典的场景使用） */
export const COMMON_STATUS_LABELS = { enabled: '启用', disabled: '禁用' } as const;
/** 通用启用/禁用下拉选项（与 COMMON_STATUS_LABELS 自动同步；行为中心事件覆盖/分群等复用） */
export const COMMON_STATUS_OPTIONS: Array<{ value: keyof typeof COMMON_STATUS_LABELS; label: string }> =
  (Object.keys(COMMON_STATUS_LABELS) as Array<keyof typeof COMMON_STATUS_LABELS>)
    .map((value) => ({ value, label: COMMON_STATUS_LABELS[value] }));
export const SUPER_ADMIN_CODE = 'super_admin';
export const TENANT_ADMIN_CODE = 'tenant_admin';
export const FILE_STORAGE_PROVIDERS = ['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp'] as const;
export const FILE_OBJECT_ACLS = ['default', 'private', 'public-read', 'public-read-write'] as const;
/**
 * 各 provider 支持的对象级读写权限（canned ACL）；default = 继承 Bucket（上传时不发送 ACL 参数）。
 * COS 对象级 ACL 无 public-read-write；BOS 对象级 ACL 仅 private / public-read。
 * 未列出的 provider（local/kodo/azure/sftp）不支持对象级 ACL。
 */
export const FILE_OBJECT_ACL_SUPPORT: Partial<Record<(typeof FILE_STORAGE_PROVIDERS)[number], readonly (typeof FILE_OBJECT_ACLS)[number][]>> = {
  oss: ['default', 'private', 'public-read', 'public-read-write'],
  s3: ['default', 'private', 'public-read', 'public-read-write'],
  cos: ['default', 'private', 'public-read'],
  obs: ['default', 'private', 'public-read', 'public-read-write'],
  bos: ['default', 'private', 'public-read'],
};

/** 文件访问 URL 策略：proxy=服务端代理（兜底）；public=永久公开直链；presigned=临时签名直链 */
export const FILE_URL_STRATEGIES = ['proxy', 'public', 'presigned'] as const;

export const FILE_URL_STRATEGY_LABELS: Record<(typeof FILE_URL_STRATEGIES)[number], string> = {
  proxy: '服务端代理',
  public: '公开直链',
  presigned: '临时签名直链',
};

export const FILE_URL_STRATEGY_OPTIONS: Array<{ value: (typeof FILE_URL_STRATEGIES)[number]; label: string }> =
  FILE_URL_STRATEGIES.map((value) => ({ value, label: FILE_URL_STRATEGY_LABELS[value] }));

/** 临时签名有效期（秒）：默认 30 分钟，限制在 1 分钟 ~ 7 天（S3 SigV4 上限） */
export const PRESIGNED_EXPIRY_DEFAULT_SECONDS = 1800;
export const PRESIGNED_EXPIRY_MIN_SECONDS = 60;
export const PRESIGNED_EXPIRY_MAX_SECONDS = 604_800;

/** 存储提供方展示名（配置页/文件管理/统计面板统一复用） */
export const FILE_STORAGE_PROVIDER_LABELS: Record<(typeof FILE_STORAGE_PROVIDERS)[number], string> = {
  local: '本地磁盘',
  oss: '阿里云 OSS',
  s3: 'S3 兼容存储',
  cos: '腾讯云 COS',
  obs: '华为云 OBS',
  kodo: '七牛云 Kodo',
  bos: '百度云 BOS',
  azure: 'Azure Blob',
  sftp: 'SFTP',
};

/** 存储提供方下拉选项（与 FILE_STORAGE_PROVIDER_LABELS 自动同步） */
export const FILE_STORAGE_PROVIDER_OPTIONS: Array<{ value: (typeof FILE_STORAGE_PROVIDERS)[number]; label: string }> =
  FILE_STORAGE_PROVIDERS.map((value) => ({ value, label: FILE_STORAGE_PROVIDER_LABELS[value] }));
export const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export const CRON_JOB_STATUSES = ['enabled', 'disabled'] as const;
export const CRON_RUN_STATUSES = ['success', 'fail', 'running'] as const;
/** 定时任务执行状态标签（列表页/仪表盘统一复用） */
export const CRON_RUN_STATUS_LABELS: Record<(typeof CRON_RUN_STATUSES)[number], string> = {
  success: '成功',
  fail: '失败',
  running: '运行中',
};
export const OAUTH_PROVIDERS = ['github', 'dingtalk', 'wechat_work'] as const;
export type OAuthProviderType = (typeof OAUTH_PROVIDERS)[number];

export const AI_PROVIDER_TYPES = ['openai_compatible', 'anthropic', 'gemini', 'baidu'] as const;
export type AiProvider = (typeof AI_PROVIDER_TYPES)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

export const AI_PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string }> =
  AI_PROVIDER_TYPES.map((value) => ({ value, label: AI_PROVIDER_LABELS[value] }));

export const AI_AGENT_STATUSES = ['private', 'pending', 'published', 'rejected'] as const;
export type AiAgentStatus = (typeof AI_AGENT_STATUSES)[number];

export const AI_AGENT_STATUS_LABELS: Record<AiAgentStatus, string> = {
  private: '私有',
  pending: '待审核',
  published: '已上架',
  rejected: '已驳回',
};
export const BACKUP_TYPES = ['pg_dump', 'drizzle_export'] as const;
export const BACKUP_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export const BUSINESS_TYPES = ['announcement'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];
export const WORKFLOW_DEFINITION_STATUSES = ['draft', 'published', 'disabled'] as const;
export const WORKFLOW_INSTANCE_STATUSES = ['draft', 'running', 'suspended', 'approved', 'rejected', 'withdrawn', 'cancelled'] as const;
/** 活跃（非终态）实例状态：业务键（bizType+bizId）唯一约束仅作用于这些状态，终态后允许同一业务记录重新发起 */
export const WORKFLOW_ACTIVE_INSTANCE_STATUSES = ['draft', 'running', 'suspended'] as const;
export const WORKFLOW_TASK_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const;
export const WORKFLOW_NODE_TYPES = ['start', 'approve', 'end', 'exclusiveGateway', 'parallelGateway', 'ccNode'] as const;
export const WORKFLOW_CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;

/**
 * 流程定义 flowData 的 schema 版本（引擎 schema 版本，区别于用户发布版本号 `version`）。
 * 作为单一真源用于：导出 JSON 标记、导入/发布时的运行时兼容迁移（normalizeFlowData）。
 * 未来引擎 schema 变更（重命名字段 / 合并枚举 / 补默认值等）时 +1，并在 normalizeFlowData 追加 upcast。
 */
export const WORKFLOW_SCHEMA_VERSION = 1;

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

export const WORKFLOW_APPROVE_METHOD_LABELS: Record<WorkflowApproveMethod, string>
  & Record<string, string> = {
  or: '或签',
  and: '会签',
  sequential: '顺序会签',
  ratio: '比例会签',
  random: '随机一人',
  auto: '自动通过',
};

export const WORKFLOW_APPROVE_METHOD_OPTIONS: Array<{
  value: WorkflowApproveMethod;
  label: string;
}> = (Object.keys(WORKFLOW_APPROVE_METHOD_LABELS) as WorkflowApproveMethod[])
  .map((value) => ({ value, label: WORKFLOW_APPROVE_METHOD_LABELS[value] }));

/** 流程实例状态标签（web 各视图 / server 分析导出统一复用；Tag 颜色见 web workflow-runtime.ts） */
export const WORKFLOW_INSTANCE_STATUS_LABELS = {
  draft: '草稿',
  running: '审批中',
  suspended: '已挂起',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  cancelled: '已取消',
} as const;

/** 审批任务状态标签 */
export const WORKFLOW_TASK_STATUS_LABELS = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
  waiting: '等待中',
} as const;

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

export const OAUTH2_SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '确认您的身份（用户 ID）',
  profile: '读取您的基本信息（昵称、头像）',
  email: '读取您的邮箱地址',
  offline_access: '允许在您离线时保持访问（续签令牌）',
};

export const OAUTH2_CODE_CHALLENGE_METHODS = ['S256'] as const;
export type OAuth2CodeChallengeMethod = typeof OAUTH2_CODE_CHALLENGE_METHODS[number];

export const OPEN_APP_ENVIRONMENTS = ['production', 'sandbox'] as const;
export type OpenAppEnvironment = typeof OPEN_APP_ENVIRONMENTS[number];
export const OPEN_APP_ENVIRONMENT_LABELS: Record<OpenAppEnvironment, string> = {
  production: '生产环境',
  sandbox: '沙箱环境',
};

export const OPEN_APP_REVIEW_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export type OpenAppReviewStatus = typeof OPEN_APP_REVIEW_STATUSES[number];
export const OPEN_APP_REVIEW_STATUS_LABELS: Record<OpenAppReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export const OAUTH2_TOKEN_EXPIRY = {
  accessToken: 2 * 60 * 60, // 2 小时（秒）
  refreshToken: 30 * 24 * 60 * 60, // 30 天（秒）
  authorizationCode: 10 * 60, // 10 分钟（秒）
} as const;

// ─── 支付中心 ────────────────────────────────────────────────────────
export const PAYMENT_CHANNELS = ['wechat', 'alipay', 'unionpay'] as const;
export type PaymentChannel = typeof PAYMENT_CHANNELS[number];

export const PAYMENT_METHODS = [
  'wechat_native', 'wechat_jsapi', 'wechat_h5',
  'alipay_page', 'alipay_wap', 'alipay_app',
  'unionpay_qr',
  'wechat_papay', 'alipay_cycle',
  'wechat_preauth', 'alipay_preauth',
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
  unionpay_qr: 'unionpay',
  wechat_papay: 'wechat',
  alipay_cycle: 'alipay',
  wechat_preauth: 'wechat',
  alipay_preauth: 'alipay',
};

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  unionpay: '云闪付',
};

/** 支付渠道下拉选项（筛选/表单统一复用，与 PAYMENT_CHANNEL_LABELS 自动同步） */
export const PAYMENT_CHANNEL_OPTIONS: Array<{ value: PaymentChannel; label: string }> =
  PAYMENT_CHANNELS.map((value) => ({ value, label: PAYMENT_CHANNEL_LABELS[value] }));

// ─── 通知/告警渠道 ────────────────────────────────────────────────────
/**
 * 通知渠道统一文案（站内信/邮件/Webhook）。
 * 注意：report 域后端 value 为驼峰 `inApp`（历史枚举），label 仍统一复用此处，
 * 渲染时可用 `value.toLowerCase()` 归一后查表。
 */
export const NOTIFY_CHANNEL_LABELS = {
  inapp: '站内信',
  email: '邮件',
  webhook: 'Webhook',
} as const;

export type NotifyChannel = keyof typeof NOTIFY_CHANNEL_LABELS;

/** 通知渠道下拉选项（与 NOTIFY_CHANNEL_LABELS 自动同步） */
export const NOTIFY_CHANNEL_OPTIONS: Array<{ value: NotifyChannel; label: string }> =
  (Object.keys(NOTIFY_CHANNEL_LABELS) as NotifyChannel[]).map((value) => ({ value, label: NOTIFY_CHANNEL_LABELS[value] }));

export const REPORT_DASHBOARD_LIFECYCLE_STATUSES = ['draft', 'published', 'offline'] as const;
export const REPORT_DASHBOARD_LIFECYCLE_LABELS = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
} as const;

export const REPORT_DASHBOARD_VERSION_SOURCES = ['manual', 'publish', 'restore_backup'] as const;
export const REPORT_DASHBOARD_VERSION_SOURCE_LABELS = {
  manual: '手动快照',
  publish: '发布快照',
  restore_backup: '恢复前备份',
} as const;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wechat_native: '微信扫码',
  wechat_jsapi: '微信 JSAPI',
  wechat_h5: '微信 H5',
  alipay_page: '支付宝电脑网站',
  alipay_wap: '支付宝手机网站',
  alipay_app: '支付宝 APP',
  unionpay_qr: '云闪付扫码',
  wechat_papay: '微信委托代扣',
  alipay_cycle: '支付宝周期扣款',
  wechat_preauth: '微信预授权转支付',
  alipay_preauth: '支付宝预授权转支付',
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

export const PAYMENT_RECON_HANDLE_STATUSES = ['pending', 'adjusted', 'suspended', 'ignored'] as const;
export type PaymentReconHandleStatus = typeof PAYMENT_RECON_HANDLE_STATUSES[number];
export const PAYMENT_RECON_HANDLE_STATUS_LABELS: Record<PaymentReconHandleStatus, string> = {
  pending: '待处理', adjusted: '已调账', suspended: '挂账', ignored: '已忽略',
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

export const PAYMENT_LEDGER_TYPES = ['payment', 'refund', 'fee', 'settlement', 'adjust', 'transfer'] as const;
export type PaymentLedgerType = typeof PAYMENT_LEDGER_TYPES[number];
export const PAYMENT_LEDGER_TYPE_LABELS: Record<PaymentLedgerType, string> = {
  payment: '收款', refund: '退款', fee: '手续费', settlement: '结算', adjust: '调整', transfer: '转账',
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

export const PAYMENT_RISK_ACTIONS = ['block', 'review'] as const;
export type PaymentRiskAction = typeof PAYMENT_RISK_ACTIONS[number];
export const PAYMENT_RISK_ACTION_LABELS: Record<PaymentRiskAction, string> = {
  block: '直接拦截', review: '人工审核',
};

export const PAYMENT_RISK_DIMENSIONS = ['blocklist', 'single_limit', 'daily_limit', 'daily_count'] as const;
export type PaymentRiskDimension = typeof PAYMENT_RISK_DIMENSIONS[number];
export const PAYMENT_RISK_DIMENSION_LABELS: Record<PaymentRiskDimension, string> = {
  blocklist: '黑名单', single_limit: '单笔限额', daily_limit: '当日累计金额', daily_count: '当日交易笔数',
};

export const PAYMENT_RISK_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PaymentRiskReviewStatus = typeof PAYMENT_RISK_REVIEW_STATUSES[number];
export const PAYMENT_RISK_REVIEW_STATUS_LABELS: Record<PaymentRiskReviewStatus, string> = {
  pending: '待审核', approved: '已放行', rejected: '已拒绝',
};

export const PAYMENT_TRANSFER_STATUSES = ['pending', 'processing', 'success', 'failed'] as const;
export type PaymentTransferStatus = typeof PAYMENT_TRANSFER_STATUSES[number];
export const PAYMENT_TRANSFER_STATUS_LABELS: Record<PaymentTransferStatus, string> = {
  pending: '待发起', processing: '处理中', success: '转账成功', failed: '转账失败',
};

export const PAYMENT_REPORT_GROUP_BYS = ['bizType', 'channel', 'day'] as const;
export type PaymentReportGroupBy = typeof PAYMENT_REPORT_GROUP_BYS[number];
export const PAYMENT_REPORT_GROUP_BY_LABELS: Record<PaymentReportGroupBy, string> = {
  bizType: '业务类型', channel: '支付渠道', day: '按日',
};

// ─── 支付中心扩展 · 签约代扣（周期扣款/订阅）───────────────────────────
export const PAYMENT_DEDUCT_PERIODS = ['daily', 'weekly', 'monthly', 'custom'] as const;
export type PaymentDeductPeriod = typeof PAYMENT_DEDUCT_PERIODS[number];
export const PAYMENT_DEDUCT_PERIOD_LABELS: Record<PaymentDeductPeriod, string> = {
  daily: '每日', weekly: '每周', monthly: '每月', custom: '自定义天数',
};
export const PAYMENT_DEDUCT_PERIOD_OPTIONS: Array<{ value: PaymentDeductPeriod; label: string }> =
  PAYMENT_DEDUCT_PERIODS.map((value) => ({ value, label: PAYMENT_DEDUCT_PERIOD_LABELS[value] }));

export const PAYMENT_CONTRACT_STATUSES = ['pending', 'signed', 'paused', 'terminated'] as const;
export type PaymentContractStatus = typeof PAYMENT_CONTRACT_STATUSES[number];
export const PAYMENT_CONTRACT_STATUS_LABELS: Record<PaymentContractStatus, string> = {
  pending: '签约中', signed: '已签约', paused: '已暂停', terminated: '已解约',
};

/** 支持签约代扣的支付方式（服务端发起扣款，无用户交互） */
export const PAYMENT_DEDUCT_METHODS = ['wechat_papay', 'alipay_cycle'] as const satisfies readonly PaymentMethod[];
export type PaymentDeductMethod = typeof PAYMENT_DEDUCT_METHODS[number];

/** 收银台可选支付方式（用户主动支付，不含服务端发起的签约代扣方式） */
export const PAYMENT_CASHIER_METHODS = [
  'wechat_native', 'wechat_jsapi', 'wechat_h5',
  'alipay_page', 'alipay_wap', 'alipay_app',
  'unionpay_qr',
] as const satisfies readonly PaymentMethod[];
export type PaymentCashierMethod = typeof PAYMENT_CASHIER_METHODS[number];

/** 会员自动续费业务类型（签约协议与扣款单共用） */
export const MEMBER_RENEWAL_BIZ_TYPE = 'member_renewal';

// ─── 支付中心扩展 · 交易投诉/争议 ─────────────────────────────────────
export const PAYMENT_DISPUTE_TYPES = ['refund_request', 'service_issue', 'fraud_report', 'other'] as const;
export type PaymentDisputeType = typeof PAYMENT_DISPUTE_TYPES[number];
export const PAYMENT_DISPUTE_TYPE_LABELS: Record<PaymentDisputeType, string> = {
  refund_request: '退款诉求', service_issue: '服务问题', fraud_report: '欺诈举报', other: '其他',
};
export const PAYMENT_DISPUTE_TYPE_OPTIONS: Array<{ value: PaymentDisputeType; label: string }> =
  PAYMENT_DISPUTE_TYPES.map((value) => ({ value, label: PAYMENT_DISPUTE_TYPE_LABELS[value] }));

export const PAYMENT_DISPUTE_STATUSES = ['pending', 'processing', 'resolved', 'refunded'] as const;
export type PaymentDisputeStatus = typeof PAYMENT_DISPUTE_STATUSES[number];
export const PAYMENT_DISPUTE_STATUS_LABELS: Record<PaymentDisputeStatus, string> = {
  pending: '待处理', processing: '处理中', resolved: '已完结', refunded: '已退款',
};
export const PAYMENT_DISPUTE_STATUS_OPTIONS: Array<{ value: PaymentDisputeStatus; label: string }> =
  PAYMENT_DISPUTE_STATUSES.map((value) => ({ value, label: PAYMENT_DISPUTE_STATUS_LABELS[value] }));

// ─── 支付中心扩展 · 预授权（资金冻结/解冻/转支付）────────────────────
export const PAYMENT_PREAUTH_STATUSES = ['pending', 'frozen', 'captured', 'released', 'failed'] as const;
export type PaymentPreauthStatus = typeof PAYMENT_PREAUTH_STATUSES[number];
export const PAYMENT_PREAUTH_STATUS_LABELS: Record<PaymentPreauthStatus, string> = {
  pending: '冻结中', frozen: '已冻结', captured: '已转支付', released: '已解冻', failed: '冻结失败',
};
export const PAYMENT_PREAUTH_STATUS_OPTIONS: Array<{ value: PaymentPreauthStatus; label: string }> =
  PAYMENT_PREAUTH_STATUSES.map((value) => ({ value, label: PAYMENT_PREAUTH_STATUS_LABELS[value] }));

/** 预授权支持的支付方式（渠道映射用） */
export const PAYMENT_PREAUTH_METHODS = ['wechat_preauth', 'alipay_preauth'] as const satisfies readonly PaymentMethod[];
export type PaymentPreauthMethod = typeof PAYMENT_PREAUTH_METHODS[number];

// ─── 会员中心（Member Center）────────────────────────────────────────
/** 会员前台 token 的 localStorage key（与管理员 zenith_token 隔离）*/
export const MEMBER_TOKEN_KEY = 'zenith_member_token';
export const MEMBER_REFRESH_TOKEN_KEY = 'zenith_member_refresh_token';

/**
 * 会员前台体验分析（埋点）同意状态的 localStorage key 与版本号。
 * 版本号变更（如隐私政策调整）会使历史存量同意状态失效，强制重新征求同意。
 */
export const MEMBER_ANALYTICS_CONSENT_KEY = 'zenith_member_analytics_consent';
export const MEMBER_ANALYTICS_CONSENT_VERSION = 1;

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

export const OPEN_WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'retrying'] as const;
export type OpenWebhookDeliveryStatus = (typeof OPEN_WEBHOOK_DELIVERY_STATUSES)[number];

export const OPEN_WEBHOOK_DELIVERY_STATUS_LABELS: Record<OpenWebhookDeliveryStatus, string> = {
  pending: '投递中',
  success: '成功',
  failed: '失败',
  retrying: '重试中',
};

/** 可订阅的开放平台事件类型 */
export const OPEN_WEBHOOK_EVENTS = ['app.test', 'app.call.failed', 'app.quota.warning', 'app.quota.exceeded', 'app.scope.denied'] as const;
export type OpenWebhookEvent = (typeof OPEN_WEBHOOK_EVENTS)[number];

export const OPEN_WEBHOOK_EVENT_LABELS: Record<string, string> = {
  'app.test': '测试事件',
  'app.call.failed': '调用失败',
  'app.quota.exceeded': '配额超限',
  'app.quota.warning': '配额预警',
  'app.scope.denied': 'Scope 未授权',
};

/** Webhook 投递签名请求头 */
export const OPEN_WEBHOOK_SIGNATURE_HEADER = 'X-Zenith-Signature';
/** 阶梯重试间隔（分钟） */
export const OPEN_WEBHOOK_RETRY_STAGES_MINUTES = [1, 5, 30, 180, 720] as const;

/** 地区层级标签（regions 前端页面 / server 导出统一复用） */
export const REGION_LEVEL_LABELS = {
  province: '省级',
  city: '地级',
  county: '县级',
} as const;

// ─── 意见反馈 ────────────────────────────────────────────────────────
export const USER_FEEDBACK_CATEGORY_LABELS: Record<UserFeedbackCategory, string> = {
  suggestion: '功能建议',
  bug: '问题反馈',
  ux: '体验问题',
  other: '其他',
};

export const USER_FEEDBACK_STATUS_LABELS: Record<UserFeedbackStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  ignored: '已忽略',
};

// ─── 消息与短信 ────────────────────────────────────────────────────────
export const SMS_PROVIDER_LABELS: Record<SmsProvider, string> = {
  aliyun: '阿里云',
  tencent: '腾讯云',
};

export const SMS_PROVIDER_OPTIONS: Array<{ value: SmsProvider; label: string }> =
  (Object.keys(SMS_PROVIDER_LABELS) as SmsProvider[])
    .map((value) => ({ value, label: SMS_PROVIDER_LABELS[value] }));

export const SEND_STATUS_LABELS: Record<SendStatus, string> = {
  pending: '待发送',
  success: '已发送',
  failed: '失败',
};

export const SEND_STATUS_OPTIONS: Array<{ value: SendStatus; label: string }> =
  (Object.keys(SEND_STATUS_LABELS) as SendStatus[])
    .map((value) => ({ value, label: SEND_STATUS_LABELS[value] }));

export const SEND_SOURCE_LABELS: Record<SendSource, string> = {
  manual: '手动',
  test: '测试',
  system: '系统',
  api: 'API',
};

export const SEND_SOURCE_OPTIONS: Array<{ value: SendSource; label: string }> =
  (Object.keys(SEND_SOURCE_LABELS) as SendSource[])
    .map((value) => ({ value, label: SEND_SOURCE_LABELS[value] }));

export const IN_APP_MESSAGE_TYPE_LABELS: Record<InAppMessageType, string> = {
  info: '通知',
  success: '成功',
  warning: '警告',
  error: '错误',
};

export const IN_APP_MESSAGE_TYPE_OPTIONS: Array<{ value: InAppMessageType; label: string }> =
  (Object.keys(IN_APP_MESSAGE_TYPE_LABELS) as InAppMessageType[])
    .map((value) => ({ value, label: IN_APP_MESSAGE_TYPE_LABELS[value] }));

// ─── 公众号媒体类型 ────────────────────────────────────────────────────
export const MP_REPLY_CONTENT_TYPE_LABELS: Record<MpReplyContentType, string> = {
  text: '文本',
  image: '图片',
  voice: '语音',
  video: '视频',
  news: '图文',
};

export const MP_REPLY_CONTENT_TYPE_OPTIONS: Array<{ value: MpReplyContentType; label: string }> =
  (Object.keys(MP_REPLY_CONTENT_TYPE_LABELS) as MpReplyContentType[])
    .map((value) => ({ value, label: MP_REPLY_CONTENT_TYPE_LABELS[value] }));

export const MP_BROADCAST_TYPE_LABELS: Record<MpBroadcastType, string> = {
  text: '文本',
  image: '图片',
  mpnews: '图文',
};

export const MP_BROADCAST_TYPE_OPTIONS: Array<{ value: MpBroadcastType; label: string }> =
  (Object.keys(MP_BROADCAST_TYPE_LABELS) as MpBroadcastType[])
    .map((value) => ({ value, label: MP_BROADCAST_TYPE_LABELS[value] }));

export const MP_MATERIAL_TYPE_LABELS: Record<MpMaterialType, string> = {
  image: '图片',
  voice: '语音',
  video: '视频',
  thumb: '缩略图',
};

export const MP_MATERIAL_TYPE_OPTIONS: Array<{ value: MpMaterialType; label: string }> =
  (Object.keys(MP_MATERIAL_TYPE_LABELS) as MpMaterialType[])
    .map((value) => ({ value, label: MP_MATERIAL_TYPE_LABELS[value] }));

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

export const ANALYTICS_SITE_KEY_HEADER = 'X-Analytics-Site-Key';
export const ANALYTICS_EXPERIMENT_EXPOSURE_EVENT = '$experiment_exposure';

// ─── 数据分析与报表 ────────────────────────────────────────────────────
export const ANALYTICS_DEVICE_TYPE_LABELS: Record<AnalyticsDeviceType, string> = {
  desktop: '桌面端',
  mobile: '移动端',
  tablet: '平板',
  bot: '爬虫/机器人',
  unknown: '未知',
};

export const ANALYTICS_DEVICE_TYPE_OPTIONS: Array<{ value: AnalyticsDeviceType; label: string }> =
  (Object.keys(ANALYTICS_DEVICE_TYPE_LABELS) as AnalyticsDeviceType[])
    .map((value) => ({ value, label: ANALYTICS_DEVICE_TYPE_LABELS[value] }));

// ─── 行为中心阶段 1：多端来源 / 环境 / 身份归属 ────────────────────────────────
export const ANALYTICS_EVENT_SOURCES: readonly AnalyticsEventSource[] = ['web_admin', 'web_member', 'server'] as const;
export const ANALYTICS_EVENT_SOURCE_LABELS: Record<AnalyticsEventSource, string> = {
  web_admin: '后台管理端',
  web_member: '会员前台',
  server: '服务端',
};
export const ANALYTICS_EVENT_SOURCE_OPTIONS: Array<{ value: AnalyticsEventSource; label: string }> =
  ANALYTICS_EVENT_SOURCES.map((value) => ({ value, label: ANALYTICS_EVENT_SOURCE_LABELS[value] }));

export const ANALYTICS_ENVIRONMENTS: readonly AnalyticsEnvironment[] = ['production', 'staging', 'development'] as const;
export const ANALYTICS_ENVIRONMENT_LABELS: Record<AnalyticsEnvironment, string> = {
  production: '生产环境',
  staging: '预发环境',
  development: '开发环境',
};
export const ANALYTICS_ENVIRONMENT_OPTIONS: Array<{ value: AnalyticsEnvironment; label: string }> =
  ANALYTICS_ENVIRONMENTS.map((value) => ({ value, label: ANALYTICS_ENVIRONMENT_LABELS[value] }));

export const ANALYTICS_IDENTITY_TYPES: readonly AnalyticsIdentityType[] = ['admin', 'member', 'anonymous'] as const;
export const ANALYTICS_IDENTITY_TYPE_LABELS: Record<AnalyticsIdentityType, string> = {
  admin: '后台管理员',
  member: '前台会员',
  anonymous: '匿名访客',
};
export const ANALYTICS_IDENTITY_TYPE_OPTIONS: Array<{ value: AnalyticsIdentityType; label: string }> =
  ANALYTICS_IDENTITY_TYPES.map((value) => ({ value, label: ANALYTICS_IDENTITY_TYPE_LABELS[value] }));

/** 事件覆盖 / 分群状态标签（enabled|disabled，与 COMMON_STATUS_LABELS 同源） */
export const ANALYTICS_EVENT_OVERRIDE_STATUS_LABELS: Record<AnalyticsEventOverrideStatus, string> = COMMON_STATUS_LABELS;
export const ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS: Array<{ value: AnalyticsEventOverrideStatus; label: string }> =
  COMMON_STATUS_OPTIONS;

export const ANALYTICS_QUALITY_ISSUE_TYPES = ['missing_required', 'type_mismatch', 'invalid_enum', 'event_disabled', 'origin_rejected', 'quota_exceeded'] as const;
export const ANALYTICS_QUALITY_ISSUE_TYPE_LABELS: Record<(typeof ANALYTICS_QUALITY_ISSUE_TYPES)[number], string> = {
  missing_required: '缺失必填属性',
  type_mismatch: '属性类型不匹配',
  invalid_enum: '枚举取值非法',
  event_disabled: '事件已禁用',
  origin_rejected: '来源被拒绝',
  quota_exceeded: '站点配额超限',
};
export const ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS: Array<{ value: (typeof ANALYTICS_QUALITY_ISSUE_TYPES)[number]; label: string }> =
  ANALYTICS_QUALITY_ISSUE_TYPES.map((value) => ({ value, label: ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[value] }));

export const ANALYTICS_EVENT_PROPERTY_TYPES = ['string', 'number', 'boolean', 'datetime', 'object', 'array'] as const;
export const ANALYTICS_EVENT_PROPERTY_TYPE_LABELS: Record<(typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number], string> = {
  string: '字符串',
  number: '数字',
  boolean: '布尔值',
  datetime: '日期时间',
  object: '对象',
  array: '数组',
};
export const ANALYTICS_EVENT_PROPERTY_TYPE_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number]; label: string }> =
  ANALYTICS_EVENT_PROPERTY_TYPES.map((value) => ({ value, label: ANALYTICS_EVENT_PROPERTY_TYPE_LABELS[value] }));

export const ANALYTICS_SEGMENT_COMPARE_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export const ANALYTICS_SEGMENT_COMPARE_OP_LABELS: Record<(typeof ANALYTICS_SEGMENT_COMPARE_OPS)[number], string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '属于',
};
export const ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS: Array<{ value: (typeof ANALYTICS_SEGMENT_COMPARE_OPS)[number]; label: string }> =
  ANALYTICS_SEGMENT_COMPARE_OPS.map((value) => ({ value, label: ANALYTICS_SEGMENT_COMPARE_OP_LABELS[value] }));

export const ANALYTICS_EXPERIMENT_STATUSES: readonly AnalyticsExperimentStatus[] = ['draft', 'running', 'paused', 'completed'] as const;
export const ANALYTICS_EXPERIMENT_STATUS_LABELS: Record<AnalyticsExperimentStatus, string> = {
  draft: '草稿',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
};
export const ANALYTICS_EXPERIMENT_STATUS_OPTIONS: Array<{ value: AnalyticsExperimentStatus; label: string }> =
  ANALYTICS_EXPERIMENT_STATUSES.map((value) => ({ value, label: ANALYTICS_EXPERIMENT_STATUS_LABELS[value] }));

export const ANALYTICS_CAMPAIGN_CHANNELS: readonly AnalyticsCampaignChannel[] = ['email', 'in_app', 'webhook'] as const;
export const ANALYTICS_CAMPAIGN_CHANNEL_LABELS: Record<AnalyticsCampaignChannel, string> = {
  email: '邮件',
  in_app: '站内信',
  webhook: 'Webhook',
};
export const ANALYTICS_CAMPAIGN_CHANNEL_OPTIONS: Array<{ value: AnalyticsCampaignChannel; label: string }> =
  ANALYTICS_CAMPAIGN_CHANNELS.map((value) => ({ value, label: ANALYTICS_CAMPAIGN_CHANNEL_LABELS[value] }));

export const ANALYTICS_CAMPAIGN_STATUSES: readonly AnalyticsCampaignStatus[] = ['draft', 'running', 'completed', 'failed'] as const;
export const ANALYTICS_CAMPAIGN_STATUS_LABELS: Record<AnalyticsCampaignStatus, string> = {
  draft: '草稿',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
};
export const ANALYTICS_CAMPAIGN_STATUS_OPTIONS: Array<{ value: AnalyticsCampaignStatus; label: string }> =
  ANALYTICS_CAMPAIGN_STATUSES.map((value) => ({ value, label: ANALYTICS_CAMPAIGN_STATUS_LABELS[value] }));

// ─── 行为中心阶段 1：通用事件分析工作台 ────────────────────────────────────────
export const ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS = [
  'date', 'eventName', 'pagePath', 'source', 'appId', 'environment', 'browser', 'os', 'deviceType', 'region',
] as const;
export const ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS: Record<(typeof ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS)[number], string> = {
  date: '日期',
  eventName: '事件名称',
  pagePath: '页面路径',
  source: '来源端',
  appId: '应用',
  environment: '环境',
  browser: '浏览器',
  os: '操作系统',
  deviceType: '设备类型',
  region: '地区',
};
export const ANALYTICS_EVENT_QUERY_GROUP_BY_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS)[number]; label: string }> =
  ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS.map((value) => ({ value, label: ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS[value] }));

export const ANALYTICS_EVENT_QUERY_METRICS = ['events', 'uv'] as const;
export const ANALYTICS_EVENT_QUERY_METRIC_LABELS: Record<(typeof ANALYTICS_EVENT_QUERY_METRICS)[number], string> = {
  events: '事件次数',
  uv: '去重用户数',
};
export const ANALYTICS_EVENT_QUERY_METRIC_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_QUERY_METRICS)[number]; label: string }> =
  ANALYTICS_EVENT_QUERY_METRICS.map((value) => ({ value, label: ANALYTICS_EVENT_QUERY_METRIC_LABELS[value] }));

// ─── 行为中心阶段 1：留存双口径 ────────────────────────────────────────────────
export const ANALYTICS_RETENTION_MODES = ['first_seen', 'window_first'] as const;
export const ANALYTICS_RETENTION_MODE_LABELS: Record<(typeof ANALYTICS_RETENTION_MODES)[number], string> = {
  first_seen: '真实首访（全历史）',
  window_first: '窗口内首现',
};
export const ANALYTICS_RETENTION_MODE_OPTIONS: Array<{ value: (typeof ANALYTICS_RETENTION_MODES)[number]; label: string }> =
  ANALYTICS_RETENTION_MODES.map((value) => ({ value, label: ANALYTICS_RETENTION_MODE_LABELS[value] }));

// ─── 行为中心阶段 1：服务端权威语义事件（首批：支付 / 工作流 / 会员关键操作）──────
// 命名约定：与来源事件总线类型同名（支付）或加 `workflow.` 前缀（工作流），会员业务事件用 `member.<域>.<动作>`。
// 业务域只应引用这些常量拼装 eventName，禁止裸字符串拼写，避免事件字典与实际上报口径漂移。
export const ANALYTICS_SERVER_PAYMENT_EVENT_NAMES = [
  'payment.succeeded', 'payment.closed', 'payment.failed', 'refund.succeeded', 'refund.failed',
] as const;

export const ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES = [
  'workflow.instance.created', 'workflow.instance.approved', 'workflow.instance.rejected', 'workflow.instance.withdrawn',
  'workflow.node.entered', 'workflow.node.left',
  'workflow.task.created', 'workflow.task.assigned', 'workflow.task.approved', 'workflow.task.rejected',
  'workflow.task.skipped', 'workflow.task.transferred', 'workflow.task.addSigned', 'workflow.task.reduceSigned', 'workflow.task.urged',
] as const;

export const ANALYTICS_SERVER_MEMBER_EVENT_NAMES = [
  'member.registered', 'member.profile.updated',
  'member.points.earned', 'member.points.redeemed', 'member.points.adjusted', 'member.points.expired', 'member.points.refunded',
  'member.coupon.received', 'member.coupon.redeemed',
  'member.checkin.completed',
] as const;

export const ANALYTICS_CLIENT_SYSTEM_EVENT_NAMES = [ANALYTICS_EXPERIMENT_EXPOSURE_EVENT] as const;

export const ANALYTICS_SEMANTIC_EVENT_NAMES = [
  ...ANALYTICS_CLIENT_SYSTEM_EVENT_NAMES,
  ...ANALYTICS_SERVER_PAYMENT_EVENT_NAMES,
  ...ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES,
  ...ANALYTICS_SERVER_MEMBER_EVENT_NAMES,
] as const;

export type AnalyticsSemanticEventName = (typeof ANALYTICS_SEMANTIC_EVENT_NAMES)[number];

/**
 * 具名事件常量表：业务调用点（会员 service / 支付 & 工作流订阅桥接）通过该对象引用 eventName，
 * 禁止裸字符串拼写；`satisfies` 约束保证每个值都落在 ANALYTICS_SEMANTIC_EVENT_NAMES 之内。
 */
export const ANALYTICS_EVENT_NAMES = {
  paymentSucceeded: 'payment.succeeded',
  paymentClosed: 'payment.closed',
  paymentFailed: 'payment.failed',
  refundSucceeded: 'refund.succeeded',
  refundFailed: 'refund.failed',
  memberRegistered: 'member.registered',
  memberProfileUpdated: 'member.profile.updated',
  memberPointsEarned: 'member.points.earned',
  memberPointsRedeemed: 'member.points.redeemed',
  memberPointsAdjusted: 'member.points.adjusted',
  memberPointsExpired: 'member.points.expired',
  memberPointsRefunded: 'member.points.refunded',
  memberCouponReceived: 'member.coupon.received',
  memberCouponRedeemed: 'member.coupon.redeemed',
  memberCheckinCompleted: 'member.checkin.completed',
} as const satisfies Record<string, AnalyticsSemanticEventName>;

/** member.points.* 系列事件按 `member-points.service.ts` 的 PointTxType 一一映射，避免拼写漂移 */
export const ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE: Record<'earn' | 'redeem' | 'expire' | 'adjust' | 'refund', AnalyticsSemanticEventName> = {
  earn: ANALYTICS_EVENT_NAMES.memberPointsEarned,
  redeem: ANALYTICS_EVENT_NAMES.memberPointsRedeemed,
  expire: ANALYTICS_EVENT_NAMES.memberPointsExpired,
  adjust: ANALYTICS_EVENT_NAMES.memberPointsAdjusted,
  refund: ANALYTICS_EVENT_NAMES.memberPointsRefunded,
};

export const ANALYTICS_SEMANTIC_EVENT_LABELS: Record<AnalyticsSemanticEventName, string> = {
  [ANALYTICS_EXPERIMENT_EXPOSURE_EVENT]: '实验曝光',
  'payment.succeeded': '支付成功',
  'payment.closed': '支付关闭',
  'payment.failed': '支付失败',
  'refund.succeeded': '退款成功',
  'refund.failed': '退款失败',
  'workflow.instance.created': '流程发起',
  'workflow.instance.approved': '流程通过',
  'workflow.instance.rejected': '流程驳回',
  'workflow.instance.withdrawn': '流程撤回',
  'workflow.node.entered': '流程节点进入',
  'workflow.node.left': '流程节点离开',
  'workflow.task.created': '审批任务创建',
  'workflow.task.assigned': '审批任务分配',
  'workflow.task.approved': '审批任务通过',
  'workflow.task.rejected': '审批任务驳回',
  'workflow.task.skipped': '审批任务跳过',
  'workflow.task.transferred': '审批任务转办',
  'workflow.task.addSigned': '审批任务加签',
  'workflow.task.reduceSigned': '审批任务减签',
  'workflow.task.urged': '审批任务催办',
  'member.registered': '会员注册',
  'member.profile.updated': '会员资料更新',
  'member.points.earned': '积分获得',
  'member.points.redeemed': '积分消费',
  'member.points.adjusted': '积分调整',
  'member.points.expired': '积分过期',
  'member.points.refunded': '积分退回',
  'member.coupon.received': '优惠券领取',
  'member.coupon.redeemed': '优惠券核销',
  'member.checkin.completed': '签到完成',
};

export const REPORT_AGGREGATE_LABELS: Record<ReportAlertAggregate, string> = {
  sum: '求和',
  avg: '平均',
  max: '最大',
  min: '最小',
  count: '计数',
  first: '首行',
};

export const REPORT_AGGREGATE_OPTIONS: Array<{ value: ReportAlertAggregate; label: string }> =
  (Object.keys(REPORT_AGGREGATE_LABELS) as ReportAlertAggregate[])
    .map((value) => ({ value, label: REPORT_AGGREGATE_LABELS[value] }));

export const REPORT_VISUAL_AGGREGATE_OPTIONS = REPORT_AGGREGATE_OPTIONS
  .filter((option) => option.value !== 'first');

export const REPORT_DELIVERY_STATUS_LABELS: Record<ReportDeliveryStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};

export const REPORT_DELIVERY_STATUS_OPTIONS: Array<{ value: ReportDeliveryStatus; label: string }> =
  (Object.keys(REPORT_DELIVERY_STATUS_LABELS) as ReportDeliveryStatus[])
    .map((value) => ({ value, label: REPORT_DELIVERY_STATUS_LABELS[value] }));

export const REPORT_DELIVERY_TRIGGER_LABELS: Record<ReportDeliveryTriggerType, string> = {
  manual: '手动',
  scheduled: '定时',
  trigger: '触发',
  recover: '恢复',
};

export const REPORT_MISFIRE_POLICY_LABELS: Record<ReportScheduleMisfirePolicy, string> = {
  skip: '跳过',
  fire_once: '补执行一次',
};

export const REPORT_MISFIRE_POLICY_OPTIONS: Array<{ value: ReportScheduleMisfirePolicy; label: string }> =
  (Object.keys(REPORT_MISFIRE_POLICY_LABELS) as ReportScheduleMisfirePolicy[])
    .map((value) => ({ value, label: REPORT_MISFIRE_POLICY_LABELS[value] }));

export const REPORT_FIELD_TYPE_LABELS: Record<ReportFieldType, string> = {
  string: '字符串',
  number: '数字',
  date: '日期',
  boolean: '布尔',
};

export const REPORT_FIELD_TYPE_OPTIONS: Array<{ value: ReportFieldType; label: string }> =
  (Object.keys(REPORT_FIELD_TYPE_LABELS) as ReportFieldType[])
    .map((value) => ({ value, label: REPORT_FIELD_TYPE_LABELS[value] }));

export const REPORT_DATASOURCE_TYPE_LABELS: Record<ReportDatasourceType, string> = {
  api: 'API',
  sql: 'SQL',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  static: '静态数据',
};

export const REPORT_DATASOURCE_TYPE_DESCRIPTIONS: Record<ReportDatasourceType, string> = {
  api: '远程 HTTP',
  sql: '内置只读主库',
  mysql: '外部库',
  postgresql: '外部库',
  sqlserver: '外部库',
  static: 'JSON/文件',
};

export const REPORT_DATASOURCE_TYPE_OPTIONS: Array<{ value: ReportDatasourceType; label: string }> =
  (Object.keys(REPORT_DATASOURCE_TYPE_LABELS) as ReportDatasourceType[])
    .map((value) => ({
      value,
      label: `${REPORT_DATASOURCE_TYPE_LABELS[value]}（${REPORT_DATASOURCE_TYPE_DESCRIPTIONS[value]}）`,
    }));

export const REPORT_CHATBI_SESSION_STATUS_LABELS: Record<ReportChatbiSessionStatus, string> = {
  active: '进行中',
  archived: '已归档',
};

export const REPORT_CHATBI_SESSION_STATUS_OPTIONS =
  (Object.keys(REPORT_CHATBI_SESSION_STATUS_LABELS) as ReportChatbiSessionStatus[])
    .map((value) => ({ value, label: REPORT_CHATBI_SESSION_STATUS_LABELS[value] }));

export const REPORT_FILL_TEMPLATE_STATUS_LABELS: Record<ReportFillTemplateStatus, string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已下线',
};

export const REPORT_FILL_TEMPLATE_STATUS_OPTIONS =
  (Object.keys(REPORT_FILL_TEMPLATE_STATUS_LABELS) as ReportFillTemplateStatus[])
    .map((value) => ({ value, label: REPORT_FILL_TEMPLATE_STATUS_LABELS[value] }));

export const REPORT_FILL_RECORD_STATUS_LABELS: Record<ReportFillRecordStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
};

export const REPORT_FILL_RECORD_STATUS_OPTIONS =
  (Object.keys(REPORT_FILL_RECORD_STATUS_LABELS) as ReportFillRecordStatus[])
    .map((value) => ({ value, label: REPORT_FILL_RECORD_STATUS_LABELS[value] }));

export const REPORT_FILL_SYNC_STATUS_LABELS: Record<ReportFillSyncStatus, string> = {
  pending: '待同步',
  running: '同步中',
  succeeded: '同步成功',
  failed: '同步失败',
};

// ─── 通用比较运算符 ────────────────────────────────────────────────────
export const BASIC_COMPARISON_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
export type BasicComparisonOperator = (typeof BASIC_COMPARISON_OPERATORS)[number];

export const BASIC_COMPARISON_OPERATOR_LABELS: Record<BasicComparisonOperator, string> = {
  eq: '等于 =',
  neq: '不等于 ≠',
  gt: '大于 >',
  gte: '大于等于 ≥',
  lt: '小于 <',
  lte: '小于等于 ≤',
};

export const BASIC_COMPARISON_OPERATOR_OPTIONS: Array<{ value: BasicComparisonOperator; label: string }> =
  BASIC_COMPARISON_OPERATORS.map((value) => ({
    value,
    label: BASIC_COMPARISON_OPERATOR_LABELS[value],
  }));

export const BASIC_COMPARISON_OPERATOR_SYMBOLS: Record<BasicComparisonOperator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

export const BASIC_COMPARISON_SYMBOL_OPTIONS: Array<{
  value: BasicComparisonOperator;
  label: string;
}> = BASIC_COMPARISON_OPERATORS.map((value) => ({
  value,
  label: BASIC_COMPARISON_OPERATOR_SYMBOLS[value],
}));

// ─── CMS 内容管理 ─────────────────────────────────────────────────────────────
export const CMS_STATIC_MODES = ['dynamic', 'hybrid', 'static'] as const;

export const CMS_STATIC_MODE_LABELS: Record<(typeof CMS_STATIC_MODES)[number], string> = {
  dynamic: '动态渲染',
  hybrid: '混合（推荐）',
  static: '全静态',
};

export const CMS_CHANNEL_TYPES = ['list', 'page', 'link'] as const;

export const CMS_CHANNEL_TYPE_LABELS: Record<(typeof CMS_CHANNEL_TYPES)[number], string> = {
  list: '列表栏目',
  page: '单页栏目',
  link: '外链栏目',
};

export const CMS_CONTENT_STATUSES = ['draft', 'pending', 'published', 'offline', 'rejected'] as const;

export const CMS_CONTENT_STATUS_LABELS: Record<(typeof CMS_CONTENT_STATUSES)[number], string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  offline: '已下线',
  rejected: '已驳回',
};

export const CMS_FIELD_TYPES = ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch'] as const;

export const CMS_FIELD_TYPE_LABELS: Record<(typeof CMS_FIELD_TYPES)[number], string> = {
  text: '单行文本',
  textarea: '多行文本',
  richtext: '富文本',
  number: '数字',
  date: '日期',
  datetime: '日期时间',
  image: '图片',
  file: '附件',
  select: '下拉选择',
  radio: '单选',
  checkbox: '多选',
  switch: '开关',
};

export const CMS_FRAGMENT_TYPES = ['html', 'text', 'image', 'json'] as const;

export const CMS_FRAGMENT_TYPE_LABELS: Record<(typeof CMS_FRAGMENT_TYPES)[number], string> = {
  html: 'HTML',
  text: '纯文本',
  image: '图片',
  json: 'JSON',
};

/** CMS 前台预览路径前缀（无域名绑定时通过 /__cms/{siteCode}/... 访问站点） */
export const CMS_PREVIEW_PREFIX = '/__cms';

// ─── CMS P2 ───────────────────────────────────────────────────────────────────
export const CMS_COMMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const CMS_COMMENT_STATUS_LABELS: Record<(typeof CMS_COMMENT_STATUSES)[number], string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export const CMS_PUSH_ENGINES = ['baidu', 'indexnow'] as const;

export const CMS_PUSH_ENGINE_LABELS: Record<(typeof CMS_PUSH_ENGINES)[number], string> = {
  baidu: '百度普通收录',
  indexnow: 'IndexNow（Bing 等）',
};

export const CMS_FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'radio'] as const;

export const CMS_FORM_FIELD_TYPE_LABELS: Record<(typeof CMS_FORM_FIELD_TYPES)[number], string> = {
  text: '单行文本',
  textarea: '多行文本',
  select: '下拉选择',
  radio: '单选',
};
