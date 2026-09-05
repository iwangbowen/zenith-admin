import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CASHIER_METHODS, PAYMENT_CHANNELS, PAYMENT_METHODS, PAYMENT_ORDER_STATUSES } from '../constants';
import { createPaymentSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentOrderSchema = z.object({
  id: z.int(),
  orderNo: z.string(),
  outTradeNo: z.string(),
  channelTradeNo: z.string().nullable().optional(),
  bizType: z.string(),
  bizId: z.string(),
  subject: z.string(),
  body: z.string().nullable().optional(),
  amount: z.int().meta({ description: '金额（分）', example: 9900 }),
  currency: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  channelConfigId: z.int(),
  appId: z.int(),
  payMethod: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_ORDER_STATUSES),
  userId: z.int().nullable().optional(),
  openId: z.string().nullable().optional(),
  clientIp: z.string().nullable().optional(),
  departmentId: z.int().nullable().optional(),
  paidAmount: z.int().nullable().optional(),
  feeAmount: z.int().nullable().meta({ description: '手续费（分），null=未计费（订单未成功或费率任务未执行）' }),
  netAmount: z.int().nullable().meta({ description: '净额（分）= 实付 - 手续费，null=未计费' }),
  originalAmount: z.int().nullable().optional().meta({ description: '优惠前原价（分），null=无优惠' }),
  discountAmount: z.int().nullable().optional().meta({ description: '优惠立减金额（分）' }),
  memberCouponId: z.int().nullable().optional().meta({ description: '支付使用的会员券 id' }),
  paidAt: z.string().nullable().optional(),
  expiredAt: z.string().nullable().optional(),
  returnUrl: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  version: z.int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentOrder' });

export type PaymentOrder = z.infer<typeof paymentOrderSchema>;

/** 下单返回给客户端的支付参数（按支付方式不同而不同） */
export const createPaymentResultSchema = z.object({
  orderNo: z.string(),
  payMethod: z.enum(PAYMENT_METHODS),
  channel: z.enum(PAYMENT_CHANNELS),
  codeUrl: z.string().optional().meta({ description: '微信 native：二维码内容' }),
  payUrl: z.string().optional().meta({ description: '跳转链接（支付宝 page/wap、微信 h5）' }),
  formHtml: z.string().optional().meta({ description: '支付宝 page 可返回自动提交表单 HTML' }),
  jsapiParams: z.record(z.string(), z.string()).optional().meta({ description: '微信 JSAPI：调起支付所需参数' }),
  appOrderStr: z.string().optional().meta({ description: 'APP 支付：客户端调起字符串' }),
  expiredAt: z.string().optional(),
}).meta({ id: 'CreatePaymentResult' });

export type CreatePaymentResult = z.infer<typeof createPaymentResultSchema>;

export const createPaymentResponseSchema = z.object({
  orderNo: z.string(),
  payParams: createPaymentResultSchema,
}).meta({ id: 'CreatePaymentResponse' });

export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentOrderListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: z.enum(PAYMENT_ORDER_STATUSES).optional(),
  payMethod: z.enum(PAYMENT_CASHIER_METHODS).optional(),
  bizType: z.string().optional(),
  minAmount: z.coerce.number().int().nonnegative().optional(),
  maxAmount: z.coerce.number().int().nonnegative().optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const paymentOrderNoParam = z.object({
  orderNo: z.string().min(1).max(64).meta({ description: '支付订单号', example: 'PAY1700000000001' }),
});

/** 支付订单：与商户配置 / 退款 / 签约代扣共用 `/api/payment` 根，操作名在根内唯一 */
export const paymentOrderContract = defineContract('/api/payment', {
  orders: op.get('/orders', { query: paymentOrderListQuery, response: paginated(paymentOrderSchema), summary: '支付订单列表' }),
  createOrder: op.post('/orders', { body: createPaymentSchema, response: createPaymentResponseSchema, summary: '发起支付下单' }),
  orderByNo: op.get('/orders/by-no/{orderNo}', { params: paymentOrderNoParam, response: paymentOrderSchema, summary: '按订单号查询支付订单详情' }),
  orderDetail: op.get('/orders/{id}', { params: idParam, response: paymentOrderSchema, summary: '支付订单详情' }),
  queryOrder: op.post('/orders/{id}/query', { params: idParam, response: paymentOrderSchema, summary: '主动查询并同步订单状态' }),
  closeOrder: op.post('/orders/{id}/close', { params: idParam, summary: '关闭订单' }),
}, { tags: ['支付中心'] });
