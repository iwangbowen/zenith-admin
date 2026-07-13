import { http } from 'msw';
import { mockDateTime } from '@/mocks/utils/date';
import { ok, notFound, badRequest, paginate } from '@/mocks/utils/handlers';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared';
import type { PaymentChannel, PaymentPreauth } from '@zenith/shared';
import dayjs from 'dayjs';

let nextId = 3;

const preauths: PaymentPreauth[] = [
  {
    id: 1, preauthNo: 'PRE17580000000001001', channel: 'wechat', channelConfigId: 1, channelPreauthNo: 'WXPA1758000000001',
    bizType: 'hotel_deposit', bizId: 'PRE17580000000001001', subject: '民宿押金（房间 302）', payerAccount: 'oDemo_user_001',
    frozenAmount: 50000, capturedAmount: null, captureOrderNo: null, status: 'frozen', errorMessage: null,
    frozenAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), finishedAt: null, remark: null, operatorName: '管理员',
    createdAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), updatedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 2, preauthNo: 'PRE17580000000002002', channel: 'alipay', channelConfigId: 2, channelPreauthNo: 'ALIPA1758000000002',
    bizType: 'car_rental', bizId: 'PRE17580000000002002', subject: '租车押金（浙A·D12345）', payerAccount: 'demo***@example.com',
    frozenAmount: 300000, capturedAmount: 120000, captureOrderNo: 'PAC17580000000002001', status: 'captured', errorMessage: null,
    frozenAt: dayjs().subtract(9, 'day').format('YYYY-MM-DD HH:mm:ss'), finishedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
    remark: '车损扣款 1200 元，剩余解冻', operatorName: '管理员',
    createdAt: dayjs().subtract(9, 'day').format('YYYY-MM-DD HH:mm:ss'), updatedAt: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
  },
];

export const paymentPreauthHandlers = [
  http.get('/api/payment/preauths', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const filtered = preauths.filter((p) =>
      (!keyword || p.preauthNo.includes(keyword) || p.payerAccount.includes(keyword) || p.subject.includes(keyword)) &&
      (!status || p.status === status) && (!channel || p.channel === channel),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id), url));
  }),
  http.post('/api/payment/preauths', async ({ request }) => {
    const b = (await request.json()) as { payMethod: 'wechat_preauth' | 'alipay_preauth'; payerAccount: string; subject: string; frozenAmount: number; bizType?: string; remark?: string };
    const now = mockDateTime();
    const channel: PaymentChannel = PAYMENT_METHOD_CHANNEL[b.payMethod];
    const preauthNo = `PRE${Date.now()}`;
    const item: PaymentPreauth = {
      id: nextId++, preauthNo, channel, channelConfigId: null,
      channelPreauthNo: `${channel === 'wechat' ? 'WXPA' : 'ALIPA'}${Date.now()}`,
      bizType: b.bizType?.trim() || 'admin_preauth', bizId: preauthNo, subject: b.subject, payerAccount: b.payerAccount,
      frozenAmount: b.frozenAmount, capturedAmount: null, captureOrderNo: null, status: 'frozen', errorMessage: null,
      frozenAt: now, finishedAt: null, remark: b.remark ?? null, operatorName: '管理员', createdAt: now, updatedAt: now,
    };
    preauths.push(item);
    return ok(item, '冻结完成');
  }),
  http.post('/api/payment/preauths/:id/capture', async ({ params, request }) => {
    const p = preauths.find((x) => x.id === Number(params.id));
    if (!p) return notFound('预授权单不存在');
    if (p.status !== 'frozen') return badRequest('仅已冻结的预授权可转支付');
    const b = (await request.json().catch(() => ({}))) as { captureAmount?: number };
    const captureAmount = b.captureAmount ?? p.frozenAmount;
    if (captureAmount > p.frozenAmount) return badRequest('转支付金额不能超过冻结金额');
    p.status = 'captured';
    p.capturedAmount = captureAmount;
    p.captureOrderNo = `PAC${Date.now()}`;
    p.finishedAt = mockDateTime();
    p.updatedAt = mockDateTime();
    return ok(p, '转支付完成');
  }),
  http.post('/api/payment/preauths/:id/release', ({ params }) => {
    const p = preauths.find((x) => x.id === Number(params.id));
    if (!p) return notFound('预授权单不存在');
    if (p.status !== 'frozen') return badRequest('仅已冻结的预授权可解冻');
    p.status = 'released';
    p.finishedAt = mockDateTime();
    p.updatedAt = mockDateTime();
    return ok(p, '已解冻');
  }),
];
