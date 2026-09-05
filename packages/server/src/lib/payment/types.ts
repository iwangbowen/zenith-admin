/**
 * 支付渠道适配器契约。
 *
 * 每个支付渠道（微信/支付宝/…）实现 `PaymentChannelAdapter` 接口，
 * 门面层（payment.service）通过 registry 拿到对应 adapter 调用，
 * 完全不感知渠道差异与签名细节。
 */
import type { CreatePaymentResult, PaymentChannel, PaymentMethod } from '@zenith/shared/payment';
import type { PaymentChannelConfigRow, PaymentOrderRow, PaymentRefundRow } from '../../db/schema';

/** 已解密的渠道敏感凭据（仅在内存中存在，绝不落库/出参） */
export interface DecryptedSecrets {
  wechatApiV3Key?: string;
  wechatPrivateKey?: string;
  alipayPrivateKey?: string;
  unionpayPrivateKey?: string;
  /** 每份沙箱商户配置独立的回调签名密钥。 */
  sandboxNotifySecret?: string;
}

/** 适配器上下文：持有完整渠道配置 + 已解密凭据 + 回调地址 */
export interface AdapterContext {
  config: PaymentChannelConfigRow;
  secrets: DecryptedSecrets;
  /** 完整的异步通知回调地址（含渠道段） */
  notifyUrl: string;
}

export interface PaymentQueryResult {
  status: 'pending' | 'success' | 'closed' | 'failed';
  channelTradeNo?: string;
  /** 渠道事件/流水标识，供 Inbox 去重。 */
  providerEventId?: string;
  /** 渠道返回的商户身份，必须与订单绑定的商户配置核对。 */
  merchantId?: string;
  /** 渠道返回的应用身份。 */
  providerAppId?: string;
  /** ISO 4217 币种。 */
  currency?: string;
  /** 实付金额（分） */
  paidAmount?: number;
  paidAt?: Date;
  raw?: unknown;
}

/** 渠道资金操作（退款 / 分账 / 冲正 / 转账 / 代扣）的标准化受理状态：processing 需后续查询收敛 */
export type ChannelOperationStatus = 'processing' | 'success' | 'failed';

export interface RefundResult {
  channelRefundNo?: string;
  status: ChannelOperationStatus;
  raw?: unknown;
}

export interface RefundQueryResult {
  status: ChannelOperationStatus;
  channelRefundNo?: string;
  refundedAt?: Date;
  raw?: unknown;
}

/** 分账接收方（单笔分账目标） */
export interface ProfitShareReceiver {
  /** 接收方账号（商户号 / 个人 openid 等） */
  account: string;
  /** 分账金额（分） */
  amount: number;
  /** 接收方名称（备注用） */
  name?: string;
  /** 接收方类型 */
  receiverType?: 'merchant' | 'personal';
}

export interface ProfitShareResult {
  /** 渠道分账单号 */
  channelSharingNo?: string;
  status: ChannelOperationStatus;
  raw?: unknown;
}

/** 分账结果查询（processing 单的状态同步） */
export interface ProfitShareQueryResult {
  status: ChannelOperationStatus;
  channelSharingNo?: string;
  finishedAt?: Date;
  raw?: unknown;
}

export interface ProfitShareReverseInput {
  /** 原分账商户单号。 */
  outSharingNo: string;
  /** 原渠道分账单号。 */
  channelSharingNo?: string;
  /** 冲正商户单号，渠道幂等键。 */
  outReversalNo: string;
  amount: number;
  reason: string;
}

export interface ProfitShareReverseResult {
  channelReversalNo?: string;
  status: ChannelOperationStatus;
  failReason?: string;
  raw?: unknown;
}

export interface ProfitShareReverseQueryResult extends ProfitShareReverseResult {
  finishedAt?: Date;
}

/** 转账/代付入参（渠道无关的标准化字段） */
export interface TransferInput {
  /** 商户转账单号（幂等键，渠道侧按此去重） */
  outTransferNo: string;
  /** 收款账号（微信=openid，支付宝=登录账号/2088 用户号） */
  receiverAccount: string;
  /** 收款人姓名（可选；微信大额需实名校验，本实现不传） */
  receiverName?: string;
  /** 转账金额（分） */
  amount: number;
  /** 转账备注/标题 */
  remark?: string;
}

export interface TransferResult {
  /** 渠道转账单号（受理成功即返回） */
  channelTransferNo?: string;
  status: ChannelOperationStatus;
  raw?: unknown;
}

export interface TransferQueryResult {
  status: ChannelOperationStatus;
  channelTransferNo?: string;
  finishedAt?: Date;
  failReason?: string;
  raw?: unknown;
}

/** 签约代扣：签约入参（渠道无关标准化字段） */
export interface ContractSignInput {
  /** 本地协议号（渠道幂等键） */
  outContractNo: string;
  /** 签约账号（微信 openid / 支付宝账号） */
  signerAccount: string;
  /** 计划名称（渠道侧展示） */
  planName: string;
  /** 每期扣款金额（分） */
  amount: number;
  /** 周期描述（如 monthly） */
  period: string;
}

export interface ContractSignResult {
  /** 渠道协议号（签约成功后返回） */
  channelContractNo?: string;
  /** sandbox 即时 signed；真实渠道异步签约时为 pending */
  status: 'pending' | 'signed';
  raw?: unknown;
}

export interface ContractQueryInput {
  outContractNo: string;
  channelContractNo?: string;
  operation: 'sign' | 'terminate';
}

export interface ContractQueryResult {
  status: 'pending' | 'signed' | 'terminated' | 'failed';
  channelContractNo?: string;
  failReason?: string;
  raw?: unknown;
}

/** 签约代扣：单期扣款入参 */
export interface ContractDeductInput {
  /** 渠道协议号 */
  channelContractNo: string;
  /** 本期扣款商户订单号（幂等键） */
  outTradeNo: string;
  /** 扣款金额（分） */
  amount: number;
  subject: string;
}

export interface ContractDeductResult {
  channelTradeNo?: string;
  status: ChannelOperationStatus;
  failReason?: string;
  raw?: unknown;
}

/** 预授权：冻结入参 */
export interface PreauthFreezeInput {
  /** 本地预授权单号（渠道幂等键） */
  outPreauthNo: string;
  /** 付款人账号（微信 openid / 支付宝账号） */
  payerAccount: string;
  /** 冻结金额（分） */
  amount: number;
  subject: string;
}

export interface PreauthFreezeResult {
  /** 渠道资金授权订单号 */
  channelPreauthNo?: string;
  /** sandbox 即时 frozen；真实渠道异步授权时为 pending */
  status: 'pending' | 'frozen';
  raw?: unknown;
}

/** 预授权：转支付入参（冻结资金转正式交易，剩余部分渠道侧自动解冻） */
export interface PreauthCaptureInput {
  channelPreauthNo: string;
  outPreauthNo: string;
  /** 本次转支付生成的商户订单号 */
  outTradeNo: string;
  /** 转支付金额（分，≤冻结金额） */
  captureAmount: number;
  subject: string;
}

export interface PreauthCaptureResult {
  channelTradeNo?: string;
  status: 'success' | 'failed';
  failReason?: string;
  raw?: unknown;
}

export interface PreauthQueryInput {
  outPreauthNo: string;
  channelPreauthNo?: string;
  operation: 'freeze' | 'capture' | 'release';
  outTradeNo?: string;
  amount: number;
}

export interface PreauthQueryResult {
  status: 'pending' | 'frozen' | 'captured' | 'released' | 'failed';
  channelPreauthNo?: string;
  channelTradeNo?: string;
  failReason?: string;
  raw?: unknown;
}

/** 回调验签 + 解析后的标准化结果 */
export interface NotifyResult {
  /** 验签是否通过 */
  valid: boolean;
  /** 通知场景：支付 / 退款 */
  scene: 'payment' | 'refund';
  /** 商户订单号（out_trade_no） */
  outTradeNo?: string;
  /** 渠道交易号 */
  channelTradeNo?: string;
  /** 渠道通知唯一标识，供 Inbox 防重放。 */
  providerEventId?: string;
  /** 渠道报文中的商户身份。 */
  merchantId?: string;
  /** 渠道报文中的应用身份。 */
  providerAppId?: string;
  /** ISO 4217 币种。 */
  currency?: string;
  /** 商户退款单号（退款通知时） */
  outRefundNo?: string;
  channelRefundNo?: string;
  /** 标准化业务结果 */
  tradeStatus: 'success' | 'closed' | 'failed' | 'refunded' | 'unknown';
  /** 实付金额（分） */
  paidAmount?: number;
  paidAt?: Date;
  /** 需要回写给渠道的 ACK 响应 */
  ack: { body: string; contentType: string; status: number };
  message?: string;
  raw?: unknown;
}

export type PaymentProviderEnvironment = 'sandbox' | 'live';

export type PaymentProviderOperation =
  | 'payment.create'
  | 'payment.query'
  | 'payment.close'
  | 'refund.create'
  | 'refund.query'
  | 'notification.verify'
  | 'profit-sharing.create'
  | 'profit-sharing.query'
  | 'profit-sharing.reverse'
  | 'transfer.create'
  | 'transfer.query'
  | 'contract.sign'
  | 'contract.query'
  | 'contract.terminate'
  | 'contract.deduct'
  | 'preauth.freeze'
  | 'preauth.query'
  | 'preauth.capture'
  | 'preauth.release'
  | 'bill.download';

export type PaymentProviderExecution = 'redirect' | 'synchronous' | 'asynchronous' | 'local';

/** 渠道适配器实际可执行的单项能力，不表示渠道理论上提供但本系统尚未实现的产品。 */
export interface PaymentProviderCapability {
  operation: PaymentProviderOperation;
  environments: readonly PaymentProviderEnvironment[];
  paymentMethods?: readonly PaymentMethod[];
  currencies: readonly string[];
  execution: PaymentProviderExecution;
  /** 非沙箱环境执行该操作所需的配置字段。 */
  requiredConfigFields: readonly string[];
  limits?: Readonly<{
    maxAmount?: number;
    receiverNameRequiredAtOrAbove?: number;
  }>;
}

export interface PaymentProviderManifest {
  channel: PaymentChannel;
  displayName: string;
  /** 沙箱全链路统一需要的配置级回调密钥。 */
  sandboxRequiredConfigFields: readonly string[];
  capabilities: readonly PaymentProviderCapability[];
}

export interface PaymentChannelAdapter {
  readonly channel: PaymentChannel;
  /** 机器可读的真实实现能力，前后端不得再根据可选方法或静态枚举猜测。 */
  readonly manifest: PaymentProviderManifest;
  /** 下单：返回前端可直接使用的支付参数（二维码 / 跳转链接 / JSAPI 参数 / APP 调起串） */
  createPayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<CreatePaymentResult>;
  /** 主动查询支付状态（回调兜底） */
  queryPayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<PaymentQueryResult>;
  /** 关闭订单 */
  closePayment(ctx: AdapterContext, order: PaymentOrderRow): Promise<void>;
  /** 申请退款 */
  refund(ctx: AdapterContext, order: PaymentOrderRow, refund: PaymentRefundRow): Promise<RefundResult>;
  /** 查询退款状态 */
  queryRefund(ctx: AdapterContext, refund: PaymentRefundRow, order: PaymentOrderRow): Promise<RefundQueryResult>;
  /** 验签 + 解析异步回调 */
  verifyNotify(ctx: AdapterContext, rawBody: string, headers: Headers): Promise<NotifyResult>;
  /**
   * 发起单笔分账（可选）。
   * `outSharingNo` 为本地分账单号，作为渠道侧商户分账单号（幂等键 / 后续查询凭据）。
   * `sandbox=true` 时为模拟实现（生成渠道分账单号即时成功，便于联调与演示）；
   * 生产模式走渠道真实分账 API（微信「请求分账」需商户开通分账权限）。
   */
  profitShare?(ctx: AdapterContext, order: PaymentOrderRow, receiver: ProfitShareReceiver, outSharingNo: string): Promise<ProfitShareResult>;
  /** 查询分账结果（可选，用于同步 processing 分账单） */
  queryProfitShare?(ctx: AdapterContext, order: PaymentOrderRow, outSharingNo: string): Promise<ProfitShareQueryResult>;
  /** 分账冲正；outReversalNo 是渠道幂等键。 */
  reverseProfitShare?(ctx: AdapterContext, order: PaymentOrderRow, input: ProfitShareReverseInput): Promise<ProfitShareReverseResult>;
  /** 查询分账冲正结果；unknown/processing 只能经此接口收敛。 */
  queryProfitShareReverse?(ctx: AdapterContext, order: PaymentOrderRow, input: ProfitShareReverseInput): Promise<ProfitShareReverseQueryResult>;
  /**
   * 转账/代付（可选）：微信商家转账到零钱、支付宝单笔转账。
   * `sandbox=true` 时为模拟实现（即时成功）。
   */
  transfer?(ctx: AdapterContext, input: TransferInput): Promise<TransferResult>;
  /** 查询转账结果（可选，用于同步 processing 转账单） */
  queryTransfer?(ctx: AdapterContext, input: Pick<TransferInput, 'outTransferNo'>): Promise<TransferQueryResult>;
  /**
   * 签约代扣：签约（可选）。微信委托代扣 / 支付宝周期扣款。
   * `sandbox=true` 时为模拟实现（即时签约成功）；真实渠道需商户开通对应产品权限。
   */
  signContract?(ctx: AdapterContext, input: ContractSignInput): Promise<ContractSignResult>;
  /** 查询签约或解约结果；unknown 只能通过此接口收敛。 */
  queryContract?(ctx: AdapterContext, input: ContractQueryInput): Promise<ContractQueryResult>;
  /** 签约代扣：解约（可选）。`sandbox=true` 时为模拟实现（即时解约）。 */
  terminateContract?(ctx: AdapterContext, input: Pick<ContractSignInput, 'outContractNo'> & { channelContractNo?: string }): Promise<void>;
  /** 签约代扣：按协议发起单期扣款（可选，服务端发起，无用户交互）。`sandbox=true` 时即时成功。 */
  deductContract?(ctx: AdapterContext, input: ContractDeductInput): Promise<ContractDeductResult>;
  /** 预授权：冻结资金（可选）。`sandbox=true` 时即时冻结成功；真实渠道需开通资金授权产品权限。 */
  preauthFreeze?(ctx: AdapterContext, input: PreauthFreezeInput): Promise<PreauthFreezeResult>;
  /** 查询冻结/捕获/释放结果；unknown 只能通过此接口收敛。 */
  queryPreauth?(ctx: AdapterContext, input: PreauthQueryInput): Promise<PreauthQueryResult>;
  /** 预授权：转支付（可选）。冻结资金转正式交易，剩余部分渠道侧自动解冻。 */
  preauthCapture?(ctx: AdapterContext, input: PreauthCaptureInput): Promise<PreauthCaptureResult>;
  /** 预授权：解冻（可选）。 */
  preauthRelease?(ctx: AdapterContext, input: Pick<PreauthFreezeInput, 'outPreauthNo'> & { channelPreauthNo?: string }): Promise<void>;
  /**
   * 下载渠道对账单（可选）：返回内部标准 CSV（`订单号,渠道交易号,金额(分),状态`）。
   * `sandbox=true` 时由调用方（recon service）用本地订单生成模拟账单，不会调用此方法。
   */
  downloadBill?(ctx: AdapterContext, billDate: string): Promise<string>;
  /**
   * 连通性测试（可选）。
   * 向渠道发起一个轻量的探测请求（如查询一个不存在的订单号），
   * 用于验证商户凭据配置是否正确。"订单不存在"属预期结果，应正常返回；
   * 签名错误、鉴权失败等凭据问题则抛出异常。
   */
  testConnectivity?(ctx: AdapterContext): Promise<void>;
}
