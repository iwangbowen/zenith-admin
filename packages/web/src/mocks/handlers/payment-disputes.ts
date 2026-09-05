import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { notFound, badRequest } from '@/mocks/utils/handlers';
import { paymentDisputeContract, type PaymentDispute, type PaymentDisputeDetail, type PaymentDisputeReply, type PaymentDisputeStats } from '@zenith/shared/payment';
import dayjs from 'dayjs';

let nextDisputeId = 4;
let nextReplyId = 10;

interface MockDispute extends PaymentDispute {
  replies: PaymentDisputeReply[];
}

const disputes: MockDispute[] = [
  {
    id: 1,
    disputeNo: 'DSP17580000000001001',
    channelDisputeNo: 'WXC1758000000001',
    channel: 'wechat',
    orderNo: 'PAY17580000000000001',
    complainant: 'oDemo_user_001',
    complainantPhone: '138****1234',
    type: 'refund_request',
    content: '商品与描述不符，申请全额退款。',
    amount: 9900,
    status: 'pending',
    route: 'auto_refund_suggest',
    priority: 50,
    slaHours: 24,
    deadline: dayjs().add(6, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    overdue: false,
    refundNo: null,
    resolvedAt: null,
    createdAt: dayjs().subtract(18, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    updatedAt: dayjs().subtract(18, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    replies: [
      { id: 1, author: 'user', content: '商品与描述不符，申请全额退款。', operatorName: null, createdAt: dayjs().subtract(18, 'hour').format('YYYY-MM-DD HH:mm:ss') },
      { id: 7, author: 'system', content: '智能分流（规则中心 dispute_triage v1）：路由：建议自动退款 · 优先级 50 · SLA 24 小时', operatorName: null, createdAt: dayjs().subtract(18, 'hour').format('YYYY-MM-DD HH:mm:ss') },
    ],
  },
  {
    id: 2,
    disputeNo: 'DSP17580000000002002',
    channelDisputeNo: 'ALIC1758000000002',
    channel: 'alipay',
    orderNo: 'PAY17580000000000002',
    complainant: 'demo***@example.com',
    complainantPhone: '139****5678',
    type: 'service_issue',
    content: '付款成功后长时间未到账/未发货，请尽快处理。',
    amount: 45000,
    status: 'processing',
    route: 'manual',
    priority: 10,
    slaHours: 48,
    deadline: dayjs().subtract(2, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    overdue: true,
    refundNo: null,
    resolvedAt: null,
    createdAt: dayjs().subtract(30, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    updatedAt: dayjs().subtract(3, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    replies: [
      { id: 2, author: 'user', content: '付款成功后长时间未到账/未发货，请尽快处理。', operatorName: null, createdAt: dayjs().subtract(30, 'hour').format('YYYY-MM-DD HH:mm:ss') },
      { id: 3, author: 'merchant', content: '您好，已核实到您的订单，仓库今日加急发出，请留意物流信息。', operatorName: '管理员', createdAt: dayjs().subtract(3, 'hour').format('YYYY-MM-DD HH:mm:ss') },
    ],
  },
  {
    id: 3,
    disputeNo: 'DSP17580000000003003',
    channelDisputeNo: 'WXC1758000000003',
    channel: 'wechat',
    orderNo: 'PAY17580000000000003',
    complainant: 'oDemo_user_009',
    complainantPhone: '137****0000',
    type: 'refund_request',
    content: '重复扣款，请核实并退回多扣金额。',
    amount: 1500,
    status: 'refunded',
    route: null,
    priority: null,
    slaHours: null,
    deadline: dayjs().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss'),
    overdue: false,
    refundNo: 'REF17580000000000031',
    resolvedAt: dayjs().subtract(3, 'day').add(5, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    createdAt: dayjs().subtract(4, 'day').format('YYYY-MM-DD HH:mm:ss'),
    updatedAt: dayjs().subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss'),
    replies: [
      { id: 4, author: 'user', content: '重复扣款，请核实并退回多扣金额。', operatorName: null, createdAt: dayjs().subtract(4, 'day').format('YYYY-MM-DD HH:mm:ss') },
      { id: 5, author: 'merchant', content: '已核实为重复支付，马上为您退回多扣款项。', operatorName: '管理员', createdAt: dayjs().subtract(3, 'day').add(4, 'hour').format('YYYY-MM-DD HH:mm:ss') },
      { id: 6, author: 'system', content: '已发起退款 REF17580000000000031（15.00 元，状态：success）', operatorName: '管理员', createdAt: dayjs().subtract(3, 'day').add(5, 'hour').format('YYYY-MM-DD HH:mm:ss') },
    ],
  },
];

function refreshOverdue(d: MockDispute): MockDispute {
  d.overdue = (d.status === 'pending' || d.status === 'processing') && !!d.deadline && dayjs(d.deadline).isBefore(dayjs());
  return d;
}

function toDetail(d: MockDispute): PaymentDisputeDetail {
  const { replies, ...rest } = refreshOverdue(d);
  return {
    ...rest,
    replies,
    order: { orderNo: d.orderNo, subject: '演示商品订单', amount: d.amount, status: d.status === 'refunded' ? 'refunded' : 'success', paidAt: d.createdAt },
  };
}

export const paymentDisputeHandlers = [
  mock(paymentDisputeContract.stats, ({ ok }) => {
    disputes.forEach(refreshOverdue);
    const open = disputes.filter((d) => d.status === 'pending' || d.status === 'processing').length;
    const overdue = disputes.filter((d) => d.overdue).length;
    const stats: PaymentDisputeStats = { open, overdue, last30dCount: disputes.length, last30dRate: 1.2, avgResolveHours: 5.5 };
    return ok(stats);
  }),
  mock(paymentDisputeContract.list, ({ query, ok, paginate }) => {
    disputes.forEach(refreshOverdue);
    const filtered = disputes.filter((d) =>
      (!query.keyword || d.disputeNo.includes(query.keyword) || d.orderNo.includes(query.keyword) || (d.complainant ?? '').includes(query.keyword)) &&
      (!query.status || d.status === query.status) && (!query.type || d.type === query.type) && (!query.channel || d.channel === query.channel) && (!query.route || d.route === query.route) &&
      (!query.overdueOnly || d.overdue) &&
      (!query.startTime || d.createdAt >= query.startTime) && (!query.endTime || d.createdAt <= query.endTime),
    ).map(({ replies: _r, ...rest }) => rest);
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentDisputeContract.detail, ({ params, ok }) => {
    const d = disputes.find((x) => x.id === params.id);
    return d ? ok(toDetail(d)) : notFound('投诉工单不存在');
  }),
  mock(paymentDisputeContract.reply, ({ params, body, ok }) => {
    const d = disputes.find((x) => x.id === params.id);
    if (!d) return notFound('投诉工单不存在');
    if (d.status !== 'pending' && d.status !== 'processing') return badRequest('工单已完结，无法回复');
    d.replies.push({ id: nextReplyId++, author: 'merchant', content: body.content, operatorName: '管理员', createdAt: mockDateTime() });
    if (d.status === 'pending') d.status = 'processing';
    d.updatedAt = mockDateTime();
    return ok(toDetail(d), '回复成功');
  }),
  mock(paymentDisputeContract.resolve, ({ params, body, ok }) => {
    const d = disputes.find((x) => x.id === params.id);
    if (!d) return notFound('投诉工单不存在');
    if (d.status !== 'pending' && d.status !== 'processing') return badRequest('工单已完结');
    d.replies.push({ id: nextReplyId++, author: 'system', content: body.remark ? `工单已完结：${body.remark}` : '工单已完结', operatorName: '管理员', createdAt: mockDateTime() });
    d.status = 'resolved';
    d.resolvedAt = mockDateTime();
    d.updatedAt = mockDateTime();
    return ok(toDetail(d), '已完结');
  }),
  mock(paymentDisputeContract.refund, ({ params, body, ok }) => {
    const d = disputes.find((x) => x.id === params.id);
    if (!d) return notFound('投诉工单不存在');
    if (d.status !== 'pending' && d.status !== 'processing') return badRequest('工单已完结');
    const amount = body.refundAmount ?? d.amount;
    d.refundNo = `REF${Date.now()}`;
    d.replies.push({ id: nextReplyId++, author: 'system', content: `已发起退款 ${d.refundNo}（${(amount / 100).toFixed(2)} 元，状态：success）`, operatorName: '管理员', createdAt: mockDateTime() });
    d.status = 'refunded';
    d.resolvedAt = mockDateTime();
    d.updatedAt = mockDateTime();
    return ok(toDetail(d), '退款已发起');
  }),
  mock(paymentDisputeContract.simulate, ({ body, ok }) => {
    const id = nextDisputeId++;
    const now = mockDateTime();
    const item: MockDispute = {
      id,
      disputeNo: `DSP${Date.now()}`,
      channelDisputeNo: `WXC${Date.now()}`,
      channel: 'wechat',
      orderNo: body.orderNo ?? `PAY${Date.now()}`,
      complainant: `oDemo_user_${String(id).padStart(3, '0')}`,
      complainantPhone: '138****8888',
      type: 'service_issue',
      content: '联系客服无人响应，问题一直未解决。',
      amount: 2900,
      status: 'pending',
      route: 'manual',
      priority: 10,
      slaHours: 48,
      deadline: dayjs().add(24, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      overdue: false,
      refundNo: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      replies: [
        { id: nextReplyId++, author: 'user', content: '联系客服无人响应，问题一直未解决。', operatorName: null, createdAt: now },
        { id: nextReplyId++, author: 'system', content: '智能分流（规则中心 dispute_triage v1）：路由：人工处理 · 优先级 10 · SLA 48 小时', operatorName: null, createdAt: now },
      ],
    };
    disputes.push(item);
    const { replies: _r, ...rest } = item;
    return ok(rest, '模拟投诉已生成');
  }),
];
