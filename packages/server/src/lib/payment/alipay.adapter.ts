/**
 * 支付宝适配器（Node 原生 crypto 实现 RSA2 签名/验签，外呼统一走 http-client）。
 *
 * 支持：电脑网站(page) / 手机网站(wap) / APP；查单 / 关单 / 退款 / 退款查询 / 回调验签。
 * 文档：https://opendocs.alipay.com/open/270/105898
 */
import { HTTPException } from 'hono/http-exception';
import { httpPost } from '../http-client';
import { formatDateTime } from '../datetime';
import logger from '../logger';
import type { CreatePaymentResult } from '@zenith/shared';
import { rsaSign, rsaVerify, ensurePem, type RsaAlgorithm } from './signing';
import type {
  AdapterContext,
  ContractDeductInput,
  ContractDeductResult,
  ContractSignInput,
  ContractSignResult,
  PreauthCaptureInput,
  PreauthCaptureResult,
  PreauthFreezeInput,
  PreauthFreezeResult,
  NotifyResult,
  PaymentChannelAdapter,
  PaymentQueryResult,
  ProfitShareReceiver,
  ProfitShareResult,
  RefundQueryResult,
  RefundResult,
  TransferInput,
  TransferQueryResult,
  TransferResult,
} from './types';

const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const SANDBOX_GATEWAY = 'https://openapi.alipaydev.com/gateway.do';

function requireField<T>(v: T | null | undefined, name: string): T {
  if (v === null || v === undefined || v === '') throw new HTTPException(400, { message: `支付宝配置缺失：${name}` });
  return v;
}

function resolveGateway(ctx: AdapterContext): string {
  return ctx.config.alipayGateway || (ctx.config.sandbox ? SANDBOX_GATEWAY : PROD_GATEWAY);
}

function rsaAlgo(signType: string | null | undefined): RsaAlgorithm {
  return (signType ?? 'RSA2') === 'RSA' ? 'RSA-SHA1' : 'RSA-SHA256';
}

/** ASCII 码点序比较（支付宝验签要求按字符码点升序排列参数，不可用 localeCompare） */
function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function buildPublicParams(ctx: AdapterContext, method: string): Record<string, string> {
  return {
    app_id: requireField(ctx.config.alipayAppId, 'AppId'),
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: ctx.config.alipaySignType ?? 'RSA2',
    timestamp: formatDateTime(new Date()),
    version: '1.0',
    notify_url: ctx.notifyUrl,
  };
}

function signParams(ctx: AdapterContext, params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== '')
    .sort(asciiCompare);
  const content = keys.map((k) => `${k}=${params[k]}`).join('&');
  const privateKey = ensurePem(requireField(ctx.secrets.alipayPrivateKey, '应用私钥'), 'PRIVATE KEY');
  return rsaSign(content, privateKey, rsaAlgo(ctx.config.alipaySignType));
}

function encodeQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
}

/** 构造已签名参数集（page/wap 拼成跳转 URL，app 直接用 query 串） */
function buildSignedParams(ctx: AdapterContext, method: string, bizContent: Record<string, unknown>): Record<string, string> {
  const params = buildPublicParams(ctx, method);
  params.biz_content = JSON.stringify(bizContent);
  params.sign = signParams(ctx, params);
  return params;
}

/** 验证支付宝同步响应签名：从原始响应文本中截取 *_response 节点原文并用支付宝公钥验签 */
function verifyAlipayResponse(rawText: string, method: string, publicKeyPem: string, algorithm: RsaAlgorithm): boolean {
  const nodeName = `${method.replaceAll('.', '_')}_response`;
  const nodeIdx = rawText.indexOf(`"${nodeName}"`);
  const signIdx = rawText.indexOf('"sign"');
  if (nodeIdx < 0 || signIdx < 0) return false;
  const start = rawText.indexOf('{', nodeIdx);
  const end = rawText.lastIndexOf('}', signIdx);
  if (start < 0 || end < 0 || end < start) return false;
  const signContent = rawText.slice(start, end + 1);
  const signMatch = /"sign"\s*:\s*"([^"]+)"/.exec(rawText.slice(signIdx));
  if (!signMatch) return false;
  return rsaVerify(signContent, signMatch[1], publicKeyPem, algorithm);
}

async function alipayApiCall(
  ctx: AdapterContext,
  method: string,
  bizContent: Record<string, unknown>,
  responseKey: string,
): Promise<Record<string, any>> {
  const params = buildSignedParams(ctx, method, bizContent);
  const formBody = encodeQuery(params);
  const resp = await httpPost(resolveGateway(ctx), formBody, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
  });
  const text = await resp.text();
  if (!resp.ok) {
    logger.warn('[alipay] api error', { method, status: resp.status, body: text.slice(0, 500) });
    throw new HTTPException(502, { message: `支付宝接口错误(${resp.status})` });
  }
  // 响应验签（仅当已配置支付宝公钥）：防止网关响应被中间人篡改
  const respPubKey = ctx.config.alipayPublicKey ? ensurePem(ctx.config.alipayPublicKey, 'PUBLIC KEY') : '';
  if (respPubKey && !verifyAlipayResponse(text, method, respPubKey, rsaAlgo(ctx.config.alipaySignType))) {
    logger.warn('[alipay] response signature invalid', { method });
    throw new HTTPException(502, { message: '支付宝响应验签失败' });
  }
  let json: Record<string, any>;
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    throw new HTTPException(502, { message: '支付宝响应解析失败' });
  }
  const data = json[responseKey] as Record<string, any> | undefined;
  if (!data) throw new HTTPException(502, { message: '支付宝响应格式异常' });
  const isQuery = method === 'alipay.trade.query' || method === 'alipay.trade.fastpay.refund.query';
  if (!isQuery && data.code && data.code !== '10000') {
    throw new HTTPException(400, { message: `支付宝错误：${data.sub_msg || data.msg || data.code}` });
  }
  return data;
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromYuan(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return Math.round(Number.parseFloat(value) * 100);
}

function mapAlipayState(status: string | undefined): PaymentQueryResult['status'] {
  switch (status) {
    case 'TRADE_SUCCESS':
    case 'TRADE_FINISHED':
      return 'success';
    case 'TRADE_CLOSED':
      return 'closed';
    default:
      return 'pending'; // WAIT_BUYER_PAY
  }
}

function mapAlipayNotifyStatus(status: string | undefined): NotifyResult['tradeStatus'] {
  if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') return 'success';
  if (status === 'TRADE_CLOSED') return 'closed';
  return 'failed';
}

function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = decodeURIComponent(pair.slice(0, idx).replaceAll('+', ' '));
    const v = decodeURIComponent(pair.slice(idx + 1).replaceAll('+', ' '));
    out[k] = v;
  }
  return out;
}

export const alipayAdapter: PaymentChannelAdapter = {
  channel: 'alipay',

  async createPayment(ctx, order): Promise<CreatePaymentResult> {
    const expiredAt = order.expiredAt ? formatDateTime(order.expiredAt) : undefined;
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate createPayment (sandbox)', { orderNo: order.orderNo, payMethod: order.payMethod });
      await Promise.resolve();
      const mockNo = `SBX${order.orderNo}`;
      switch (order.payMethod) {
        case 'alipay_page':
        case 'alipay_wap':
          return { orderNo: order.orderNo, channel: 'alipay', payMethod: order.payMethod, payUrl: `https://sandbox.alipay.example/pay/${mockNo}`, expiredAt };
        case 'alipay_app':
          return { orderNo: order.orderNo, channel: 'alipay', payMethod: order.payMethod, appOrderStr: `sandbox_order_str_${mockNo}`, expiredAt };
        default:
          throw new HTTPException(400, { message: `支付宝不支持的支付方式：${order.payMethod}` });
      }
    }
    const bizBase: Record<string, unknown> = {
      out_trade_no: order.outTradeNo,
      total_amount: yuan(order.amount),
      subject: order.subject,
      body: order.body || undefined,
      time_expire: order.expiredAt ? formatDateTime(order.expiredAt) : undefined,
    };
    const gateway = resolveGateway(ctx);
    switch (order.payMethod) {
      case 'alipay_page': {
        const params = buildSignedParams(ctx, 'alipay.trade.page.pay', { ...bizBase, product_code: 'FAST_INSTANT_TRADE_PAY' });
        return { orderNo: order.orderNo, channel: 'alipay', payMethod: order.payMethod, payUrl: `${gateway}?${encodeQuery(params)}`, expiredAt };
      }
      case 'alipay_wap': {
        const params = buildSignedParams(ctx, 'alipay.trade.wap.pay', { ...bizBase, product_code: 'QUICK_WAP_WAY' });
        return { orderNo: order.orderNo, channel: 'alipay', payMethod: order.payMethod, payUrl: `${gateway}?${encodeQuery(params)}`, expiredAt };
      }
      case 'alipay_app': {
        const params = buildSignedParams(ctx, 'alipay.trade.app.pay', { ...bizBase, product_code: 'QUICK_MSECURITY_PAY' });
        return { orderNo: order.orderNo, channel: 'alipay', payMethod: order.payMethod, appOrderStr: encodeQuery(params), expiredAt };
      }
      default:
        throw new HTTPException(400, { message: `支付宝不支持的支付方式：${order.payMethod}` });
    }
  },

  async queryPayment(ctx, order): Promise<PaymentQueryResult> {
    if (ctx.config.sandbox) {
      // 沙箱无渠道侧订单：维持本地状态，由运营「模拟支付成功」推进
      await Promise.resolve();
      return { status: order.status === 'success' ? 'success' : 'pending' };
    }
    const res = await alipayApiCall(ctx, 'alipay.trade.query', { out_trade_no: order.outTradeNo }, 'alipay_trade_query_response');
    if (res.code !== '10000') return { status: 'pending', raw: res };
    return {
      status: mapAlipayState(res.trade_status),
      channelTradeNo: res.trade_no,
      paidAmount: centsFromYuan(res.total_amount),
      paidAt: res.send_pay_date ? new Date(res.send_pay_date) : undefined,
      raw: res,
    };
  },

  async closePayment(ctx, order): Promise<void> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return;
    }
    await alipayApiCall(ctx, 'alipay.trade.close', { out_trade_no: order.outTradeNo }, 'alipay_trade_close_response');
  },

  async refund(ctx, order, refund): Promise<RefundResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate refund (sandbox)', { outRefundNo: refund.outRefundNo, amount: refund.refundAmount });
      await Promise.resolve();
      return { channelRefundNo: `ALIRF${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'success' };
    }
    const res = await alipayApiCall(
      ctx,
      'alipay.trade.refund',
      {
        out_trade_no: order.outTradeNo,
        out_request_no: refund.outRefundNo,
        refund_amount: yuan(refund.refundAmount),
        refund_reason: refund.reason || undefined,
      },
      'alipay_trade_refund_response',
    );
    // 支付宝退款同步返回，code=10000 即退款成功
    return { channelRefundNo: res.trade_no, status: res.code === '10000' ? 'success' : 'failed', raw: res };
  },

  async queryRefund(ctx, refund, order): Promise<RefundQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return { status: 'success' };
    }
    const res = await alipayApiCall(
      ctx,
      'alipay.trade.fastpay.refund.query',
      { out_trade_no: order.outTradeNo, out_request_no: refund.outRefundNo },
      'alipay_trade_fastpay_refund_query_response',
    );
    const success = res.code === '10000' && res.refund_status === 'REFUND_SUCCESS';
    return {
      channelRefundNo: res.trade_no,
      status: success ? 'success' : 'processing',
      refundedAt: res.gmt_refund_pay ? new Date(res.gmt_refund_pay) : undefined,
      raw: res,
    };
  },

  async verifyNotify(ctx, rawBody): Promise<NotifyResult> {
    const params = parseForm(rawBody);
    const sign = params.sign ?? '';
    const signType = params.sign_type ?? 'RSA2';
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
      .sort(asciiCompare);
    const content = keys.map((k) => `${k}=${params[k]}`).join('&');
    const pubKey = ctx.config.alipayPublicKey ? ensurePem(ctx.config.alipayPublicKey, 'PUBLIC KEY') : '';
    const algorithm = rsaAlgo(signType);
    const valid = pubKey ? rsaVerify(content, sign, pubKey, algorithm) : false;
    const ack = { body: valid ? 'success' : 'failure', contentType: 'text/plain', status: 200 };
    if (!valid) return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '支付宝回调验签失败' };
    return {
      valid: true,
      scene: 'payment',
      ack,
      outTradeNo: params.out_trade_no,
      channelTradeNo: params.trade_no,
      tradeStatus: mapAlipayNotifyStatus(params.trade_status),
      paidAmount: centsFromYuan(params.total_amount),
      paidAt: params.gmt_payment ? new Date(params.gmt_payment) : undefined,
      raw: params,
    };
  },

  async testConnectivity(ctx: AdapterContext): Promise<void> {
    const fakeNo = `TEST${Date.now()}`;
    try {
      await alipayApiCall(ctx, 'alipay.trade.query', { out_trade_no: fakeNo }, 'alipay_trade_query_response');
      // 意外成功也视为凭据可用
    } catch (err) {
      if (!(err instanceof HTTPException)) throw err;
      const msg = err.message ?? '';
      // TRADE_NOT_EXIST / ACQ.TRADE_NOT_EXIST / 交易不存在 = 凭据有效
      if (msg.includes('TRADE_NOT_EXIST') || msg.includes('交易不存在')) return;
      throw err; // 签名错误 / 权限未授权 / 其他鉴权失败
    }
  },

  async profitShare(_ctx: AdapterContext, order, receiver: ProfitShareReceiver, _outSharingNo: string): Promise<ProfitShareResult> {
    // 模拟实现：支付宝「分账请求」(alipay.trade.order.settle) 需签约分账协议并预先绑定分账关系，第一期保持模拟。
    logger.info('[alipay] simulate profit share', { orderNo: order.orderNo, account: receiver.account, amount: receiver.amount });
    await Promise.resolve();
    return { channelSharingNo: `ALISHARE${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'success' };
  },

  async transfer(ctx: AdapterContext, input: TransferInput): Promise<TransferResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate transfer (sandbox)', { outTransferNo: input.outTransferNo, amount: input.amount });
      await Promise.resolve();
      return { channelTransferNo: `ALITRF${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'success' };
    }
    const res = await alipayApiCall(
      ctx,
      'alipay.fund.trans.uni.transfer',
      {
        out_biz_no: input.outTransferNo,
        trans_amount: yuan(input.amount),
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
        order_title: (input.remark || '转账').slice(0, 128),
        payee_info: {
          identity: input.receiverAccount,
          identity_type: 'ALIPAY_LOGON_ID',
          name: input.receiverName || undefined,
        },
      },
      'alipay_fund_trans_uni_transfer_response',
    );
    // code=10000 且 status=SUCCESS 表示转账成功；DEALING 为处理中
    const status: TransferResult['status'] = res.status === 'SUCCESS' ? 'success' : res.status === 'DEALING' ? 'processing' : 'failed';
    return { channelTransferNo: res.order_id ?? res.pay_fund_order_id, status, raw: res };
  },

  async queryTransfer(ctx: AdapterContext, input): Promise<TransferQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return { status: 'success' };
    }
    const res = await alipayApiCall(
      ctx,
      'alipay.fund.trans.common.query',
      { out_biz_no: input.outTransferNo, product_code: 'TRANS_ACCOUNT_NO_PWD', biz_scene: 'DIRECT_TRANSFER' },
      'alipay_fund_trans_common_query_response',
    );
    const status: TransferQueryResult['status'] = res.status === 'SUCCESS' ? 'success' : res.status === 'DEALING' ? 'processing' : 'failed';
    return {
      status,
      channelTransferNo: res.order_id ?? res.pay_fund_order_id,
      finishedAt: res.pay_date ? new Date(res.pay_date) : undefined,
      failReason: res.fail_reason ?? res.error_code,
      raw: res,
    };
  },

  // ── 签约代扣（周期扣款）：真实模式需商户开通周期扣款产品权限，本期仅支持沙箱模拟 ──
  async signContract(ctx: AdapterContext, input: ContractSignInput): Promise<ContractSignResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate contract sign (sandbox)', { outContractNo: input.outContractNo, plan: input.planName });
      await Promise.resolve();
      return { channelContractNo: `ALICT${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'signed' };
    }
    throw new HTTPException(400, { message: '支付宝周期扣款需商户开通产品权限，当前仅支持沙箱渠道签约' });
  },

  async terminateContract(ctx: AdapterContext, input): Promise<void> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate contract terminate (sandbox)', { outContractNo: input.outContractNo });
      await Promise.resolve();
      return;
    }
    throw new HTTPException(400, { message: '支付宝周期扣款需商户开通产品权限，当前仅支持沙箱渠道解约' });
  },

  async deductContract(ctx: AdapterContext, input: ContractDeductInput): Promise<ContractDeductResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate contract deduct (sandbox)', { outTradeNo: input.outTradeNo, amount: input.amount });
      await Promise.resolve();
      return { channelTradeNo: `ALIDED${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'success' };
    }
    throw new HTTPException(400, { message: '支付宝周期扣款需商户开通产品权限，当前仅支持沙箱渠道扣款' });
  },

  // ── 预授权（资金授权冻结/转交易/解冻）：真实模式需开通资金预授权产品权限，本期仅支持沙箱 ──
  async preauthFreeze(ctx: AdapterContext, input: PreauthFreezeInput): Promise<PreauthFreezeResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate preauth freeze (sandbox)', { outPreauthNo: input.outPreauthNo, amount: input.amount });
      await Promise.resolve();
      return { channelPreauthNo: `ALIPA${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'frozen' };
    }
    throw new HTTPException(400, { message: '支付宝资金预授权需商户开通产品权限，当前仅支持沙箱渠道冻结' });
  },

  async preauthCapture(ctx: AdapterContext, input: PreauthCaptureInput): Promise<PreauthCaptureResult> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate preauth capture (sandbox)', { outPreauthNo: input.outPreauthNo, captureAmount: input.captureAmount });
      await Promise.resolve();
      return { channelTradeNo: `ALIPAC${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'success' };
    }
    throw new HTTPException(400, { message: '支付宝资金预授权需商户开通产品权限，当前仅支持沙箱渠道转支付' });
  },

  async preauthRelease(ctx: AdapterContext, input): Promise<void> {
    if (ctx.config.sandbox) {
      logger.info('[alipay] simulate preauth release (sandbox)', { outPreauthNo: input.outPreauthNo });
      await Promise.resolve();
      return;
    }
    throw new HTTPException(400, { message: '支付宝资金预授权需商户开通产品权限，当前仅支持沙箱渠道解冻' });
  },
};
