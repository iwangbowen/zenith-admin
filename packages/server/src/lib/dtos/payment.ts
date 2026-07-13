/**
 * 支付中心相关 DTO（密钥字段以 hasXxx 布尔位返回，绝不暴露明文）
 */
import { z } from '@hono/zod-openapi';

const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const payMethodEnum = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr', 'wechat_papay', 'alipay_cycle']);
const orderStatusEnum = z.enum(['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed']);
const refundStatusEnum = z.enum(['pending', 'processing', 'success', 'failed']);
const refundApprovalEnum = z.enum(['none', 'pending', 'approved', 'rejected']);
const reconStatusEnum = z.enum(['pending', 'comparing', 'done', 'failed']);
const reconResultEnum = z.enum(['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);
const webhookDeliveryStatusEnum = z.enum(['pending', 'success', 'failed']);
const ledgerDirectionEnum = z.enum(['in', 'out']);
const ledgerTypeEnum = z.enum(['payment', 'refund', 'fee', 'settlement', 'adjust', 'transfer']);

export const PaymentChannelConfigDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    channel: channelEnum,
    status: z.enum(['enabled', 'disabled']),
    isDefault: z.boolean(),
    sandbox: z.boolean(),
    notifyUrl: z.string().nullable().optional(),
    wechatAppId: z.string().nullable().optional(),
    wechatMchId: z.string().nullable().optional(),
    wechatSerialNo: z.string().nullable().optional(),
    wechatPlatformCert: z.string().nullable().optional(),
    hasWechatApiV3Key: z.boolean().optional(),
    hasWechatPrivateKey: z.boolean().optional(),
    alipayAppId: z.string().nullable().optional(),
    alipayPublicKey: z.string().nullable().optional(),
    alipaySignType: z.string().nullable().optional(),
    alipayGateway: z.string().nullable().optional(),
    hasAlipayPrivateKey: z.boolean().optional(),
    unionpayMerId: z.string().nullable().optional(),
    unionpayCertId: z.string().nullable().optional(),
    unionpayPublicKey: z.string().nullable().optional(),
    unionpayGateway: z.string().nullable().optional(),
    hasUnionpayPrivateKey: z.boolean().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentChannelConfig');

export const PaymentOrderDTO = z
  .object({
    id: z.number().int(),
    orderNo: z.string(),
    outTradeNo: z.string(),
    channelTradeNo: z.string().nullable().optional(),
    bizType: z.string(),
    bizId: z.string(),
    subject: z.string(),
    body: z.string().nullable().optional(),
    amount: z.number().int().openapi({ description: '金额（分）', example: 9900 }),
    currency: z.string(),
    channel: channelEnum,
    channelConfigId: z.number().int().nullable().optional(),
    payMethod: payMethodEnum,
    status: orderStatusEnum,
    userId: z.number().int().nullable().optional(),
    openId: z.string().nullable().optional(),
    clientIp: z.string().nullable().optional(),
    departmentId: z.number().int().nullable().optional(),
    paidAmount: z.number().int().nullable().optional(),
    feeAmount: z.number().int().nullable().optional(),
    netAmount: z.number().int().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    expiredAt: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentOrder');

export const PaymentRefundDTO = z
  .object({
    id: z.number().int(),
    refundNo: z.string(),
    outRefundNo: z.string(),
    orderNo: z.string(),
    orderId: z.number().int().nullable().optional(),
    channelRefundNo: z.string().nullable().optional(),
    channel: channelEnum,
    refundAmount: z.number().int().openapi({ description: '退款金额（分）' }),
    totalAmount: z.number().int().openapi({ description: '原订单金额（分）' }),
    reason: z.string().nullable().optional(),
    status: refundStatusEnum,
    approvalStatus: refundApprovalEnum,
    appliedById: z.number().int().nullable().optional(),
    approverId: z.number().int().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
    approvalRemark: z.string().nullable().optional(),
    operatorId: z.number().int().nullable().optional(),
    refundedAt: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentRefund');

export const PaymentNotifyLogDTO = z
  .object({
    id: z.number().int(),
    channel: channelEnum,
    scene: z.string(),
    orderNo: z.string().nullable().optional(),
    signatureValid: z.boolean(),
    result: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    ip: z.string().nullable().optional(),
    rawBody: z.string().nullable().optional(),
    headers: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('PaymentNotifyLog');

export const CreatePaymentResultDTO = z
  .object({
    orderNo: z.string(),
    payMethod: payMethodEnum,
    channel: channelEnum,
    codeUrl: z.string().optional(),
    payUrl: z.string().optional(),
    formHtml: z.string().optional(),
    jsapiParams: z.record(z.string(), z.string()).optional(),
    appOrderStr: z.string().optional(),
    expiredAt: z.string().optional(),
  })
  .openapi('CreatePaymentResult');

export const CreatePaymentResponseDTO = z
  .object({
    orderNo: z.string(),
    payParams: CreatePaymentResultDTO,
  })
  .openapi('CreatePaymentResponse');

export const PaymentRefundResultDTO = z
  .object({
    refundNo: z.string(),
    status: z.string(),
  })
  .openapi('PaymentRefundResult');

export const PaymentStatsDTO = z
  .object({
    totalAmount: z.number().openapi({ description: '累计成功金额（分）' }),
    todayAmount: z.number().openapi({ description: '今日成功金额（分）' }),
    todayCount: z.number().openapi({ description: '今日成功订单数' }),
    orderCount: z.number(),
    successCount: z.number(),
    refundAmount: z.number().openapi({ description: '累计退款金额（分）' }),
    refundCount: z.number().openapi({ description: '成功退款笔数' }),
    successRate: z.number().openapi({ description: '支付成功率（0-100）' }),
    refundRate: z.number().openapi({ description: '退款率（0-100）' }),
    avgAmount: z.number().openapi({ description: '成功订单笔均金额（分）' }),
    byChannel: z.array(z.object({ channel: z.string(), count: z.number(), amount: z.number() })),
    byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  })
  .openapi('PaymentStats');

export const PaymentTrendPointDTO = z
  .object({
    date: z.string().openapi({ description: '日期 YYYY-MM-DD' }),
    amount: z.number().openapi({ description: '当日成功金额（分）' }),
    count: z.number().openapi({ description: '当日成功订单数' }),
    refundAmount: z.number().openapi({ description: '当日退款金额（分）' }),
  })
  .openapi('PaymentTrendPoint');


export const ChannelConnectivityResultDTO = z
  .object({
    success: z.boolean().openapi({ description: '连通性是否正常（凭据有效）' }),
    message: z.string().openapi({ description: '测试结果描述' }),
    latencyMs: z.number().openapi({ description: '探测耗时（毫秒）' }),
  })
  .openapi('ChannelConnectivityResult');

// ─── A 档：对账 / Webhook / 资金台账 ─────────────────────────────────────────
export const PaymentReconBatchDTO = z
  .object({
    id: z.number().int(),
    batchNo: z.string(),
    channel: channelEnum,
    billDate: z.string(),
    status: reconStatusEnum,
    localCount: z.number().int(),
    localAmount: z.number().int(),
    channelCount: z.number().int(),
    channelAmount: z.number().int(),
    matchedCount: z.number().int(),
    diffCount: z.number().int(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentReconBatch');

export const PaymentReconItemDTO = z
  .object({
    id: z.number().int(),
    batchId: z.number().int(),
    orderNo: z.string().nullable().optional(),
    channelTradeNo: z.string().nullable().optional(),
    localAmount: z.number().int().nullable().optional(),
    channelAmount: z.number().int().nullable().optional(),
    localStatus: z.string().nullable().optional(),
    channelStatus: z.string().nullable().optional(),
    result: reconResultEnum,
    handleStatus: z.enum(['pending', 'adjusted', 'suspended', 'ignored']).nullable().optional(),
    handleRemark: z.string().nullable().optional(),
    handledAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('PaymentReconItem');

export const PaymentWebhookEndpointDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    url: z.string(),
    bizType: z.string().nullable().optional(),
    events: z.array(z.string()),
    status: z.enum(['enabled', 'disabled']),
    hasSecret: z.boolean().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentWebhookEndpoint');

export const PaymentWebhookDeliveryDTO = z
  .object({
    id: z.number().int(),
    endpointId: z.number().int(),
    endpointName: z.string().nullable().optional(),
    eventType: z.string(),
    orderNo: z.string().nullable().optional(),
    payload: z.string().nullable().optional(),
    status: webhookDeliveryStatusEnum,
    attempts: z.number().int(),
    httpStatus: z.number().int().nullable().optional(),
    responseBody: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentWebhookDelivery');

export const PaymentLedgerEntryDTO = z
  .object({
    id: z.number().int(),
    entryNo: z.string(),
    direction: ledgerDirectionEnum,
    type: ledgerTypeEnum,
    amount: z.number().int(),
    orderNo: z.string().nullable().optional(),
    refundNo: z.string().nullable().optional(),
    channel: channelEnum.nullable().optional(),
    bizType: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('PaymentLedgerEntry');

export const PaymentLedgerSummaryDTO = z
  .object({
    inAmount: z.number().int(),
    outAmount: z.number().int(),
    netAmount: z.number().int(),
    count: z.number().int(),
  })
  .openapi('PaymentLedgerSummary');

export const PaymentOutboxEventDTO = z
  .object({
    id: z.number().int(),
    type: z.string(),
    orderNo: z.string(),
    status: z.enum(['pending', 'done', 'failed']),
    attempts: z.number().int(),
    lastError: z.string().nullable().optional(),
    createdAt: z.string(),
    processedAt: z.string().nullable().optional(),
  })
  .openapi('PaymentOutboxEvent');

// ─── B 档：费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表 ────────────────
const settlementStatusEnum = z.enum(['pending', 'settling', 'settled', 'failed']);
const sharingReceiverTypeEnum = z.enum(['merchant', 'personal']);
const sharingOrderStatusEnum = z.enum(['pending', 'processing', 'success', 'failed']);
const linkStatusEnum = z.enum(['active', 'disabled', 'expired']);
const riskScopeEnum = z.enum(['global', 'channel', 'bizType']);

export const PaymentFeeRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    channel: channelEnum,
    payMethod: payMethodEnum.nullable().optional(),
    rateBps: z.number().int().openapi({ description: '费率（万分比）' }),
    fixedFee: z.number().int().openapi({ description: '固定手续费（分）' }),
    minFee: z.number().int().nullable().optional(),
    maxFee: z.number().int().nullable().optional(),
    status: z.enum(['enabled', 'disabled']),
    priority: z.number().int(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentFeeRule');

export const PaymentSettlementBatchDTO = z
  .object({
    id: z.number().int(),
    batchNo: z.string(),
    channel: channelEnum,
    periodStart: z.string(),
    periodEnd: z.string(),
    status: settlementStatusEnum,
    orderCount: z.number().int(),
    grossAmount: z.number().int(),
    feeAmount: z.number().int(),
    refundAmount: z.number().int(),
    netAmount: z.number().int(),
    settledAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentSettlementBatch');

export const PaymentSharingReceiverDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    receiverType: sharingReceiverTypeEnum,
    account: z.string(),
    ratioBps: z.number().int().nullable().optional(),
    autoShare: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentSharingReceiver');

export const PaymentSharingOrderDTO = z
  .object({
    id: z.number().int(),
    sharingNo: z.string(),
    orderNo: z.string(),
    receiverId: z.number().int(),
    receiverName: z.string().nullable().optional(),
    amount: z.number().int(),
    status: sharingOrderStatusEnum,
    channelSharingNo: z.string().nullable().optional(),
    finishedAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentSharingOrder');

export const PaymentTransferDTO = z
  .object({
    id: z.number().int(),
    transferNo: z.string(),
    outTransferNo: z.string(),
    channel: channelEnum,
    receiverAccount: z.string(),
    receiverName: z.string().nullable().optional(),
    amount: z.number().int(),
    remark: z.string().nullable().optional(),
    status: z.enum(['pending', 'processing', 'success', 'failed']),
    channelTransferNo: z.string().nullable().optional(),
    failReason: z.string().nullable().optional(),
    attempts: z.number().int(),
    bizType: z.string().nullable().optional(),
    bizId: z.string().nullable().optional(),
    finishedAt: z.string().nullable().optional(),
    operatorName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentTransfer');

export const PaymentTransferSummaryDTO = z
  .object({
    totalAmount: z.number().int(),
    successCount: z.number().int(),
    processingCount: z.number().int(),
    failedCount: z.number().int(),
  })
  .openapi('PaymentTransferSummary');

export const PaymentLinkDTO = z
  .object({
    id: z.number().int(),
    linkNo: z.string(),
    token: z.string(),
    subject: z.string(),
    amount: z.number().int().nullable().optional(),
    payMethod: payMethodEnum.nullable().optional(),
    bizType: z.string(),
    maxUses: z.number().int().nullable().optional(),
    usedCount: z.number().int(),
    expiredAt: z.string().nullable().optional(),
    status: linkStatusEnum,
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentLink');

export const PaymentLinkPublicDTO = z
  .object({
    token: z.string(),
    subject: z.string(),
    amount: z.number().int().nullable().optional(),
    payMethod: payMethodEnum.nullable().optional(),
    bizType: z.string(),
    status: linkStatusEnum,
    expiredAt: z.string().nullable().optional(),
    remainingUses: z.number().int().nullable().optional(),
  })
  .openapi('PaymentLinkPublic');

export const PaymentRiskRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    scope: riskScopeEnum,
    channel: channelEnum.nullable().optional(),
    bizType: z.string().nullable().optional(),
    singleLimit: z.number().int().nullable().optional(),
    dailyLimit: z.number().int().nullable().optional(),
    dailyCountLimit: z.number().int().nullable().optional(),
    blocklist: z.array(z.string()),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentRiskRule');

export const PaymentMethodConfigDTO = z
  .object({
    id: z.number().int(),
    method: payMethodEnum,
    channel: channelEnum,
    label: z.string(),
    icon: z.string().nullable().optional(),
    enabled: z.boolean(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentMethodConfig');

export const PaymentReportRowDTO = z
  .object({
    key: z.string(),
    label: z.string(),
    gross: z.number().int().openapi({ description: '成功收款总额（分）' }),
    fee: z.number().int().openapi({ description: '手续费总额（分）' }),
    refund: z.number().int().openapi({ description: '退款总额（分）' }),
    net: z.number().int().openapi({ description: '净额（分）' }),
    count: z.number().int(),
  })
  .openapi('PaymentReportRow');

export const PaymentReportSummaryDTO = z
  .object({
    groupBy: z.enum(['bizType', 'channel', 'day']),
    rows: z.array(PaymentReportRowDTO),
    totalGross: z.number().int(),
    totalFee: z.number().int(),
    totalRefund: z.number().int(),
    totalNet: z.number().int(),
    totalCount: z.number().int(),
    prev: z
      .object({
        totalGross: z.number().int(),
        totalFee: z.number().int(),
        totalRefund: z.number().int(),
        totalNet: z.number().int(),
        totalCount: z.number().int(),
      })
      .nullable()
      .optional()
      .openapi({ description: '环比周期汇总（compare=true 且提供时间范围时返回）' }),
  })
  .openapi('PaymentReportSummary');

export const PaymentOpsHealthDTO = z
  .object({
    outboxPending: z.number().int(),
    outboxFailed: z.number().int(),
    webhookPending: z.number().int(),
    webhookFailed24h: z.number().int(),
    sharingProcessing: z.number().int(),
    transferProcessing: z.number().int(),
    reconPendingDiff: z.number().int(),
  })
  .openapi('PaymentOpsHealth');

export const PaymentAppDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    appKey: z.string(),
    status: z.enum(['enabled', 'disabled']),
    wechatConfigId: z.number().int().nullable().optional(),
    wechatConfigName: z.string().nullable().optional(),
    alipayConfigId: z.number().int().nullable().optional(),
    alipayConfigName: z.string().nullable().optional(),
    unionpayConfigId: z.number().int().nullable().optional(),
    unionpayConfigName: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentApp');

// ─── 签约代扣（周期扣款/订阅）────────────────────────────────────────────────
const deductPeriodEnum = z.enum(['daily', 'weekly', 'monthly', 'custom']);
const contractStatusEnum = z.enum(['pending', 'signed', 'paused', 'terminated']);

export const PaymentDeductPlanDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    period: deductPeriodEnum,
    customDays: z.number().int().nullable().optional(),
    amount: z.number().int(),
    maxRetries: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    contractCount: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentDeductPlan');

export const PaymentContractDTO = z
  .object({
    id: z.number().int(),
    contractNo: z.string(),
    channel: channelEnum,
    channelConfigId: z.number().int().nullable().optional(),
    planId: z.number().int(),
    planName: z.string().nullable().optional(),
    planPeriod: deductPeriodEnum.nullable().optional(),
    planAmount: z.number().int().nullable().optional(),
    signerAccount: z.string(),
    signerName: z.string().nullable().optional(),
    status: contractStatusEnum,
    channelContractNo: z.string().nullable().optional(),
    bizType: z.string(),
    bizId: z.string(),
    nextDeductAt: z.string().nullable().optional(),
    lastDeductAt: z.string().nullable().optional(),
    failCount: z.number().int(),
    totalDeductCount: z.number().int(),
    lastOrderNo: z.string().nullable().optional(),
    signedAt: z.string().nullable().optional(),
    terminatedAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentContract');

/** 执行一期扣款的结果（协议最新状态 + 本期订单号 + 扣款结果） */
export const PaymentDeductResultDTO = z
  .object({
    contract: PaymentContractDTO,
    orderNo: z.string().nullable().optional(),
    deductStatus: z.enum(['success', 'processing', 'failed']),
    failReason: z.string().nullable().optional(),
  })
  .openapi('PaymentDeductResult');

export const MemberVipRenewalDTO = z
  .object({
    id: z.number().int(),
    orderNo: z.string(),
    contractNo: z.string().nullable().optional(),
    amount: z.number().int(),
    vipExpireAfter: z.string(),
    createdAt: z.string(),
  })
  .openapi('MemberVipRenewal');

/** 会员端自动续费视图 */
export const MemberRenewalInfoDTO = z
  .object({
    vipExpireAt: z.string().nullable().optional(),
    contract: PaymentContractDTO.nullable().optional(),
    renewals: z.array(MemberVipRenewalDTO),
  })
  .openapi('MemberRenewalInfo');

/** 会员端可选续费计划（公开视图） */
export const MemberRenewalPlanDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    period: deductPeriodEnum,
    customDays: z.number().int().nullable().optional(),
    amount: z.number().int(),
    remark: z.string().nullable().optional(),
  })
  .openapi('MemberRenewalPlan');

// ─── 交易投诉/争议 ────────────────────────────────────────────────────────────
const disputeTypeEnum = z.enum(['refund_request', 'service_issue', 'fraud_report', 'other']);
const disputeStatusEnum = z.enum(['pending', 'processing', 'resolved', 'refunded']);

export const PaymentDisputeDTO = z
  .object({
    id: z.number().int(),
    disputeNo: z.string(),
    channelDisputeNo: z.string().nullable().optional(),
    channel: channelEnum,
    orderNo: z.string(),
    complainant: z.string().nullable().optional(),
    complainantPhone: z.string().nullable().optional(),
    type: disputeTypeEnum,
    content: z.string(),
    amount: z.number().int(),
    status: disputeStatusEnum,
    deadline: z.string().nullable().optional(),
    overdue: z.boolean(),
    refundNo: z.string().nullable().optional(),
    resolvedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PaymentDispute');

export const PaymentDisputeReplyDTO = z
  .object({
    id: z.number().int(),
    author: z.enum(['merchant', 'user', 'system']),
    content: z.string(),
    operatorName: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('PaymentDisputeReply');

export const PaymentDisputeDetailDTO = PaymentDisputeDTO.extend({
  replies: z.array(PaymentDisputeReplyDTO),
  order: z
    .object({
      orderNo: z.string(),
      subject: z.string(),
      amount: z.number().int(),
      status: orderStatusEnum,
      paidAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
}).openapi('PaymentDisputeDetail');

export const PaymentDisputeStatsDTO = z
  .object({
    open: z.number().int(),
    overdue: z.number().int(),
    last30dCount: z.number().int(),
    last30dRate: z.number(),
    avgResolveHours: z.number(),
  })
  .openapi('PaymentDisputeStats');
