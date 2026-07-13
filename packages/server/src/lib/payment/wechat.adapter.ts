/**
 * 微信支付 v3 适配器（Node 原生 crypto 实现真实签名/验签，外呼统一走 http-client）。
 *
 * 支持：Native 扫码 / JSAPI / H5；查单 / 关单 / 退款 / 退款查询 / 回调验签解密。
 * 文档：https://pay.weixin.qq.com/docs/merchant/apis/native-payment/
 */
import { randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { httpGet, httpPost } from '../http-client';
import { formatDateTime } from '../datetime';
import logger from '../logger';
import type { CreatePaymentResult } from '@zenith/shared';
import { rsaSign, rsaVerify, aesGcmDecrypt, ensurePem } from './signing';
import { getPlatformCert } from './wechat-certs';
import type {
  AdapterContext,
  ContractDeductInput,
  ContractDeductResult,
  ContractSignInput,
  ContractSignResult,
  NotifyResult,
  PaymentChannelAdapter,
  PaymentQueryResult,
  ProfitShareQueryResult,
  ProfitShareReceiver,
  ProfitShareResult,
  RefundQueryResult,
  RefundResult,
  TransferInput,
  TransferQueryResult,
  TransferResult,
} from './types';

const WECHAT_BASE = 'https://api.mch.weixin.qq.com';

function requireField<T>(v: T | null | undefined, name: string): T {
  if (v === null || v === undefined || v === '') throw new HTTPException(400, { message: `微信支付配置缺失：${name}` });
  return v;
}

function genNonce(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

function buildAuthToken(ctx: AdapterContext, method: string, urlPath: string, body: string): string {
  const mchid = requireField(ctx.config.wechatMchId, '商户号(mchId)');
  const serialNo = requireField(ctx.config.wechatSerialNo, '证书序列号(serialNo)');
  const privateKey = ensurePem(requireField(ctx.secrets.wechatPrivateKey, '商户私钥'), 'PRIVATE KEY');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = genNonce();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaSign(message, privateKey, 'RSA-SHA256');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

async function wechatRequest<T = Record<string, unknown>>(
  ctx: AdapterContext,
  method: 'GET' | 'POST',
  urlPath: string,
  bodyObj?: Record<string, unknown>,
): Promise<T> {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const authToken = buildAuthToken(ctx, method, urlPath, bodyStr);
  const headers: Record<string, string> = {
    Authorization: authToken,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'zenith-admin',
  };
  const url = `${WECHAT_BASE}${urlPath}`;
  const resp = method === 'GET' ? await httpGet(url, { headers }) : await httpPost(url, bodyStr, { headers });
  const text = await resp.text();
  if (!resp.ok) {
    logger.warn('[wechat-pay] api error', { urlPath, status: resp.status, body: text.slice(0, 500) });
    let msg = `微信支付接口错误(${resp.status})`;
    try {
      const e = JSON.parse(text) as { message?: string };
      if (e.message) msg += `：${e.message}`;
    } catch {
      /* ignore parse error */
    }
    throw new HTTPException(502, { message: msg });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function buildJsapiParams(ctx: AdapterContext, appId: string, prepayId: string): Record<string, string> {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = genNonce();
  const pkg = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const privateKey = ensurePem(requireField(ctx.secrets.wechatPrivateKey, '商户私钥'), 'PRIVATE KEY');
  const paySign = rsaSign(message, privateKey, 'RSA-SHA256');
  return { appId, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
}

function mapTradeState(state: string | undefined): PaymentQueryResult['status'] {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'CLOSED':
    case 'REVOKED':
      return 'closed';
    case 'PAYERROR':
      return 'failed';
    default:
      return 'pending'; // NOTPAY / USERPAYING
  }
}

function mapRefundStatus(status: string | undefined): RefundResult['status'] {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'PROCESSING':
      return 'processing';
    default:
      return 'failed'; // CLOSED / ABNORMAL
  }
}

function mapNotifyTradeStatus(state: string | undefined): NotifyResult['tradeStatus'] {
  if (state === 'SUCCESS') return 'success';
  if (state === 'CLOSED') return 'closed';
  return 'failed';
}

interface WechatTransaction {
  trade_state?: string;
  transaction_id?: string;
  amount?: { total?: number; payer_total?: number };
  success_time?: string;
}
interface WechatRefund {
  refund_id?: string;
  status?: string;
  success_time?: string;
}
interface WechatProfitShareOrder {
  order_id?: string;
  state?: string; // PROCESSING / FINISHED
  receivers?: Array<{ result?: string; finish_time?: string; fail_reason?: string }>;
}
interface WechatTransferDetail {
  detail_id?: string;
  detail_status?: string; // INIT / WAIT_PAY / PROCESSING / SUCCESS / FAIL
  fail_reason?: string;
  update_time?: string;
}

function mapProfitShareState(order: WechatProfitShareOrder): ProfitShareQueryResult['status'] {
  if (order.state !== 'FINISHED') return 'processing';
  const results = order.receivers?.map((r) => r.result) ?? [];
  if (results.some((r) => r === 'CLOSED')) return 'failed';
  return results.every((r) => r === 'SUCCESS') ? 'success' : 'processing';
}

function mapTransferDetailStatus(status: string | undefined): TransferQueryResult['status'] {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAIL') return 'failed';
  return 'processing'; // INIT / WAIT_PAY / PROCESSING
}

/** 微信分账接收方类型映射：商户号 / 个人 openid */
function wechatReceiverType(receiverType: ProfitShareReceiver['receiverType']): string {
  return receiverType === 'personal' ? 'PERSONAL_OPENID' : 'MERCHANT_ID';
}

export const wechatPayAdapter: PaymentChannelAdapter = {
  channel: 'wechat',

  async createPayment(ctx, order): Promise<CreatePaymentResult> {
    const appId = requireField(ctx.config.wechatAppId, 'AppId');
    const mchid = requireField(ctx.config.wechatMchId, '商户号');
    const base: Record<string, unknown> = {
      appid: appId,
      mchid,
      description: order.subject,
      out_trade_no: order.outTradeNo,
      notify_url: ctx.notifyUrl,
      amount: { total: order.amount, currency: order.currency || 'CNY' },
    };
    const expiredAt = order.expiredAt ? formatDateTime(order.expiredAt) : undefined;
    switch (order.payMethod) {
      case 'wechat_native': {
        const res = await wechatRequest<{ code_url: string }>(ctx, 'POST', '/v3/pay/transactions/native', base);
        return { orderNo: order.orderNo, channel: 'wechat', payMethod: order.payMethod, codeUrl: res.code_url, expiredAt };
      }
      case 'wechat_h5': {
        const body = { ...base, scene_info: { payer_client_ip: order.clientIp || '127.0.0.1', h5_info: { type: 'Wap' } } };
        const res = await wechatRequest<{ h5_url: string }>(ctx, 'POST', '/v3/pay/transactions/h5', body);
        return { orderNo: order.orderNo, channel: 'wechat', payMethod: order.payMethod, payUrl: res.h5_url, expiredAt };
      }
      case 'wechat_jsapi': {
        const openId = requireField(order.openId, 'JSAPI openId');
        const body = { ...base, payer: { openid: openId } };
        const res = await wechatRequest<{ prepay_id: string }>(ctx, 'POST', '/v3/pay/transactions/jsapi', body);
        return {
          orderNo: order.orderNo,
          channel: 'wechat',
          payMethod: order.payMethod,
          jsapiParams: buildJsapiParams(ctx, appId, res.prepay_id),
          expiredAt,
        };
      }
      default:
        throw new HTTPException(400, { message: `微信支付不支持的支付方式：${order.payMethod}` });
    }
  },

  async queryPayment(ctx, order): Promise<PaymentQueryResult> {
    const mchid = requireField(ctx.config.wechatMchId, '商户号');
    const res = await wechatRequest<WechatTransaction>(
      ctx,
      'GET',
      `/v3/pay/transactions/out-trade-no/${order.outTradeNo}?mchid=${mchid}`,
    );
    return {
      status: mapTradeState(res.trade_state),
      channelTradeNo: res.transaction_id,
      paidAmount: res.amount?.payer_total ?? res.amount?.total,
      paidAt: res.success_time ? new Date(res.success_time) : undefined,
      raw: res,
    };
  },

  async closePayment(ctx, order): Promise<void> {
    const mchid = requireField(ctx.config.wechatMchId, '商户号');
    await wechatRequest(ctx, 'POST', `/v3/pay/transactions/out-trade-no/${order.outTradeNo}/close`, { mchid });
  },

  async refund(ctx, order, refund): Promise<RefundResult> {
    const body: Record<string, unknown> = {
      out_trade_no: order.outTradeNo,
      out_refund_no: refund.outRefundNo,
      reason: refund.reason || undefined,
      notify_url: ctx.notifyUrl,
      amount: { refund: refund.refundAmount, total: refund.totalAmount, currency: 'CNY' },
    };
    const res = await wechatRequest<WechatRefund>(ctx, 'POST', '/v3/refund/domestic/refunds', body);
    return { channelRefundNo: res.refund_id, status: mapRefundStatus(res.status), raw: res };
  },

  async queryRefund(ctx, refund): Promise<RefundQueryResult> {
    const res = await wechatRequest<WechatRefund>(ctx, 'GET', `/v3/refund/domestic/refunds/${refund.outRefundNo}`);
    return {
      channelRefundNo: res.refund_id,
      status: mapRefundStatus(res.status),
      refundedAt: res.success_time ? new Date(res.success_time) : undefined,
      raw: res,
    };
  },

  async verifyNotify(ctx, rawBody, headers): Promise<NotifyResult> {
    const timestamp = headers.get('Wechatpay-Timestamp') ?? '';
    const nonce = headers.get('Wechatpay-Nonce') ?? '';
    const signature = headers.get('Wechatpay-Signature') ?? '';
    const serial = headers.get('Wechatpay-Serial') ?? '';
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    // 优先按回调头 Wechatpay-Serial 选用自动下载的平台证书（应对证书轮换）；回退到手工配置的证书
    let platformCert = '';
    if (serial) {
      const downloaded = await getPlatformCert(ctx, serial);
      if (downloaded) platformCert = downloaded;
    }
    if (!platformCert && ctx.config.wechatPlatformCert) {
      platformCert = ensurePem(ctx.config.wechatPlatformCert, 'CERTIFICATE');
    }
    const valid = platformCert ? rsaVerify(message, signature, platformCert, 'RSA-SHA256') : false;
    const ack = valid
      ? { body: JSON.stringify({ code: 'SUCCESS', message: '成功' }), contentType: 'application/json', status: 200 }
      : { body: JSON.stringify({ code: 'FAIL', message: '验签失败' }), contentType: 'application/json', status: 401 };
    if (!valid) return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '微信回调验签失败' };

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '回调体解析失败' };
    }
    const resource = (envelope.resource ?? {}) as { nonce?: string; associated_data?: string; ciphertext?: string };
    const apiV3Key = requireField(ctx.secrets.wechatApiV3Key, 'APIv3 Key');
    let data: Record<string, any>;
    try {
      const plaintext = aesGcmDecrypt(apiV3Key, resource.nonce ?? '', resource.associated_data ?? '', resource.ciphertext ?? '');
      data = JSON.parse(plaintext) as Record<string, any>;
    } catch (err) {
      logger.warn('[wechat-pay] decrypt notify failed', { err });
      return { valid: false, scene: 'payment', tradeStatus: 'unknown', ack, message: '回调解密失败' };
    }

    const eventType = typeof envelope.event_type === 'string' ? envelope.event_type : '';
    if (eventType.includes('REFUND')) {
      return {
        valid: true,
        scene: 'refund',
        ack,
        outTradeNo: data.out_trade_no,
        outRefundNo: data.out_refund_no,
        channelRefundNo: data.refund_id,
        tradeStatus: data.refund_status === 'SUCCESS' ? 'refunded' : 'failed',
        raw: data,
      };
    }
    return {
      valid: true,
      scene: 'payment',
      ack,
      outTradeNo: data.out_trade_no,
      channelTradeNo: data.transaction_id,
      tradeStatus: mapNotifyTradeStatus(data.trade_state),
      paidAmount: data.amount?.payer_total ?? data.amount?.total,
      paidAt: data.success_time ? new Date(data.success_time) : undefined,
      raw: data,
    };
  },

  async testConnectivity(ctx: AdapterContext): Promise<void> {
    const fakeNo = `TEST${Date.now()}`;
    try {
      await wechatRequest(ctx, 'GET', `/v3/pay/transactions/out-trade-no/${fakeNo}`);
      // 真实订单意外命中也视为凭据可用
    } catch (err) {
      if (!(err instanceof HTTPException)) throw err;
      const msg = err.message ?? '';
      // ORDER_NOT_EXIST / RESOURCE_NOT_EXISTS = 凭据有效，订单不存在属预期
      if (msg.includes('ORDER_NOT_EXIST') || msg.includes('RESOURCE_NOT_EXISTS')) return;
      throw err; // 签名错误 / 商户号不存在 / 其他鉴权失败
    }
  },

  async profitShare(ctx: AdapterContext, order, receiver: ProfitShareReceiver, outSharingNo: string): Promise<ProfitShareResult> {
    if (ctx.config.sandbox) {
      // 沙箱：模拟受理成功（真实分账需商户开通分账权限并添加接收方）
      logger.info('[wechat-pay] simulate profit share (sandbox)', { orderNo: order.orderNo, account: receiver.account, amount: receiver.amount });
      await Promise.resolve();
      return { channelSharingNo: `WXSHARE${Date.now()}${randomBytes(3).toString('hex')}`, status: 'success' };
    }
    const appId = requireField(ctx.config.wechatAppId, 'AppId');
    const transactionId = requireField(order.channelTradeNo, '微信订单号(channelTradeNo)');
    const body = {
      appid: appId,
      transaction_id: transactionId,
      out_order_no: outSharingNo,
      unfreeze_unsplit: false,
      receivers: [
        {
          type: wechatReceiverType(receiver.receiverType),
          account: receiver.account,
          amount: receiver.amount,
          description: (receiver.name ? `分给${receiver.name}` : '订单分账').slice(0, 80),
        },
      ],
    };
    let res: WechatProfitShareOrder;
    try {
      res = await wechatRequest<WechatProfitShareOrder>(ctx, 'POST', '/v3/profitsharing/orders', body);
    } catch (err) {
      // 接收方尚未添加：自动添加后重试一次（重复添加微信按幂等处理）
      const msg = err instanceof HTTPException ? err.message : '';
      if (!/RECEIVER|接收方/i.test(msg)) throw err;
      await wechatRequest(ctx, 'POST', '/v3/profitsharing/receivers/add', {
        appid: appId,
        type: wechatReceiverType(receiver.receiverType),
        account: receiver.account,
        relation_type: receiver.receiverType === 'personal' ? 'DISTRIBUTOR' : 'PARTNER',
        name: receiver.receiverType === 'personal' ? undefined : receiver.name,
      });
      res = await wechatRequest<WechatProfitShareOrder>(ctx, 'POST', '/v3/profitsharing/orders', body);
    }
    return { channelSharingNo: res.order_id, status: mapProfitShareState(res), raw: res };
  },

  async queryProfitShare(ctx: AdapterContext, order, outSharingNo: string): Promise<ProfitShareQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return { status: 'success' };
    }
    const transactionId = requireField(order.channelTradeNo, '微信订单号(channelTradeNo)');
    const res = await wechatRequest<WechatProfitShareOrder>(
      ctx,
      'GET',
      `/v3/profitsharing/orders/${encodeURIComponent(outSharingNo)}?transaction_id=${encodeURIComponent(transactionId)}`,
    );
    const finish = res.receivers?.find((r) => r.finish_time)?.finish_time;
    return { status: mapProfitShareState(res), channelSharingNo: res.order_id, finishedAt: finish ? new Date(finish) : undefined, raw: res };
  },

  async transfer(ctx: AdapterContext, input: TransferInput): Promise<TransferResult> {
    if (ctx.config.sandbox) {
      logger.info('[wechat-pay] simulate transfer (sandbox)', { outTransferNo: input.outTransferNo, amount: input.amount });
      await Promise.resolve();
      return { channelTransferNo: `WXTRF${Date.now()}${randomBytes(3).toString('hex')}`, status: 'success' };
    }
    const appId = requireField(ctx.config.wechatAppId, 'AppId');
    const remark = (input.remark || '转账').slice(0, 32);
    const res = await wechatRequest<{ batch_id?: string }>(ctx, 'POST', '/v3/transfer/batches', {
      appid: appId,
      out_batch_no: input.outTransferNo,
      batch_name: remark,
      batch_remark: remark,
      total_amount: input.amount,
      total_num: 1,
      transfer_detail_list: [
        {
          out_detail_no: input.outTransferNo,
          transfer_amount: input.amount,
          transfer_remark: remark,
          openid: input.receiverAccount,
          // 明细金额 ≥ 2000 元时微信要求实名 user_name（RSA 加密），本实现面向小额场景不传
        },
      ],
    });
    // 受理成功即 processing，终态由 queryTransfer 同步
    return { channelTransferNo: res.batch_id, status: 'processing', raw: res };
  },

  async queryTransfer(ctx: AdapterContext, input): Promise<TransferQueryResult> {
    if (ctx.config.sandbox) {
      await Promise.resolve();
      return { status: 'success' };
    }
    const res = await wechatRequest<WechatTransferDetail>(
      ctx,
      'GET',
      `/v3/transfer/batches/out-batch-no/${encodeURIComponent(input.outTransferNo)}/details/out-detail-no/${encodeURIComponent(input.outTransferNo)}`,
    );
    return {
      status: mapTransferDetailStatus(res.detail_status),
      channelTransferNo: res.detail_id,
      finishedAt: res.update_time ? new Date(res.update_time) : undefined,
      failReason: res.fail_reason,
      raw: res,
    };
  },

  async downloadBill(ctx: AdapterContext, billDate: string): Promise<string> {
    // 1. 申请账单下载链接（SUCCESS 账单：仅成功支付订单）
    const meta = await wechatRequest<{ download_url?: string }>(ctx, 'GET', `/v3/bill/tradebill?bill_date=${billDate}&bill_type=SUCCESS`);
    const downloadUrl = meta.download_url;
    if (!downloadUrl) throw new HTTPException(502, { message: '微信账单下载链接获取失败' });
    // 2. 签名下载（download_url 域名可能不同，按其 path+query 重新签名）
    const u = new URL(downloadUrl);
    const urlPath = `${u.pathname}${u.search}`;
    const authToken = buildAuthToken(ctx, 'GET', urlPath, '');
    const resp = await httpGet(downloadUrl, { headers: { Authorization: authToken, Accept: '*/*', 'User-Agent': 'zenith-admin' } });
    const text = await resp.text();
    if (!resp.ok) throw new HTTPException(502, { message: `微信账单下载失败(${resp.status})` });
    return convertWechatBillToInternalCsv(text);
  },

  // ── 签约代扣（委托代扣）：真实模式需商户开通委托代扣产品权限，本期仅支持沙箱模拟 ──
  async signContract(ctx: AdapterContext, input: ContractSignInput): Promise<ContractSignResult> {
    if (ctx.config.sandbox) {
      logger.info('[wechat-pay] simulate contract sign (sandbox)', { outContractNo: input.outContractNo, plan: input.planName });
      await Promise.resolve();
      return { channelContractNo: `WXCT${Date.now()}${randomBytes(3).toString('hex')}`, status: 'signed' };
    }
    throw new HTTPException(400, { message: '微信委托代扣需商户开通产品权限，当前仅支持沙箱渠道签约' });
  },

  async terminateContract(ctx: AdapterContext, input): Promise<void> {
    if (ctx.config.sandbox) {
      logger.info('[wechat-pay] simulate contract terminate (sandbox)', { outContractNo: input.outContractNo });
      await Promise.resolve();
      return;
    }
    throw new HTTPException(400, { message: '微信委托代扣需商户开通产品权限，当前仅支持沙箱渠道解约' });
  },

  async deductContract(ctx: AdapterContext, input: ContractDeductInput): Promise<ContractDeductResult> {
    if (ctx.config.sandbox) {
      logger.info('[wechat-pay] simulate contract deduct (sandbox)', { outTradeNo: input.outTradeNo, amount: input.amount });
      await Promise.resolve();
      return { channelTradeNo: `WXDED${Date.now()}${randomBytes(3).toString('hex')}`, status: 'success' };
    }
    throw new HTTPException(400, { message: '微信委托代扣需商户开通产品权限，当前仅支持沙箱渠道扣款' });
  },
};

/** 将微信交易账单 CSV（字段以反引号 ` 前缀、金额单位元）转换为内部标准格式 `订单号,渠道交易号,金额(分),状态`。 */
export function convertWechatBillToInternalCsv(billText: string): string {
  const lines = billText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return '订单号,渠道交易号,金额(分),状态';
  const header = lines[0].split(',').map((c) => c.replace(/^`/, '').trim());
  const idxOrderNo = header.findIndex((h) => h === '商户订单号');
  const idxTradeNo = header.findIndex((h) => h === '微信订单号');
  const idxStatus = header.findIndex((h) => h === '交易状态');
  let idxAmount = header.findIndex((h) => h === '订单金额');
  if (idxAmount < 0) idxAmount = header.findIndex((h) => h === '应结订单金额');
  if (idxOrderNo < 0 || idxAmount < 0) throw new HTTPException(400, { message: '微信账单格式无法识别（缺少商户订单号/订单金额列）' });
  const out = ['订单号,渠道交易号,金额(分),状态'];
  for (const line of lines.slice(1)) {
    if (line.startsWith('总交易单数') || line.startsWith('`总交易单数') || line.startsWith('总')) break; // 汇总行
    const cols = line.split(',').map((c) => c.replace(/^`/, '').trim());
    if (cols.length <= idxAmount) continue;
    const orderNo = cols[idxOrderNo];
    if (!orderNo) continue;
    const amountCents = Math.round(Number.parseFloat(cols[idxAmount] || '0') * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue;
    const status = (idxStatus >= 0 ? cols[idxStatus] : 'SUCCESS') || 'SUCCESS';
    out.push(`${orderNo},${idxTradeNo >= 0 ? cols[idxTradeNo] ?? '' : ''},${amountCents},${status}`);
  }
  return out.join('\n');
}
