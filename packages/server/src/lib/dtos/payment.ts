/**
 * 支付中心相关 DTO（密钥字段以 hasXxx 布尔位返回，绝不暴露明文）
 */
import { z } from '@hono/zod-openapi';

const channelEnum = z.enum(['wechat', 'alipay']);
const payMethodEnum = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app']);
const orderStatusEnum = z.enum(['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed']);
const refundStatusEnum = z.enum(['pending', 'processing', 'success', 'failed']);
const refundApprovalEnum = z.enum(['none', 'pending', 'approved', 'rejected']);
const reconStatusEnum = z.enum(['pending', 'comparing', 'done', 'failed']);
const reconResultEnum = z.enum(['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);
const webhookDeliveryStatusEnum = z.enum(['pending', 'success', 'failed']);
const ledgerDirectionEnum = z.enum(['in', 'out']);
const ledgerTypeEnum = z.enum(['payment', 'refund', 'fee', 'settlement', 'adjust']);

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
