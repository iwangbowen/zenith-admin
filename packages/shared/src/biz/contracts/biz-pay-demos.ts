import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_METHODS } from '../../payment/constants';
import { createPaymentResultSchema } from '../../payment/contracts/payment-orders';
import { BIZ_PAY_DEMO_STATUSES } from '../constants';
import { createBizPayDemoSchema, payBizPayDemoSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 业务接入示例：支付接入（演示业务模块如何对接支付中心） */
export const bizPayDemoSchema = z.object({
  id: z.int(),
  subject: z.string().meta({ description: '示例事项 / 商品名称' }),
  amount: z.int().meta({ description: '金额（分）', example: 9900 }),
  payMethod: z.enum(PAYMENT_METHODS).nullable().meta({ description: '发起支付时记录的支付方式（下单前为 null）' }),
  status: z.enum(BIZ_PAY_DEMO_STATUSES),
  paymentOrderNo: z.string().nullable().meta({ description: '关联支付中心订单号（发起支付后回填）' }),
  paidAt: z.string().nullable().meta({ description: '支付成功时间 YYYY-MM-DD HH:mm:ss' }),
  fulfillRemark: z.string().nullable().meta({ description: '履约备注（支付成功后自动发放示例权益）' }),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'BizPayDemo' });

export type BizPayDemo = z.infer<typeof bizPayDemoSchema>;

/** 发起支付返回：业务单 + 支付参数（二维码 / 跳转链接 / JSAPI 参数） */
export const bizPayDemoPayResultSchema = z.object({
  demo: bizPayDemoSchema,
  payParams: createPaymentResultSchema,
}).meta({ id: 'BizPayDemoPayResult' });

export type BizPayDemoPayResult = z.infer<typeof bizPayDemoPayResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const bizPayDemoListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按事项名称模糊匹配' }),
  status: z.string().optional().meta({ description: '按业务状态过滤' }),
});

export const bizPayDemoContract = defineContract('/api/biz/pay-demos', {
  list: op.get('/', { query: bizPayDemoListQuery, response: paginated(bizPayDemoSchema), summary: '我的支付示例单列表' }),
  detail: op.get('/{id}', { params: idParam, response: bizPayDemoSchema, summary: '支付示例单详情' }),
  create: op.post('/', { body: createBizPayDemoSchema, response: bizPayDemoSchema, summary: '新建支付示例单' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除支付示例单' }),
  pay: op.post('/{id}/pay', { params: idParam, body: payBizPayDemoSchema, response: bizPayDemoPayResultSchema, summary: '发起支付（调用统一支付门面下单）' }),
  simulatePaid: op.post('/{id}/simulate-paid', { params: idParam, response: bizPayDemoSchema, summary: '模拟支付成功（演示专用，驱动真实履约订阅器）' }),
}, { tags: ['BizPayDemo'] });
