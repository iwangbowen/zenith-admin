import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { notFound, badRequest } from '@/mocks/utils/handlers';
import { PAYMENT_METHOD_CHANNEL, paymentPreauthContract } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentPreauth } from '@zenith/shared/payment';
import dayjs from 'dayjs';

let nextId = 4;

const preauths: PaymentPreauth[] = [
  {
    id: 1, preauthNo: 'PRE17580000000001001', channel: 'wechat', channelConfigId: 1, channelPreauthNo: 'WXPA1758000000001',
    appId: 1, currency: 'CNY', unknownOperation: null, version: 0,
    bizType: 'hotel_deposit', bizId: 'PRE17580000000001001', subject: '民宿押金（房间 302）', payerAccount: 'oDemo_user_001',
    frozenAmount: 50000, capturedAmount: null, captureOrderNo: null, status: 'frozen', errorMessage: null,
    frozenAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), finishedAt: null, remark: null, operatorName: '管理员',
    createdAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), updatedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 2, preauthNo: 'PRE17580000000002002', channel: 'alipay', channelConfigId: 2, channelPreauthNo: 'ALIPA1758000000002',
    appId: 3, currency: 'CNY', unknownOperation: null, version: 1,
    bizType: 'car_rental', bizId: 'PRE17580000000002002', subject: '租车押金（浙A·D12345）', payerAccount: 'demo***@example.com',
    frozenAmount: 300000, capturedAmount: 120000, captureOrderNo: 'PAC17580000000002001', status: 'captured', errorMessage: null,
    frozenAt: dayjs().subtract(9, 'day').format('YYYY-MM-DD HH:mm:ss'), finishedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
    remark: '车损扣款 1200 元，剩余解冻', operatorName: '管理员',
    createdAt: dayjs().subtract(9, 'day').format('YYYY-MM-DD HH:mm:ss'), updatedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 3, preauthNo: 'PRE17580000000003003', channel: 'wechat', channelConfigId: 1, channelPreauthNo: 'WXPA1758000000003',
    appId: 1, currency: 'CNY', unknownOperation: 'freeze', version: 1,
    bizType: 'hotel_deposit', bizId: 'PRE17580000000003003', subject: '待确认押金', payerAccount: 'oDemo_pending_003',
    frozenAmount: 20000, capturedAmount: null, captureOrderNo: null, status: 'unknown', errorMessage: '渠道冻结结果待确认',
    frozenAt: null, finishedAt: null, remark: '用于查单恢复回归', operatorName: '管理员',
    createdAt: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'), updatedAt: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
];

/** 预授权单按支付应用隔离：applicationId 已由契约 query 校验为正整数 */
function findScopedPreauth(id: number, applicationId: number): PaymentPreauth | undefined {
  return preauths.find((x) => x.id === id && x.appId === applicationId);
}

export const paymentPreauthHandlers = [
  mock(paymentPreauthContract.list, ({ query, ok, paginate }) => {
    const filtered = preauths.filter((p) => p.appId === query.applicationId &&
      (!query.keyword || p.preauthNo.includes(query.keyword) || p.payerAccount.includes(query.keyword) || p.subject.includes(query.keyword)) &&
      (!query.status || p.status === query.status) && (!query.channel || p.channel === query.channel) &&
      (!query.startTime || p.createdAt >= query.startTime) && (!query.endTime || p.createdAt <= query.endTime),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentPreauthContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const channel: PaymentChannel = PAYMENT_METHOD_CHANNEL[body.payMethod];
    const channelConfigId = body.applicationId === 3 && channel === 'alipay' ? 2 : (body.applicationId === 1 || body.applicationId === 2) && channel === 'wechat' ? 1 : null;
    if (!channelConfigId) return badRequest('支付应用未绑定所选预授权方式对应的商户配置');
    const preauthNo = `PRE${Date.now()}`;
    const item: PaymentPreauth = {
      id: nextId++, preauthNo, channel, channelConfigId, appId: body.applicationId, currency: body.currency,
      channelPreauthNo: `${channel === 'wechat' ? 'WXPA' : 'ALIPA'}${Date.now()}`,
      bizType: body.bizType?.trim() || 'admin_preauth', bizId: body.bizId, subject: body.subject, payerAccount: body.payerAccount,
      frozenAmount: body.frozenAmount, capturedAmount: null, captureOrderNo: null, status: 'frozen', errorMessage: null,
      unknownOperation: null, version: 0,
      frozenAt: now, finishedAt: null, remark: body.remark ?? null, operatorName: '管理员', createdAt: now, updatedAt: now,
    };
    preauths.push(item);
    return ok(item, '冻结完成');
  }),
  mock(paymentPreauthContract.capture, ({ params, query, body, ok }) => {
    const p = findScopedPreauth(params.id, query.applicationId);
    if (!p) return notFound('预授权单不存在');
    if (p.status !== 'frozen') return badRequest('仅已冻结的预授权可转支付');
    const captureAmount = body.captureAmount ?? p.frozenAmount;
    if (captureAmount > p.frozenAmount) return badRequest('转支付金额不能超过冻结金额');
    p.status = 'captured';
    p.version += 1;
    p.capturedAmount = captureAmount;
    p.captureOrderNo = `PAC${Date.now()}`;
    p.finishedAt = mockDateTime();
    p.updatedAt = mockDateTime();
    return ok(p, '转支付完成');
  }),
  mock(paymentPreauthContract.release, ({ params, query, ok }) => {
    const p = findScopedPreauth(params.id, query.applicationId);
    if (!p) return notFound('预授权单不存在');
    if (p.status !== 'frozen') return badRequest('仅已冻结的预授权可解冻');
    p.status = 'released';
    p.version += 1;
    p.finishedAt = mockDateTime();
    p.updatedAt = mockDateTime();
    return ok(p, '已解冻');
  }),
  mock(paymentPreauthContract.recover, ({ params, query, ok }) => {
    const p = findScopedPreauth(params.id, query.applicationId);
    if (!p) return notFound('预授权单不存在');
    if (p.status !== 'pending' && p.status !== 'unknown') return ok(p, '查询完成');
    const operation = p.unknownOperation ?? 'freeze';
    p.status = operation === 'release' ? 'released' : operation === 'capture' ? 'captured' : 'frozen';
    p.unknownOperation = null;
    p.errorMessage = null;
    p.version += 1;
    p.updatedAt = mockDateTime();
    if (p.status === 'frozen') p.frozenAt ??= p.updatedAt;
    if (p.status === 'captured') {
      p.capturedAmount ??= p.frozenAmount;
      p.captureOrderNo ??= `PAC${Date.now()}`;
      p.finishedAt = p.updatedAt;
    }
    if (p.status === 'released') p.finishedAt = p.updatedAt;
    return ok(p, '查询完成');
  }),
];
