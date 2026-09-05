import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { notFound, badRequest } from '@/mocks/utils/handlers';
import { paymentRiskOpsContract, type PaymentRiskHit, type PaymentRiskReview } from '@zenith/shared/payment';
import dayjs from 'dayjs';

const hits: PaymentRiskHit[] = [
  {
    id: 1, ruleId: 1, ruleName: '单笔大额拦截', action: 'block', dimension: 'single_limit', dimensionValue: '8000000 > 5000000',
    channel: 'wechat', bizType: 'goods_order', bizId: 'G20260701001', orderNo: null, amount: 8000000,
    openId: 'oDemo_big_001', userId: null, clientIp: '203.0.113.10',
    createdAt: dayjs().subtract(6, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 2, ruleId: 2, ruleName: '会员业务限频', action: 'block', dimension: 'blocklist', dimensionValue: 'oBLOCK001',
    channel: 'alipay', bizType: 'membership', bizId: 'M20260701009', orderNo: null, amount: 9900,
    openId: 'oBLOCK001', userId: null, clientIp: '198.51.100.7',
    createdAt: dayjs().subtract(3, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 3, ruleId: 2, ruleName: '会员业务限频', action: 'review', dimension: 'daily_count', dimensionValue: '50 + 1 > 50',
    channel: 'wechat', bizType: 'membership', bizId: 'M20260701010', orderNo: 'PAY17580000000000099', amount: 15000,
    openId: 'oDemo_user_010', userId: null, clientIp: '192.0.2.55',
    createdAt: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
];

const reviews: PaymentRiskReview[] = [
  {
    id: 1, reviewNo: 'RSK17580000000001001', hitId: 3, orderNo: 'PAY17580000000000099',
    channel: 'wechat', appId: 1, bizType: 'membership', bizId: 'M20260701010', amount: 15000, currency: 'CNY',
    reason: '当日交易笔数超过限额（会员业务限频）；50 + 1 > 50', status: 'pending',
    reviewerName: null, reviewedAt: null, reviewRemark: null,
    createdAt: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    updatedAt: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
  {
    id: 2, reviewNo: 'RSK17580000000000900', hitId: null, orderNo: 'PAY17580000000000080',
    channel: 'alipay', appId: 1, bizType: 'goods_order', bizId: 'G20260630021', amount: 320000, currency: 'CNY',
    reason: '单笔金额超过限额（夜间大额送审）；320000 > 200000', status: 'approved',
    reviewerName: '管理员', reviewedAt: dayjs().subtract(20, 'hour').format('YYYY-MM-DD HH:mm:ss'), reviewRemark: '已电话核实为本人操作',
    createdAt: dayjs().subtract(22, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    updatedAt: dayjs().subtract(20, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  },
];

export const paymentRiskOpsHandlers = [
  mock(paymentRiskOpsContract.hits, ({ query, ok, paginate }) => {
    const filtered = hits.filter((h) =>
      (!query.keyword || h.ruleName.includes(query.keyword) || (h.orderNo ?? '').includes(query.keyword) || h.bizId.includes(query.keyword)) &&
      (!query.action || h.action === query.action) && (!query.dimension || h.dimension === query.dimension) && (!query.channel || h.channel === query.channel) &&
      (!query.startTime || h.createdAt >= query.startTime) && (!query.endTime || h.createdAt <= query.endTime),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentRiskOpsContract.reviews, ({ query, ok, paginate }) => {
    const filtered = reviews.filter((r) =>
      (!query.keyword || r.reviewNo.includes(query.keyword) || r.orderNo.includes(query.keyword) || r.bizId.includes(query.keyword)) &&
      (!query.status || r.status === query.status) && (!query.channel || r.channel === query.channel),
    );
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),
  mock(paymentRiskOpsContract.approveReview, ({ params, body, ok }) => {
    const r = reviews.find((x) => x.id === params.id);
    if (!r) return notFound('审核单不存在');
    if (r.status !== 'pending') return badRequest('该审核单已处理');
    r.status = 'approved';
    r.reviewerName = '管理员';
    r.reviewedAt = mockDateTime();
    r.reviewRemark = body.remark;
    r.updatedAt = mockDateTime();
    return ok(r, '已放行');
  }),
  mock(paymentRiskOpsContract.rejectReview, ({ params, body, ok }) => {
    const r = reviews.find((x) => x.id === params.id);
    if (!r) return notFound('审核单不存在');
    if (r.status !== 'pending') return badRequest('该审核单已处理');
    r.status = 'rejected';
    r.reviewerName = '管理员';
    r.reviewedAt = mockDateTime();
    r.reviewRemark = body.remark;
    r.updatedAt = mockDateTime();
    return ok(r, '已拒绝');
  }),
];
