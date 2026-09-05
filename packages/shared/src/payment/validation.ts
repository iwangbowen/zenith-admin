import * as z from 'zod';
import { partialForUpdate } from '../core/validation';
import { PAYMENT_FUND_RESERVATION_STATUSES, PAYMENT_LEDGER_ACCOUNT_CODES, PAYMENT_LINK_PAY_METHODS, PAYMENT_METHOD_CHANNEL } from './constants';

// ─── 支付中心 ────────────────────────────────────────────────────────
export const createPaymentChannelConfigSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  channel: z.enum(['wechat', 'alipay', 'unionpay']),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  isDefault: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  notifyUrl: z.string().max(512).refine((v) => v === '' || /^https?:\/\/.+/.test(v), { message: '回调地址须为 http(s) 绝对地址' }).optional(),
  // 微信（明文入参，service 层加密后入库）
  wechatAppId: z.string().max(64).optional(),
  wechatMchId: z.string().max(64).optional(),
  wechatApiV3Key: z.string().max(128).optional(),
  wechatPrivateKey: z.string().optional(),
  wechatSerialNo: z.string().max(128).optional(),
  wechatPlatformCert: z.string().optional(),
  // 支付宝
  alipayAppId: z.string().max(64).optional(),
  alipaySellerId: z.string().max(64).optional(),
  alipayPrivateKey: z.string().optional(),
  alipayPublicKey: z.string().optional(),
  alipaySignType: z.enum(['RSA2', 'RSA']).default('RSA2'),
  alipayGateway: z.string().max(256).optional(),
  // 云闪付（银联全渠道）
  unionpayMerId: z.string().max(64).optional(),
  unionpayPrivateKey: z.string().optional(),
  unionpayCertId: z.string().max(64).optional(),
  unionpayPublicKey: z.string().optional(),
  unionpayGateway: z.string().max(256).optional(),
  remark: z.string().max(256).optional(),
});

export const updatePaymentChannelConfigSchema = partialForUpdate(createPaymentChannelConfigSchema);

/** 业务/后台发起支付下单 */
export const createPaymentSchema = z.object({
  bizType: z.string().min(1).max(64),
  bizId: z.string().min(1).max(128),
  subject: z.string().min(1).max(256),
  body: z.string().max(512).optional(),
  amount: z.number().int().positive('金额必须大于 0'), // 分
  currency: z.literal('CNY').default('CNY'),
  payMethod: z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']),
  /** 支付业务必须显式绑定应用；开放 API 在进入此契约前由已验签 principal 注入。 */
  applicationId: z.number().int().positive(),
  openId: z.string().max(128).optional(),
  userId: z.number().int().positive().optional(),
  expireMinutes: z.number().int().positive().max(1440).default(30),
});

/** 发起退款 */
export const createRefundSchema = z.object({
  orderNo: z.string().min(1).max(64),
  refundAmount: z.number().int().positive('退款金额必须大于 0'), // 分
  reason: z.string().max(256).optional(),
});

/** 审批通过退款（备注可选） */
export const approveRefundSchema = z.object({
  remark: z.string().max(256).optional(),
});

/** 驳回退款（必须说明原因） */
export const rejectRefundSchema = z.object({
  remark: z.string().min(1).max(256),
});

/**
 * 资金流出接口的业务幂等键请求头：客户端为每次业务意图生成唯一键，
 * 服务端按键去重，网络重试不会重复出款。
 */
export const idempotencyKeyHeaders = z.object({
  'x-idempotency-key': z.string().trim().min(8).max(128).meta({ description: '业务幂等键（8-128 位，建议 UUID）', example: 'refund-01JABCDEF1234567890' }),
});

export type CreatePaymentChannelConfigInput = z.infer<typeof createPaymentChannelConfigSchema>;

export type UpdatePaymentChannelConfigInput = z.infer<typeof updatePaymentChannelConfigSchema>;

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export type ApproveRefundInput = z.infer<typeof approveRefundSchema>;

export type RejectRefundInput = z.infer<typeof rejectRefundSchema>;

const paymentBillDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '账单日期须为 YYYY-MM-DD');

export const createPaymentReconBatchSchema = z.object({
  applicationId: z.number().int().positive(),
  channel: z.enum(['wechat', 'alipay', 'unionpay']),
  channelConfigId: z.number().int().positive(),
  currency: z.literal('CNY').default('CNY'),
  billDate: paymentBillDate,
  billText: z.string().min(1).max(2_000_000),
  remark: z.string().max(256).optional(),
});

export type CreatePaymentReconBatchInput = z.infer<typeof createPaymentReconBatchSchema>;

/** 自动拉取渠道账单并对账 */
export const autoPaymentReconSchema = z.object({
  applicationId: z.number().int().positive(),
  channel: z.enum(['wechat', 'alipay', 'unionpay']),
  channelConfigId: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('CNY'),
  billDate: paymentBillDate,
});

export type AutoPaymentReconInput = z.infer<typeof autoPaymentReconSchema>;

const paymentPeriodDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '账期须为 YYYY-MM-DD');

export const createPaymentSettlementSchema = z.object({
  applicationId: z.number().int().positive(),
  channelConfigId: z.number().int().positive(),
  currency: z.literal('CNY').default('CNY'),
  periodStart: paymentPeriodDate,
  periodEnd: paymentPeriodDate,
  remark: z.string().max(256).optional(),
});

export const transitionPaymentSettlementSchema = z.object({
  status: z.enum(['settling', 'settled', 'failed']),
  failureReason: z.string().trim().min(1).max(512).optional(),
  payoutReference: z.string().trim().min(1).max(128).optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'failed' && !value.failureReason) {
    ctx.addIssue({ code: 'custom', path: ['failureReason'], message: '标记结算失败时必须填写失败原因' });
  }
  if (value.status === 'settled' && !value.payoutReference) {
    ctx.addIssue({ code: 'custom', path: ['payoutReference'], message: '确认结算到账时必须填写出款参考号' });
  }
});

export type CreatePaymentSettlementInput = z.infer<typeof createPaymentSettlementSchema>;

export type TransitionPaymentSettlementInput = z.infer<typeof transitionPaymentSettlementSchema>;

// ─── 支付中心扩展 · B 档（费率 / 分账 / 支付链接 / 风控 / 支付方式）──────────────
const paymentChannelZ = z.enum(['wechat', 'alipay', 'unionpay']);

const paymentMethodZ = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr']);

/** 手续费/费率规则 */
export const createPaymentFeeRuleSchema = z.object({
  name: z.string().min(1).max(64),
  channel: paymentChannelZ,
  payMethod: paymentMethodZ.optional(),
  rateBps: z.number().int().min(0).max(100000).default(0), // 万分比
  fixedFee: z.number().int().min(0).default(0), // 分
  minFee: z.number().int().min(0).optional(),
  maxFee: z.number().int().min(0).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  priority: z.number().int().min(0).max(9999).default(0),
  remark: z.string().max(256).optional(),
}).superRefine((value, ctx) => {
  if (value.payMethod && PAYMENT_METHOD_CHANNEL[value.payMethod] !== value.channel) {
    ctx.addIssue({ code: 'custom', path: ['payMethod'], message: '支付方式与支付渠道不匹配' });
  }
});

export const updatePaymentFeeRuleSchema = partialForUpdate(createPaymentFeeRuleSchema);

/** 分账接收方 */
export const createPaymentSharingReceiverSchema = z.object({
  name: z.string().min(1).max(64),
  receiverType: z.enum(['merchant', 'personal']).default('merchant'),
  account: z.string().min(1).max(128),
  ratioBps: z.number().int().min(0).max(10000).optional(), // 万分比
  autoShare: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updatePaymentSharingReceiverSchema = partialForUpdate(createPaymentSharingReceiverSchema);

export const createPaymentSharingReversalSchema = z.object({
  reason: z.string().trim().min(1, '冲正原因不能为空').max(256),
});

export type CreatePaymentSharingReversalInput = z.infer<typeof createPaymentSharingReversalSchema>;

/** 发起分账（金额留空 = 按接收方比例计算） */
export const dispatchPaymentSharingSchema = z.object({
  orderNo: z.string().min(1).max(64),
  receiverId: z.number().int().positive(),
  amount: z.number().int().positive().optional(), // 分
  remark: z.string().max(256).optional(),
});

export type DispatchPaymentSharingInput = z.infer<typeof dispatchPaymentSharingSchema>;

/** 对账差异处理 */
export const handlePaymentReconItemSchema = z.object({
  action: z.enum(['adjusted', 'suspended', 'ignored']),
  remark: z.string().trim().min(1, '处理原因不能为空').max(256),
});

/** 转账/代付 */
export const createPaymentTransferSchema = z.object({
  applicationId: z.number().int().positive(),
  channel: paymentChannelZ,
  currency: z.literal('CNY').default('CNY'),
  receiverAccount: z.string().min(1).max(128),
  receiverName: z.string().max(64).optional(),
  amount: z.number().int().positive('转账金额必须大于 0'), // 分
  remark: z.string().trim().min(1, '转账原因不能为空').max(256),
  bizType: z.string().max(64).optional(),
  bizId: z.string().max(128).optional(),
});

export const approvePaymentTransferSchema = z.object({
  remark: z.string().trim().min(1, '审批意见不能为空').max(256),
});

/** 支付应用（App 维度） */
export const createPaymentAppSchema = z.object({
  name: z.string().min(1).max(64),
  openClientId: z.number().int().positive(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  wechatConfigId: z.number().int().positive().nullable().optional(),
  alipayConfigId: z.number().int().positive().nullable().optional(),
  unionpayConfigId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(256).optional(),
});

export const updatePaymentAppSchema = partialForUpdate(createPaymentAppSchema).omit({ openClientId: true });

/** 开放支付 API：应用、租户与商户路由全部由已验签 principal 推导。 */
export const createOpenPaymentIntentSchema = createPaymentSchema.omit({
  applicationId: true,
  userId: true,
});

export const createOpenPaymentRefundSchema = createRefundSchema;

/** 支付链接 */
export const createPaymentLinkSchema = z.object({
  applicationId: z.number().int().positive(),
  subject: z.string().min(1).max(256),
  amount: z.number().int().positive().optional(), // 分，留空=用户填写
  payMethod: paymentMethodZ.optional(),
  bizType: z.string().min(1).max(64),
  maxUses: z.number().int().positive().optional(),
  expiredAt: z.string().max(32).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(256).optional(),
});

export const updatePaymentLinkSchema = partialForUpdate(createPaymentLinkSchema).omit({ applicationId: true });

/** 公开收银台下单：金额仅在链接未固定金额时需要；微信 JSAPI 需 openId */
export const payPaymentLinkSchema = z.object({
  amount: z.number().int().positive().optional(), // 分
  payMethod: z.enum(PAYMENT_LINK_PAY_METHODS).optional(),
  openId: z.string().max(128).optional(),
});

export type PayPaymentLinkInput = z.infer<typeof payPaymentLinkSchema>;

/** 风控限额规则 */
export const createPaymentRiskRuleSchema = z.object({
  name: z.string().min(1).max(64),
  scope: z.enum(['global', 'channel', 'bizType']).default('global'),
  channel: paymentChannelZ.optional(),
  bizType: z.string().max(64).optional(),
  singleLimit: z.number().int().min(0).optional(), // 分
  dailyLimit: z.number().int().min(0).optional(), // 分
  dailyCountLimit: z.number().int().min(0).optional(),
  blockListKeys: z.array(z.string().min(1).max(64)).default([]),
  allowListKeys: z.array(z.string().min(1).max(64)).default([]),
  action: z.enum(['block', 'review']).default('block'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updatePaymentRiskRuleSchema = partialForUpdate(createPaymentRiskRuleSchema);

/** 人工审核处理 */
export const handlePaymentRiskReviewSchema = z.object({
  remark: z.string().trim().min(1, '审核意见不能为空').max(256),
});

export type HandlePaymentRiskReviewInput = z.infer<typeof handlePaymentRiskReviewSchema>;

/** 资金账户人工调账（走台账 adjust 流水联动可用余额） */
// ─── 预授权（资金冻结/解冻/转支付）───────────────────────────────────────────
export const createPaymentPreauthSchema = z.object({
  applicationId: z.number().int().positive(),
  payMethod: z.enum(['wechat_preauth', 'alipay_preauth']),
  currency: z.literal('CNY').default('CNY'),
  payerAccount: z.string().min(1, '付款人账号不能为空').max(128),
  subject: z.string().min(1, '冻结事由不能为空').max(256),
  frozenAmount: z.number().int().positive('冻结金额必须大于 0'), // 分
  bizType: z.string().max(64).optional(),
  bizId: z.string().min(1, '业务单号不能为空').max(128),
  remark: z.string().max(256).optional(),
});

export type CreatePaymentPreauthInput = z.infer<typeof createPaymentPreauthSchema>;

export const capturePaymentPreauthSchema = z.object({
  /** 转支付金额（分），留空 = 全额；不足冻结额的剩余部分自动解冻 */
  captureAmount: z.number().int().positive().optional(),
  remark: z.string().max(256).optional(),
});

export type CapturePaymentPreauthInput = z.infer<typeof capturePaymentPreauthSchema>;

/** 支付方式配置（仅更新展示/启停/排序） */
export const updatePaymentMethodConfigSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  icon: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

// ─── 签约代扣（周期扣款/订阅）─────────────────────────────────────────────────
/** 扣款计划 */
export const createPaymentDeductPlanSchema = z.object({
  name: z.string().min(1, '计划名称不能为空').max(64),
  period: z.enum(['daily', 'weekly', 'monthly', 'custom']).default('monthly'),
  customDays: z.number().int().min(1).max(3650).nullable().optional(),
  amount: z.number().int().positive('每期扣款金额必须大于 0'), // 分
  maxRetries: z.number().int().min(0).max(10).default(3),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
}).refine((v) => v.period !== 'custom' || (v.customDays != null && v.customDays >= 1), {
  message: '自定义周期必须填写天数',
  path: ['customDays'],
});

export const updatePaymentDeductPlanSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'custom']).optional(),
  customDays: z.number().int().min(1).max(3650).nullable().optional(),
  amount: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  remark: z.string().max(256).optional(),
});

/** 管理端创建签约协议（演示/测试用，sandbox 渠道即时签约生效） */
export const createPaymentContractSchema = z.object({
  applicationId: z.number().int().positive(),
  planId: z.number().int().positive(),
  payMethod: z.enum(['wechat_papay', 'alipay_cycle']),
  currency: z.literal('CNY').default('CNY'),
  signerAccount: z.string().min(1, '签约账号不能为空').max(128),
  signerName: z.string().max(64).optional(),
  remark: z.string().max(256).optional(),
  /** 签约成功后是否立即执行首期扣款 */
  firstDeductNow: z.boolean().default(true),
});

export type CreatePaymentDeductPlanInput = z.infer<typeof createPaymentDeductPlanSchema>;

export type UpdatePaymentDeductPlanInput = z.infer<typeof updatePaymentDeductPlanSchema>;

export type CreatePaymentContractInput = z.infer<typeof createPaymentContractSchema>;

// ─── 交易投诉/争议 ────────────────────────────────────────────────────────────
/** 商户回复投诉 */
export const replyPaymentDisputeSchema = z.object({
  content: z.string().min(1, '回复内容不能为空').max(1000),
});

/** 完结投诉 */
export const resolvePaymentDisputeSchema = z.object({
  remark: z.string().max(500).optional(),
});

/** 投诉发起退款（复用支付中心退款链路） */
export const refundPaymentDisputeSchema = z.object({
  refundAmount: z.number().int().positive().optional(), // 分，留空 = 全额（涉诉金额）
  reason: z.string().max(256).optional(),
});

/** 模拟一条投诉（演示 / 联调；不指定订单号则随机取一笔成功订单） */
export const simulatePaymentDisputeSchema = z.object({
  orderNo: z.string().max(64).optional(),
});

export type ReplyPaymentDisputeInput = z.infer<typeof replyPaymentDisputeSchema>;

export type ResolvePaymentDisputeInput = z.infer<typeof resolvePaymentDisputeSchema>;

export type RefundPaymentDisputeInput = z.infer<typeof refundPaymentDisputeSchema>;

export type SimulatePaymentDisputeInput = z.infer<typeof simulatePaymentDisputeSchema>;

// ─── 最终资金内核：双分录与资金预占 ──────────────────────────────────
const PAYMENT_BIGINT_MAX = 9_223_372_036_854_775_807n;

export const paymentAmountStringSchema = z.string()
  .regex(/^[1-9]\d*$/, '金额必须是正整数十进制字符串')
  .max(19, '金额超出支持范围')
  .refine((value) => BigInt(value) <= PAYMENT_BIGINT_MAX, '金额超出 bigint 支持范围');

const paymentZeroAmountStringSchema = z.string()
  .regex(/^(0|[1-9]\d*)$/, '金额必须是规范的非负整数十进制字符串')
  .max(19, '金额超出支持范围')
  .refine((value) => BigInt(value) <= PAYMENT_BIGINT_MAX, '金额超出 bigint 支持范围');

const paymentCurrencySchema = z.string().regex(/^[A-Z]{3}$/, '币种必须是三位大写 ISO 4217 代码');
const manualMoneySourceTypeSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^manual\.[a-z0-9._-]+$/, '人工资金来源类型必须以 manual. 开头');

export const createPaymentLedgerAccountSchema = z.object({
  name: z.string().trim().min(1).max(128),
  code: z.enum(PAYMENT_LEDGER_ACCOUNT_CODES),
  appId: z.number().int().positive(),
  channelConfigId: z.number().int().positive(),
  currency: paymentCurrencySchema,
});

export const postPaymentJournalSchema = z.object({
  sourceType: manualMoneySourceTypeSchema,
  sourceId: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(512),
  appId: z.number().int().positive(),
  channelConfigId: z.number().int().positive(),
  currency: paymentCurrencySchema,
  lines: z.array(z.object({
    accountId: z.number().int().positive(),
    debitAmount: paymentZeroAmountStringSchema.default('0'),
    creditAmount: paymentZeroAmountStringSchema.default('0'),
    memo: z.string().trim().max(256).optional(),
  }).superRefine((line, ctx) => {
    const debit = BigInt(line.debitAmount);
    const credit = BigInt(line.creditAmount);
    if ((debit > 0n) === (credit > 0n)) {
      ctx.addIssue({ code: 'custom', message: '每条分录必须且只能填写借方或贷方金额' });
    }
  })).min(2).max(100),
});

export const reversePaymentJournalSchema = z.object({
  reason: z.string().trim().min(1, '冲正原因不能为空').max(512),
});

export const createPaymentFundReservationSchema = z.object({
  accountId: z.number().int().positive(),
  sourceType: manualMoneySourceTypeSchema,
  sourceId: z.string().trim().min(1).max(128),
  amount: paymentAmountStringSchema,
  reason: z.string().trim().min(1, '预占原因不能为空').max(256),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '时间格式应为 YYYY-MM-DD HH:mm:ss').optional(),
});

export const transitionPaymentFundReservationSchema = z.object({
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(1, '处理原因不能为空').max(256),
});

export const paymentFundReservationStatusSchema = z.enum(PAYMENT_FUND_RESERVATION_STATUSES);

export type CreatePaymentLedgerAccountInput = z.infer<typeof createPaymentLedgerAccountSchema>;

export type PostPaymentJournalInput = z.infer<typeof postPaymentJournalSchema>;

export type ReversePaymentJournalInput = z.infer<typeof reversePaymentJournalSchema>;

export type CreatePaymentFundReservationInput = z.infer<typeof createPaymentFundReservationSchema>;

export type TransitionPaymentFundReservationInput = z.infer<typeof transitionPaymentFundReservationSchema>;

export type CreatePaymentFeeRuleInput = z.infer<typeof createPaymentFeeRuleSchema>;

export type UpdatePaymentFeeRuleInput = z.infer<typeof updatePaymentFeeRuleSchema>;

export type CreatePaymentSharingReceiverInput = z.infer<typeof createPaymentSharingReceiverSchema>;

export type UpdatePaymentSharingReceiverInput = z.infer<typeof updatePaymentSharingReceiverSchema>;

export type HandlePaymentReconItemInput = z.infer<typeof handlePaymentReconItemSchema>;

export type CreatePaymentTransferInput = z.infer<typeof createPaymentTransferSchema>;

export type ApprovePaymentTransferInput = z.infer<typeof approvePaymentTransferSchema>;

export type CreatePaymentAppInput = z.infer<typeof createPaymentAppSchema>;

export type UpdatePaymentAppInput = z.infer<typeof updatePaymentAppSchema>;

export type CreateOpenPaymentIntentInput = z.infer<typeof createOpenPaymentIntentSchema>;

export type CreateOpenPaymentRefundInput = z.infer<typeof createOpenPaymentRefundSchema>;

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

export type UpdatePaymentLinkInput = z.infer<typeof updatePaymentLinkSchema>;

export type CreatePaymentRiskRuleInput = z.infer<typeof createPaymentRiskRuleSchema>;

export type UpdatePaymentRiskRuleInput = z.infer<typeof updatePaymentRiskRuleSchema>;

export type UpdatePaymentMethodConfigInput = z.infer<typeof updatePaymentMethodConfigSchema>;

export const generateSelfSignedCertSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  days: z.number().int().min(1).max(3650).default(365),
  country: z.string().length(2).default('CN').optional(),
  organization: z.string().max(64).default('Organization').optional(),
  outputDir: z.string().max(500).optional(),
});

export type GenerateSelfSignedCertSchemaInput = z.infer<typeof generateSelfSignedCertSchema>;
