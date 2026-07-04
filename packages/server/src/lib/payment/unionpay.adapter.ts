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
import logger from '../logger';
import type { CreatePaymentResult } from '@zenith/shared';
import { rsaSign, rsaVerify, ensurePem } from './signing';
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

function requireField<T>(v: T | null | undefined, name: string): T {
  if (v === null || v === undefined || v === '') throw new HTTPException(400, { message: `云闪付配置缺失：${name}` });
  return v;
}

function txnTime(): string {
  const d = new Date();
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
  params.signature = signUnionpay(ctx, params);
  const url = ctx.config.unionpayGateway ? ctx.config.unionpayGateway.replace(/backTransReq\.do$/, gateway.split('/').pop() ?? '') : gateway;
  const resp = await httpPost(url, encodeForm(params), { headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' } });
  const text = await resp.text();
  if (!resp.ok) {
    logger.warn('[unionpay] api error', { status: resp.status, body: text.slice(0, 500) });
    throw new HTTPException(502, { message: `云闪付接口错误(${resp.status})` });
  }
  const res = parseForm(text);
  if (res.respCode && res.respCode !== '00' && res.respCode !== '03') {
    throw new HTTPException(400, { message: `云闪付错误(${res.respCode})：${res.respMsg ?? '未知错误'}` });
  }
  return res;
}

function mapUnionpayStatus(respCode: string | undefined, origRespCode: string | undefined): PaymentQueryResult['status'] {
  if (respCode !== '00') return 'pending'; // 查询本身失败按未知处理
  if (origRespCode === '00') return 'success';
  if (origRespCode === '03' || origRespCode === '04' || origRespCode === '05') return 'pending'; // 处理中
  return 'failed';
}

export const unionpayAdapter: PaymentChannelAdapter = {
  channel: 'unionpay',

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
        expiredAt: order.expiredAt ? order.expiredAt.toISOString().slice(0, 19).replace('T', ' ') : undefined,
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
      return { status: 'pending' }; // 沙箱订单由「模拟支付成功」运维入口推进
    }
    const params: Record<string, string> = {
      ...baseParams(ctx),
      txnType: '00',
      txnSubType: '00',
      bizType: '000000',
      orderId: order.outTradeNo,
      txnTime: order.createdAt ? txnTime() : txnTime(),
      queryId: '',
    };
    delete params.queryId;
    const res = await unionpayRequest(ctx, QUERY_GATEWAY, params);
    return {
      status: mapUnionpayStatus(res.respCode, res.origRespCode),
      channelTradeNo: res.queryId,
      paidAmount: res.txnAmt ? Number(res.txnAmt) : undefined,
      raw: res,
    };
  },

  async closePayment(_ctx, order): Promise<void> {
    // 银联二维码无预支付关单接口：本地状态机关闭即可（申码有效期由渠道侧控制）
    logger.info('[unionpay] closePayment noop (local close only)', { orderNo: order.orderNo });
    await Promise.resolve();
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
      txnTime: txnTime(),
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

  async verifyNotify(ctx, rawBody): Promise<NotifyResult> {
    const params = parseForm(rawBody);
    const valid = verifyUnionpay(ctx, params);
    const ack = { body: valid ? 'ok' : 'failure', contentType: 'text/plain', status: valid ? 200 : 401 };
    if (!valid) return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '云闪付回调验签失败' };
    // txnType 04 = 退货通知；01 = 消费通知
    const isRefund = params.txnType === '04';
    if (isRefund) {
      return {
        valid: true,
        scene: 'refund',
        ack,
        outRefundNo: params.orderId,
        channelRefundNo: params.queryId,
        tradeStatus: params.respCode === '00' ? 'refunded' : 'failed',
        raw: params,
      };
    }
    return {
      valid: true,
      scene: 'payment',
      ack,
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
