/**
 * 云闪付/银联全渠道适配器（Node 原生 crypto 实现 RSA-SHA256 签名/验签，外呼统一走 http-client）。
 *
 * 支持：二维码申码（unionpay_qr）/ 查单 / 退款 / 后台通知验签；签名规范：银联全渠道 5.1.0 signMethod=01。
 * 关单：银联无预支付关单接口，超时订单由本地状态机关闭（cron closeExpiredPaymentOrders）。
 * `sandbox=true` 时全部为模拟实现（二维码返回演示串），便于联调与演示。
 * 文档：https://open.unionpay.com/tjweb/acproduct/list?apiSvcId=448
 */
import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { httpPost } from '../http-client';
import { formatDateTime } from '../datetime';
import logger from '../logger';
import type { CreatePaymentResult } from '@zenith/shared/payment';
import { rsaSign, rsaVerify, ensurePem } from './signing';
import { trySandboxNotify } from './sandbox-notify';
import { UNIONPAY_PROVIDER_MANIFEST } from './capabilities';
import { billArtifact, decodeUnionpayFile, MAX_BILL_BYTES, providerBillRequest, readBillBytes, withBillEvidence } from './bill-io';
import { parseProviderBill } from './bill-parsers';
import { ProviderBillError } from './bill-types';
import {
  assertApprovedProviderGateway,
  providerHttpExceptionStatus,
  providerHttpOptions,
  readProviderResponseText,
} from './provider-http';
import type {
  AdapterContext,
  NotifyResult,
  PaymentChannelAdapter,
  PaymentQueryResult,
  RefundQueryResult,
  RefundResult,
} from './types';

const PROD_GATEWAY = 'https://gateway.95516.com/gateway/api/backTransReq.do';
const QUERY_GATEWAY = 'https://gateway.95516.com/gateway/api/queryTrans.do';
const BILL_GATEWAY = 'https://filedownload.95516.com/';

function requireField<T>(v: T | null | undefined, name: string): T {
  if (v === null || v === undefined || v === '') throw new HTTPException(400, { message: `云闪付配置缺失：${name}` });
  return v;
}

function txnTime(value: Date = new Date()): string {
  const d = value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 银联签名串：按 key ASCII 升序拼接 k=v（& 连接，排除 signature 与空值） */
function buildSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** signMethod=01：对参数串 SHA-256 摘要（hex）后 RSA-SHA256 私钥签名 */
function signUnionpay(ctx: AdapterContext, params: Record<string, string>): string {
  const privateKey = ensurePem(requireField(ctx.secrets.unionpayPrivateKey, '商户私钥'), 'PRIVATE KEY');
  const digest = createHash('sha256').update(buildSignContent(params), 'utf8').digest('hex');
  return rsaSign(digest, privateKey, 'RSA-SHA256');
}

function verifyUnionpay(ctx: AdapterContext, params: Record<string, string>): boolean {
  const pubKey = ctx.config.unionpayPublicKey ? ensurePem(ctx.config.unionpayPublicKey, 'PUBLIC KEY') : '';
  if (!pubKey) return false;
  const digest = createHash('sha256').update(buildSignContent(params), 'utf8').digest('hex');
  return rsaVerify(digest, params.signature ?? '', pubKey, 'RSA-SHA256');
}

function baseParams(ctx: AdapterContext): Record<string, string> {
  return {
    version: '5.1.0',
    encoding: 'utf-8',
    signMethod: '01',
    accessType: '0',
    merId: requireField(ctx.config.unionpayMerId, '商户号(merId)'),
    certId: requireField(ctx.config.unionpayCertId, '证书序列号(certId)'),
  };
}

function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    out[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1).replaceAll('+', ' '));
  }
  return out;
}

function encodeForm(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
}

async function unionpayRequest(ctx: AdapterContext, gateway: string, params: Record<string, string>): Promise<Record<string, string>> {
  requireField(ctx.config.unionpayPublicKey, '验签公钥');
  params.signature = signUnionpay(ctx, params);
  const configuredUrl = gateway === BILL_GATEWAY ? BILL_GATEWAY : ctx.config.unionpayGateway
    ? ctx.config.unionpayGateway.replace(/backTransReq\.do$/, gateway.split('/').pop() ?? '')
    : gateway;
  const url = assertApprovedProviderGateway(configuredUrl, 'unionpay');
  const resp = await httpPost(url, encodeForm(params), {
    ...providerHttpOptions(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
  });
  const text = gateway === BILL_GATEWAY
    ? (await readBillBytes(resp, MAX_BILL_BYTES * 2)).toString('utf8')
    : await readProviderResponseText(resp, '云闪付');
  if (!resp.ok) {
    logger.warn('[unionpay] api error', { status: resp.status, body: text.slice(0, 500) });
    throw new HTTPException(providerHttpExceptionStatus(resp.status), { message: `云闪付接口错误(${resp.status})` });
  }
  let res: Record<string, string>;
  try {
    res = parseForm(text);
  } catch {
    throw new HTTPException(502, { message: '云闪付同步响应解析失败' });
  }
  if (!verifyUnionpay(ctx, res)) {
    if (gateway === BILL_GATEWAY) throw new ProviderBillError('integrity', '银联账单申请响应验签失败');
    logger.warn('[unionpay] response signature invalid', { url, respCode: res.respCode });
    throw new HTTPException(502, { message: '云闪付同步响应验签失败' });
  }
  const expectedMerchantId = requireField(ctx.config.unionpayMerId, '商户号(merId)');
  if (!res.merId || res.merId !== expectedMerchantId) {
    if (gateway === BILL_GATEWAY) throw new ProviderBillError('integrity', '银联账单申请响应商户身份不匹配');
    throw new HTTPException(502, { message: '云闪付同步响应商户号不匹配' });
  }
  if (gateway === BILL_GATEWAY && res.respCode !== '00') {
    if (res.respCode === '98') throw new ProviderBillError('no_bill', '银联未提供该账期文件，需确认出账状态，不代表零交易');
    if (res.respCode === '03') throw new ProviderBillError('waiting', '银联账单文件正在处理');
    throw new ProviderBillError(['01', '02', '05'].includes(res.respCode) ? 'temporary' : 'permanent', `银联账单申请失败(${res.respCode})`);
  }
  if (res.respCode && res.respCode !== '00' && res.respCode !== '03') {
    throw new HTTPException(400, { message: `云闪付错误(${res.respCode})：${res.respMsg ?? '未知错误'}` });
  }
  return res;
}

function unionpayCurrency(currencyCode: string | undefined): string | undefined {
  return currencyCode === '156' ? 'CNY' : undefined;
}

function mapUnionpayStatus(respCode: string | undefined, origRespCode: string | undefined): PaymentQueryResult['status'] {
  if (respCode !== '00') return 'pending'; // 查询本身失败按未知处理
  if (origRespCode === '00') return 'success';
  if (origRespCode === '03' || origRespCode === '04' || origRespCode === '05') return 'pending'; // 处理中
  return 'failed';
}

export const unionpayAdapter: PaymentChannelAdapter = {
  channel: 'unionpay',
  manifest: UNIONPAY_PROVIDER_MANIFEST,

  async downloadBill(ctx, billDate, kind = 'trade') {
    return providerBillRequest(async () => {
      if (ctx.config.sandbox) throw new ProviderBillError('permanent', '沙箱账单必须由独立模拟来源生成');
      if (kind !== 'trade') throw new ProviderBillError('permanent', '银联全渠道文件接口不提供独立资金余额账单');
      const merchantId = requireField(ctx.config.unionpayMerId, '商户号');
      const response = await unionpayRequest(ctx, BILL_GATEWAY, {
        ...baseParams(ctx), txnType: '76', txnSubType: '01', bizType: '000000',
        settleDate: billDate.replaceAll('-', '').slice(4), txnTime: txnTime(), fileType: '00',
      });
      if (response.settleDate !== billDate.replaceAll('-', '').slice(4) || response.txnType !== '76' || response.txnSubType !== '01') {
        throw new ProviderBillError('integrity', '银联文件响应账期或交易类型不匹配');
      }
      if (!response.fileContent) throw new ProviderBillError('integrity', '银联文件响应缺少账单内容');
      // Archive the signed response as evidence even when its compressed payload cannot be decoded.
      const envelope = billArtifact(Buffer.from(encodeForm(response)), `unionpay_${merchantId}_${billDate}_signed-response.txt`, 'text/plain');
      return withBillEvidence([envelope], () => {
        const bytes = decodeUnionpayFile(response.fileContent);
        const result = parseProviderBill('unionpay', kind, bytes, response.fileName || `unionpay_${merchantId}_${billDate}.zip`, merchantId, billDate);
        result.artifacts.unshift(envelope);
        return result;
      });
    });
  },

  async createPayment(ctx, order): Promise<CreatePaymentResult> {
    if (order.payMethod !== 'unionpay_qr') {
      throw new HTTPException(400, { message: `云闪付不支持的支付方式：${order.payMethod}` });
    }
    if (ctx.config.sandbox) {
      // 沙箱：返回演示二维码串（银联无公共沙箱二维码环境）
      logger.info('[unionpay] simulate createPayment (sandbox)', { orderNo: order.orderNo, amount: order.amount });
      await Promise.resolve();
      return {
        orderNo: order.orderNo,
        channel: 'unionpay',
        payMethod: order.payMethod,
        codeUrl: `https://qr.95516.com/demo/${order.outTradeNo}`,
        expiredAt: order.expiredAt ? formatDateTime(order.expiredAt) : undefined,
      };
    }
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '01',
      txnSubType: '07', // 申码
      bizType: '000000',
      channelType: '08',
      currencyCode: '156',
      orderId: order.outTradeNo,
      txnTime: txnTime(),
      txnAmt: String(order.amount),
      backUrl: ctx.notifyUrl,
    };
    const res = await unionpayRequest(ctx, PROD_GATEWAY, params);
    if (!res.qrCode) throw new HTTPException(502, { message: '云闪付申码失败：未返回二维码' });
    return { orderNo: order.orderNo, channel: 'unionpay', payMethod: order.payMethod, codeUrl: res.qrCode };
  },

  async queryPayment(ctx, order): Promise<PaymentQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return {
        status: 'pending',
        merchantId: ctx.config.unionpayMerId ?? undefined,
        currency: order.currency || 'CNY',
      }; // 沙箱订单由「模拟支付成功」运维入口推进
    }
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '00',
      txnSubType: '00',
      bizType: '000000',
      orderId: order.outTradeNo,
      txnTime: txnTime(order.createdAt),
      queryId: '',
    };
    delete params.queryId;
    const res = await unionpayRequest(ctx, QUERY_GATEWAY, params);
    return {
      status: mapUnionpayStatus(res.respCode, res.origRespCode),
      channelTradeNo: res.queryId,
      providerEventId: res.queryId,
      merchantId: res.merId,
      currency: unionpayCurrency(res.currencyCode),
      paidAmount: res.txnAmt ? Number(res.txnAmt) : undefined,
      raw: res,
    };
  },

  async closePayment(): Promise<void> {
    throw new HTTPException(400, { message: '云闪付二维码不支持渠道关单，不能声明为已关闭渠道订单' });
  },

  async refund(ctx, order, refund): Promise<RefundResult> {
    if (ctx.config.sandbox) {
      logger.info('[unionpay] simulate refund (sandbox)', { refundNo: refund.refundNo, amount: refund.refundAmount });
      await Promise.resolve();
      return { channelRefundNo: `UPREF${Date.now()}${randomBytes(3).toString('hex')}`, status: 'success' };
    }
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '04', // 退货
      txnSubType: '00',
      bizType: '000000',
      channelType: '08',
      orderId: refund.outRefundNo,
      origQryId: requireField(order.channelTradeNo, '原交易流水号(channelTradeNo)'),
      txnTime: txnTime(refund.createdAt),
      txnAmt: String(refund.refundAmount),
      backUrl: ctx.notifyUrl,
    };
    const res = await unionpayRequest(ctx, PROD_GATEWAY, params);
    // respCode 00=成功受理，03=处理中
    return { channelRefundNo: res.queryId, status: res.respCode === '00' ? 'processing' : 'failed', raw: res };
  },

  async queryRefund(ctx, refund): Promise<RefundQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return { status: 'success' };
    }
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '00',
      txnSubType: '00',
      bizType: '000000',
      orderId: refund.outRefundNo,
      txnTime: txnTime(),
    };
    const res = await unionpayRequest(ctx, QUERY_GATEWAY, params);
    const status = mapUnionpayStatus(res.respCode, res.origRespCode);
    return { status: status === 'success' ? 'success' : status === 'pending' ? 'processing' : 'failed', channelRefundNo: res.queryId, raw: res };
  },

  async verifyNotify(ctx, rawBody, headers): Promise<NotifyResult> {
    // 沙箱配置 + 协议头：走统一沙箱回调协议（明文 JSON），生产配置不受影响
    const sandboxResult = trySandboxNotify(ctx, rawBody, headers, { body: 'ok', contentType: 'text/plain', status: 200 });
    if (sandboxResult) return sandboxResult;
    const params = parseForm(rawBody);
    const valid = verifyUnionpay(ctx, params);
    const ack = { body: valid ? 'ok' : 'failure', contentType: 'text/plain', status: valid ? 200 : 401 };
    if (!valid) return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '云闪付回调验签失败' };
    // txnType 04 = 退货通知；01 = 消费通知
    const isRefund = params.txnType === '04';
    const merchantId = params.merId;
    if (!merchantId || merchantId !== ctx.config.unionpayMerId) {
      return { valid: false, scene: isRefund ? 'refund' : 'payment', tradeStatus: 'unknown', ack: { ...ack, body: 'failure', status: 401 }, message: '云闪付回调商户号不匹配' };
    }
    const currency = unionpayCurrency(params.currencyCode);
    if (!currency) {
      return { valid: false, scene: isRefund ? 'refund' : 'payment', tradeStatus: 'unknown', ack: { ...ack, body: 'failure', status: 400 }, message: '云闪付回调币种缺失或不支持' };
    }
    if (!params.queryId) {
      return { valid: false, scene: isRefund ? 'refund' : 'payment', tradeStatus: 'unknown', ack: { ...ack, body: 'failure', status: 400 }, message: '云闪付回调缺少渠道流水号' };
    }
    if (isRefund) {
      return {
        valid: true,
        scene: 'refund',
        ack,
        providerEventId: params.queryId,
        merchantId,
        currency,
        outRefundNo: params.orderId,
        channelRefundNo: params.queryId,
        tradeStatus: params.respCode === '00' ? 'refunded' : 'failed',
        paidAmount: params.txnAmt ? Number(params.txnAmt) : undefined,
        raw: params,
      };
    }
    return {
      valid: true,
      scene: 'payment',
      ack,
      providerEventId: params.queryId,
      merchantId,
      currency,
      outTradeNo: params.orderId,
      channelTradeNo: params.queryId,
      tradeStatus: params.respCode === '00' ? 'success' : 'failed',
      paidAmount: params.txnAmt ? Number(params.txnAmt) : undefined,
      raw: params,
    };
  },

  async testConnectivity(ctx: AdapterContext): Promise<void> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return; // 沙箱视为可用
    }
    // 查询一个不存在的订单：能正常返回（订单不存在）即凭据/签名有效
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '00',
      txnSubType: '00',
      bizType: '000000',
      orderId: `TEST${Date.now()}`,
      txnTime: txnTime(),
    };
    try {
      await unionpayRequest(ctx, QUERY_GATEWAY, params);
    } catch (err) {
      if (!(err instanceof HTTPException)) throw err;
      const msg = err.message ?? '';
      if (msg.includes('34') || msg.includes('订单不存在') || msg.includes('查询无结果')) return;
      throw err;
    }
  },
};
