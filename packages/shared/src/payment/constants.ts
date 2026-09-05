import { createLabelOptions, createLabelOptionsFromMap } from '../core/enum-options';

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

export const PAYMENT_ORDER_STATUSES = ['pending', 'paying', 'unknown', 'success', 'closed', 'refunding', 'refunded', 'failed'] as const;

export type PaymentOrderStatus = typeof PAYMENT_ORDER_STATUSES[number];

export const PAYMENT_REFUND_STATUSES = ['pending', 'processing', 'unknown', 'success', 'failed'] as const;

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
  createLabelOptions(PAYMENT_CHANNELS, PAYMENT_CHANNEL_LABELS);

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

export const PAYMENT_METHOD_OPTIONS = createLabelOptionsFromMap(PAYMENT_METHOD_LABELS);

export const PAYMENT_ORDER_STATUS_LABELS: Record<PaymentOrderStatus, string> = {
  pending: '待支付',
  paying: '支付中',
  unknown: '结果待确认',
  success: '支付成功',
  closed: '已关闭',
  refunding: '退款中',
  refunded: '已退款',
  failed: '支付失败',
};

export const PAYMENT_ORDER_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_ORDER_STATUS_LABELS);

export const PAYMENT_REFUND_STATUS_LABELS: Record<PaymentRefundStatus, string> = {
  pending: '待处理',
  processing: '退款中',
  unknown: '结果待确认',
  success: '退款成功',
  failed: '退款失败',
};

export const PAYMENT_REFUND_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_REFUND_STATUS_LABELS);

// ─── 支付中心扩展 · A 档（退款审批 / 对账 / Webhook / 资金台账）────────────────
export const PAYMENT_REFUND_APPROVAL_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;

export type PaymentRefundApprovalStatus = typeof PAYMENT_REFUND_APPROVAL_STATUSES[number];

export const PAYMENT_REFUND_APPROVAL_STATUS_LABELS: Record<PaymentRefundApprovalStatus, string> = {
  none: '无需审批', pending: '待审批', approved: '已批准', rejected: '已驳回',
};

export const PAYMENT_REFUND_APPROVAL_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_REFUND_APPROVAL_STATUS_LABELS);

export const PAYMENT_RECON_STATUSES = ['pending', 'comparing', 'done', 'failed'] as const;

export type PaymentReconStatus = typeof PAYMENT_RECON_STATUSES[number];

export const PAYMENT_RECON_STATUS_LABELS: Record<PaymentReconStatus, string> = {
  pending: '待对账', comparing: '比对中', done: '已完成', failed: '失败',
};

export const PAYMENT_RECON_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_RECON_STATUS_LABELS);

export const PAYMENT_RECON_SOURCES = ['manual_upload', 'sandbox_generated', 'provider_download'] as const;

export type PaymentReconSource = typeof PAYMENT_RECON_SOURCES[number];

export const PAYMENT_RECON_SOURCE_LABELS: Record<PaymentReconSource, string> = {
  manual_upload: '人工上传账单',
  sandbox_generated: '沙箱模拟账单',
  provider_download: '渠道下载账单',
};

export const PAYMENT_RECON_RESULTS = ['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff'] as const;

export type PaymentReconResult = typeof PAYMENT_RECON_RESULTS[number];

export const PAYMENT_RECON_RESULT_LABELS: Record<PaymentReconResult, string> = {
  matched: '一致', local_only: '本地有渠道无', channel_only: '渠道有本地无', amount_diff: '金额不一致', status_diff: '状态不一致',
};

export const PAYMENT_RECON_RESULT_OPTIONS = createLabelOptionsFromMap(PAYMENT_RECON_RESULT_LABELS);

export const PAYMENT_RECON_HANDLE_STATUSES = ['pending', 'adjusted', 'suspended', 'ignored'] as const;

export type PaymentReconHandleStatus = typeof PAYMENT_RECON_HANDLE_STATUSES[number];

export const PAYMENT_RECON_HANDLE_STATUS_LABELS: Record<PaymentReconHandleStatus, string> = {
  pending: '待处理', adjusted: '已调账', suspended: '挂账', ignored: '已忽略',
};

export const PAYMENT_RECON_HANDLE_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_RECON_HANDLE_STATUS_LABELS);

// ─── 支付中心扩展 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）──
export const PAYMENT_SETTLEMENT_STATUSES = ['pending', 'settling', 'settled', 'failed'] as const;

export type PaymentSettlementStatus = typeof PAYMENT_SETTLEMENT_STATUSES[number];

export const PAYMENT_SETTLEMENT_STATUS_LABELS: Record<PaymentSettlementStatus, string> = {
  pending: '待结算', settling: '结算中', settled: '已结算', failed: '结算失败',
};

export const PAYMENT_SETTLEMENT_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_SETTLEMENT_STATUS_LABELS);

export const PAYMENT_SHARING_RECEIVER_TYPES = ['merchant', 'personal'] as const;

export type PaymentSharingReceiverType = typeof PAYMENT_SHARING_RECEIVER_TYPES[number];

export const PAYMENT_SHARING_RECEIVER_TYPE_LABELS: Record<PaymentSharingReceiverType, string> = {
  merchant: '商户', personal: '个人',
};

export const PAYMENT_SHARING_RECEIVER_TYPE_OPTIONS = createLabelOptionsFromMap(PAYMENT_SHARING_RECEIVER_TYPE_LABELS);

export const PAYMENT_SHARING_ORDER_STATUSES = ['pending', 'processing', 'success', 'failed', 'reversed'] as const;

export type PaymentSharingOrderStatus = typeof PAYMENT_SHARING_ORDER_STATUSES[number];

export const PAYMENT_SHARING_ORDER_STATUS_LABELS: Record<PaymentSharingOrderStatus, string> = {
  pending: '待分账', processing: '分账中', success: '分账成功', failed: '分账失败', reversed: '已冲正',
};

export const PAYMENT_SHARING_ORDER_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_SHARING_ORDER_STATUS_LABELS);

export const PAYMENT_SHARING_REVERSAL_STATUSES = ['processing', 'unknown', 'success', 'failed'] as const;

export type PaymentSharingReversalStatus = typeof PAYMENT_SHARING_REVERSAL_STATUSES[number];

export const PAYMENT_SHARING_REVERSAL_STATUS_LABELS: Record<PaymentSharingReversalStatus, string> = {
  processing: '冲正中', unknown: '结果待确认', success: '冲正成功', failed: '冲正失败',
};

export const PAYMENT_SHARING_REVERSAL_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_SHARING_REVERSAL_STATUS_LABELS);

export const PAYMENT_LINK_STATUSES = ['active', 'disabled', 'expired'] as const;

export type PaymentLinkStatus = typeof PAYMENT_LINK_STATUSES[number];

export const PAYMENT_LINK_STATUS_LABELS: Record<PaymentLinkStatus, string> = {
  active: '生效中', disabled: '已停用', expired: '已过期',
};

export const PAYMENT_LINK_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_LINK_STATUS_LABELS);

export const PAYMENT_CASHIER_SESSION_STATUSES = [
  'ready',
  'creating',
  'awaiting',
  'processing',
  'unknown',
  'succeeded',
  'failed',
  'expired',
] as const;

export type PaymentCashierSessionStatus = typeof PAYMENT_CASHIER_SESSION_STATUSES[number];

export const PAYMENT_CASHIER_SESSION_STATUS_LABELS: Record<PaymentCashierSessionStatus, string> = {
  ready: '待创建支付',
  creating: '创建支付中',
  awaiting: '等待支付',
  processing: '支付处理中',
  unknown: '结果待确认',
  succeeded: '支付成功',
  failed: '支付失败',
  expired: '会话已过期',
};

export const PAYMENT_CASHIER_USE_SLOT_STATUSES = ['none', 'reserved', 'consumed', 'released'] as const;

export type PaymentCashierUseSlotStatus = typeof PAYMENT_CASHIER_USE_SLOT_STATUSES[number];

export const PAYMENT_RISK_SCOPES = ['global', 'channel', 'bizType'] as const;

export type PaymentRiskScope = typeof PAYMENT_RISK_SCOPES[number];

export const PAYMENT_RISK_SCOPE_LABELS: Record<PaymentRiskScope, string> = {
  global: '全局', channel: '按渠道', bizType: '按业务类型',
};

export const PAYMENT_RISK_SCOPE_OPTIONS = createLabelOptionsFromMap(PAYMENT_RISK_SCOPE_LABELS);

export const PAYMENT_RISK_ACTIONS = ['block', 'review'] as const;

export type PaymentRiskAction = typeof PAYMENT_RISK_ACTIONS[number];

export const PAYMENT_RISK_ACTION_LABELS: Record<PaymentRiskAction, string> = {
  block: '直接拦截', review: '人工审核',
};

export const PAYMENT_RISK_ACTION_OPTIONS = createLabelOptionsFromMap(PAYMENT_RISK_ACTION_LABELS);

export const PAYMENT_RISK_DIMENSIONS = ['blocklist', 'single_limit', 'daily_limit', 'daily_count', 'decision'] as const;

export type PaymentRiskDimension = typeof PAYMENT_RISK_DIMENSIONS[number];

export const PAYMENT_RISK_DIMENSION_LABELS: Record<PaymentRiskDimension, string> = {
  blocklist: '黑名单', single_limit: '单笔限额', daily_limit: '当日累计金额', daily_count: '当日交易笔数', decision: '决策表策略',
};

export const PAYMENT_RISK_DIMENSION_OPTIONS = createLabelOptionsFromMap(PAYMENT_RISK_DIMENSION_LABELS);

/** 命中记录可按维度筛选的子集（决策表策略命中不单独筛选） */
export const PAYMENT_RISK_HIT_QUERY_DIMENSIONS = ['blocklist', 'single_limit', 'daily_limit', 'daily_count'] as const satisfies readonly PaymentRiskDimension[];

export type PaymentRiskHitQueryDimension = typeof PAYMENT_RISK_HIT_QUERY_DIMENSIONS[number];

export const PAYMENT_RISK_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type PaymentRiskReviewStatus = typeof PAYMENT_RISK_REVIEW_STATUSES[number];

export const PAYMENT_RISK_REVIEW_STATUS_LABELS: Record<PaymentRiskReviewStatus, string> = {
  pending: '待审核', approved: '已放行', rejected: '已拒绝',
};

export const PAYMENT_RISK_REVIEW_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_RISK_REVIEW_STATUS_LABELS);

export const PAYMENT_TRANSFER_STATUSES = ['pending', 'processing', 'unknown', 'success', 'failed'] as const;

export type PaymentTransferStatus = typeof PAYMENT_TRANSFER_STATUSES[number];

export const PAYMENT_TRANSFER_STATUS_LABELS: Record<PaymentTransferStatus, string> = {
  pending: '待发起', processing: '处理中', unknown: '结果待确认', success: '转账成功', failed: '转账失败',
};

export const PAYMENT_TRANSFER_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_TRANSFER_STATUS_LABELS);

export const PAYMENT_TRANSFER_APPROVAL_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type PaymentTransferApprovalStatus = typeof PAYMENT_TRANSFER_APPROVAL_STATUSES[number];
export const PAYMENT_TRANSFER_APPROVAL_STATUS_LABELS: Record<PaymentTransferApprovalStatus, string> = {
  none: '无需审批', pending: '待审批', approved: '已通过', rejected: '已驳回',
};

export const PAYMENT_TRANSFER_APPROVAL_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_TRANSFER_APPROVAL_STATUS_LABELS);

export const PAYMENT_REPORT_GROUP_BYS = ['day', 'application', 'merchantAccount', 'currency', 'channel'] as const;

export type PaymentReportGroupBy = typeof PAYMENT_REPORT_GROUP_BYS[number];

export const PAYMENT_REPORT_GROUP_BY_LABELS: Record<PaymentReportGroupBy, string> = {
  day: '按日', application: '支付应用', merchantAccount: '商户账户', currency: '币种', channel: '支付渠道',
};

export const PAYMENT_REPORT_GROUP_BY_OPTIONS = createLabelOptionsFromMap(PAYMENT_REPORT_GROUP_BY_LABELS);

// ─── 支付中心扩展 · 签约代扣（周期扣款/订阅）───────────────────────────
export const PAYMENT_DEDUCT_PERIODS = ['daily', 'weekly', 'monthly', 'custom'] as const;

export type PaymentDeductPeriod = typeof PAYMENT_DEDUCT_PERIODS[number];

export const PAYMENT_DEDUCT_PERIOD_LABELS: Record<PaymentDeductPeriod, string> = {
  daily: '每日', weekly: '每周', monthly: '每月', custom: '自定义天数',
};

export const PAYMENT_DEDUCT_PERIOD_OPTIONS: Array<{ value: PaymentDeductPeriod; label: string }> =
  createLabelOptions(PAYMENT_DEDUCT_PERIODS, PAYMENT_DEDUCT_PERIOD_LABELS);

export const PAYMENT_CONTRACT_STATUSES = ['pending', 'unknown', 'signed', 'paused', 'terminated', 'failed'] as const;

export type PaymentContractStatus = typeof PAYMENT_CONTRACT_STATUSES[number];

export const PAYMENT_CONTRACT_STATUS_LABELS: Record<PaymentContractStatus, string> = {
  pending: '签约中', unknown: '结果待确认', signed: '已签约', paused: '已暂停', terminated: '已解约', failed: '签约失败',
};

export const PAYMENT_CONTRACT_STATUS_OPTIONS = createLabelOptionsFromMap(PAYMENT_CONTRACT_STATUS_LABELS);

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

// ─── 支付中心扩展 · 交易投诉/争议 ─────────────────────────────────────
export const PAYMENT_DISPUTE_TYPES = ['refund_request', 'service_issue', 'fraud_report', 'other'] as const;

export type PaymentDisputeType = typeof PAYMENT_DISPUTE_TYPES[number];

export const PAYMENT_DISPUTE_TYPE_LABELS: Record<PaymentDisputeType, string> = {
  refund_request: '退款诉求', service_issue: '服务问题', fraud_report: '欺诈举报', other: '其他',
};

export const PAYMENT_DISPUTE_TYPE_OPTIONS: Array<{ value: PaymentDisputeType; label: string }> =
  createLabelOptions(PAYMENT_DISPUTE_TYPES, PAYMENT_DISPUTE_TYPE_LABELS);

export const PAYMENT_DISPUTE_STATUSES = ['pending', 'processing', 'resolved', 'refunded'] as const;

export type PaymentDisputeStatus = typeof PAYMENT_DISPUTE_STATUSES[number];

export const PAYMENT_DISPUTE_STATUS_LABELS: Record<PaymentDisputeStatus, string> = {
  pending: '待处理', processing: '处理中', resolved: '已完结', refunded: '已退款',
};

export const PAYMENT_DISPUTE_STATUS_OPTIONS: Array<{ value: PaymentDisputeStatus; label: string }> =
  createLabelOptions(PAYMENT_DISPUTE_STATUSES, PAYMENT_DISPUTE_STATUS_LABELS);

// 智能分流路由（规则中心 dispute_triage 决策表输出；auto_refund_suggest 仅为建议，退款仍人工确认）
export const PAYMENT_DISPUTE_ROUTES = ['urgent', 'manual', 'auto_refund_suggest'] as const;

export type PaymentDisputeRoute = typeof PAYMENT_DISPUTE_ROUTES[number];

export const PAYMENT_DISPUTE_ROUTE_LABELS: Record<PaymentDisputeRoute, string> = {
  urgent: '加急处理', manual: '人工处理', auto_refund_suggest: '建议自动退款',
};

export const PAYMENT_DISPUTE_ROUTE_OPTIONS: Array<{ value: PaymentDisputeRoute; label: string }> =
  createLabelOptions(PAYMENT_DISPUTE_ROUTES, PAYMENT_DISPUTE_ROUTE_LABELS);

// ─── 支付中心扩展 · 预授权（资金冻结/解冻/转支付）────────────────────
export const PAYMENT_PREAUTH_STATUSES = ['pending', 'unknown', 'frozen', 'captured', 'released', 'failed'] as const;

export type PaymentPreauthStatus = typeof PAYMENT_PREAUTH_STATUSES[number];

export const PAYMENT_PREAUTH_STATUS_LABELS: Record<PaymentPreauthStatus, string> = {
  pending: '冻结中', unknown: '结果待确认', frozen: '已冻结', captured: '已转支付', released: '已解冻', failed: '冻结失败',
};

export const PAYMENT_PREAUTH_STATUS_OPTIONS: Array<{ value: PaymentPreauthStatus; label: string }> =
  createLabelOptions(PAYMENT_PREAUTH_STATUSES, PAYMENT_PREAUTH_STATUS_LABELS);

/** 预授权支持的支付方式（渠道映射用） */
export const PAYMENT_PREAUTH_METHODS = ['wechat_preauth', 'alipay_preauth'] as const satisfies readonly PaymentMethod[];

export type PaymentPreauthMethod = typeof PAYMENT_PREAUTH_METHODS[number];

// ─── 最终资金内核：双分录账户与预占 ──────────────────────────────────
export const PAYMENT_LEDGER_ACCOUNT_CODES = [
  'provider_clearing',
  'merchant_pending',
  'merchant_available',
  'merchant_frozen',
  'platform_fee',
  'refund_payable',
  'sharing_payable',
  'payout_payable',
  'suspense',
] as const;

export type PaymentLedgerAccountCode = typeof PAYMENT_LEDGER_ACCOUNT_CODES[number];

export const PAYMENT_LEDGER_ACCOUNT_CODE_LABELS: Record<PaymentLedgerAccountCode, string> = {
  provider_clearing: '渠道清算',
  merchant_pending: '商户待结算',
  merchant_available: '商户可用',
  merchant_frozen: '商户冻结',
  platform_fee: '平台手续费',
  refund_payable: '退款应付',
  sharing_payable: '分账应付',
  payout_payable: '出款应付',
  suspense: '待查资金',
};

export const PAYMENT_LEDGER_NORMAL_BALANCES = ['debit', 'credit'] as const;

export type PaymentLedgerNormalBalance = typeof PAYMENT_LEDGER_NORMAL_BALANCES[number];

export const PAYMENT_FUND_RESERVATION_STATUSES = ['active', 'captured', 'released', 'expired'] as const;

export type PaymentFundReservationStatus = typeof PAYMENT_FUND_RESERVATION_STATUSES[number];

// ─── 支付应用 / 运营 ─────────────────────────────────────────────────────
export const PAYMENT_APP_ENVIRONMENTS = ['production', 'sandbox'] as const;

export type PaymentAppEnvironment = typeof PAYMENT_APP_ENVIRONMENTS[number];

export const PAYMENT_OUTBOX_EVENT_STATUSES = ['pending', 'done', 'failed'] as const;

export type PaymentOutboxEventStatus = typeof PAYMENT_OUTBOX_EVENT_STATUSES[number];

/** 支付链接不可用原因 */
export const PAYMENT_LINK_UNAVAILABLE_REASONS = ['disabled', 'expired', 'usage_limit'] as const;

export type PaymentLinkUnavailableReason = typeof PAYMENT_LINK_UNAVAILABLE_REASONS[number];

/** 公开收银台可选择的支付方式（不含需要 openId / APP 环境的 JSAPI 与 APP 支付） */
export const PAYMENT_LINK_PAY_METHODS = ['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap', 'unionpay_qr'] as const satisfies readonly PaymentCashierMethod[];

export type PaymentLinkPayMethod = typeof PAYMENT_LINK_PAY_METHODS[number];

/** 投诉回复的发言方 */
export const PAYMENT_DISPUTE_REPLY_AUTHORS = ['merchant', 'user', 'system'] as const;

export type PaymentDisputeReplyAuthor = typeof PAYMENT_DISPUTE_REPLY_AUTHORS[number];

/** 单期扣款 / 预授权等资金操作的执行结果 */
export const PAYMENT_DEDUCT_RESULT_STATUSES = ['success', 'processing', 'failed'] as const;

export type PaymentDeductResultStatus = typeof PAYMENT_DEDUCT_RESULT_STATUSES[number];

/** 签约协议处于 unknown 状态时等待收敛的操作 */
export const PAYMENT_CONTRACT_UNKNOWN_OPERATIONS = ['sign', 'terminate'] as const;

export type PaymentContractUnknownOperation = typeof PAYMENT_CONTRACT_UNKNOWN_OPERATIONS[number];

/** 预授权单处于 unknown 状态时等待收敛的操作 */
export const PAYMENT_PREAUTH_UNKNOWN_OPERATIONS = ['freeze', 'capture', 'release'] as const;

export type PaymentPreauthUnknownOperation = typeof PAYMENT_PREAUTH_UNKNOWN_OPERATIONS[number];

// ─── 渠道能力（适配器声明 × 商户配置 × 运行模式的交集）────────────────────
/** 支付引擎运行模式 */
export const PAYMENT_ENGINE_MODES = ['off', 'sandbox', 'live'] as const;

export type PaymentEngineMode = typeof PAYMENT_ENGINE_MODES[number];

/** 渠道适配器运行环境 */
export const PAYMENT_PROVIDER_ENVIRONMENTS = ['sandbox', 'live'] as const;

export type PaymentProviderEnvironment = typeof PAYMENT_PROVIDER_ENVIRONMENTS[number];

/** 渠道适配器可声明的操作 */
export const PAYMENT_PROVIDER_OPERATIONS = [
  'payment.create',
  'payment.query',
  'payment.close',
  'refund.create',
  'refund.query',
  'notification.verify',
  'profit-sharing.create',
  'profit-sharing.query',
  'profit-sharing.reverse',
  'transfer.create',
  'transfer.query',
  'contract.sign',
  'contract.query',
  'contract.terminate',
  'contract.deduct',
  'preauth.freeze',
  'preauth.query',
  'preauth.capture',
  'preauth.release',
  'bill.download',
] as const;

export type PaymentProviderOperation = typeof PAYMENT_PROVIDER_OPERATIONS[number];

/** 操作的执行方式：跳转 / 同步返回 / 异步回调 / 本地完成 */
export const PAYMENT_PROVIDER_EXECUTIONS = ['redirect', 'synchronous', 'asynchronous', 'local'] as const;

export type PaymentProviderExecution = typeof PAYMENT_PROVIDER_EXECUTIONS[number];

/** 能力不可用的原因码 */
export const PAYMENT_CAPABILITY_REASON_CODES = [
  'ENGINE_OFF',
  'ENGINE_MODE_MISMATCH',
  'CONFIG_DISABLED',
  'ENVIRONMENT_UNSUPPORTED',
  'CONFIG_INCOMPLETE',
  'PAYMENT_METHOD_NOT_CONFIGURED',
  'PAYMENT_METHOD_DISABLED',
  'PAYMENT_METHOD_CHANNEL_MISMATCH',
  'PAYMENT_METHOD_UNSUPPORTED',
  'CURRENCY_UNSUPPORTED',
  'OPERATION_UNSUPPORTED',
] as const;

export type PaymentCapabilityReasonCode = typeof PAYMENT_CAPABILITY_REASON_CODES[number];
