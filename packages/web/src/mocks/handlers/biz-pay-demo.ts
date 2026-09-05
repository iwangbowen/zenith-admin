import { bizPayDemoContract, type BizPayDemo } from '@zenith/shared/biz';
import { PAYMENT_METHOD_CHANNEL, type CreatePaymentResult } from '@zenith/shared/payment';
import { mockBizPayDemos, getNextPayDemoId } from '@/mocks/data/biz-pay-demo';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, notFound } from '@/mocks/utils/handlers';

export const bizPayDemoHandlers = [
  // 列表
  mock(bizPayDemoContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = [...mockBizPayDemos].sort((a, b) => b.id - a.id);
    if (query.status) list = list.filter((d) => d.status === query.status);
    if (keyword) list = list.filter((d) => d.subject.toLowerCase().includes(keyword));
    return ok(paginate(list));
  }),

  // 详情
  mock(bizPayDemoContract.detail, ({ params, ok }) => {
    const demo = mockBizPayDemos.find((d) => d.id === params.id);
    if (!demo) return notFound('示例单不存在');
    return ok(demo);
  }),

  // 新建
  mock(bizPayDemoContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const demo: BizPayDemo = {
      id: getNextPayDemoId(),
      subject: body.subject,
      amount: body.amount,
      payMethod: null,
      status: 'pending',
      paymentOrderNo: null,
      paidAt: null,
      fulfillRemark: null,
      tenantId: 1,
      createdAt: now,
      updatedAt: now,
    };
    mockBizPayDemos.unshift(demo);
    return ok(demo, '创建成功');
  }),

  // 删除
  mock(bizPayDemoContract.remove, ({ params, ok }) => {
    const idx = mockBizPayDemos.findIndex((d) => d.id === params.id);
    if (idx === -1) return notFound('示例单不存在');
    if (mockBizPayDemos[idx].status === 'paid') return badRequest('已支付的示例单不可删除');
    mockBizPayDemos.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // 发起支付：返回二维码/跳转链接，并置「支付中」
  mock(bizPayDemoContract.pay, ({ params, body, ok }) => {
    const demo = mockBizPayDemos.find((d) => d.id === params.id);
    if (!demo) return notFound('示例单不存在');
    if (demo.status === 'paid') return badRequest('该示例单已支付，无需重复发起');
    const payMethod = body.payMethod;
    const channel = PAYMENT_METHOD_CHANNEL[payMethod];
    const orderNo = `PAYDEMO${Date.now()}${demo.id}`;
    demo.status = 'paying';
    demo.payMethod = payMethod;
    demo.paymentOrderNo = orderNo;
    demo.updatedAt = mockDateTime();
    const payParams: CreatePaymentResult = {
      orderNo,
      payMethod,
      channel,
      ...(channel === 'wechat'
        ? { codeUrl: `weixin://wxpay/bizpayurl?pr=DEMO${demo.id}` }
        : { payUrl: `https://example.com/mock-alipay/pay?orderNo=${orderNo}` }),
    };
    return ok({ demo, payParams }, '下单成功');
  }),

  // 模拟支付成功：履约（置 paid + 发放权益）
  mock(bizPayDemoContract.simulatePaid, ({ params, ok }) => {
    const demo = mockBizPayDemos.find((d) => d.id === params.id);
    if (!demo) return notFound('示例单不存在');
    if (!demo.paymentOrderNo) return badRequest('请先创建支付订单');
    if (demo.status !== 'paid') {
      const now = mockDateTime();
      demo.status = 'paid';
      demo.paidAt = now;
      demo.fulfillRemark = '支付成功，已自动发放示例权益（演示履约）';
      demo.updatedAt = now;
    }
    return ok(demo, '已模拟支付成功');
  }),
];
