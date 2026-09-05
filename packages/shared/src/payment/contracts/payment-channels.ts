import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS } from '../constants';
import { createPaymentChannelConfigSchema, updatePaymentChannelConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 商户配置（密钥字段以 hasXxx 布尔位返回，绝不暴露明文） */
export const paymentChannelConfigSchema = z.object({
  id: z.int(),
  name: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  status: entityStatusSchema,
  isDefault: z.boolean(),
  sandbox: z.boolean(),
  notifyUrl: z.string().nullable().optional(),
  wechatAppId: z.string().nullable().optional(),
  wechatMchId: z.string().nullable().optional(),
  wechatSerialNo: z.string().nullable().optional(),
  wechatPlatformCert: z.string().nullable().optional(),
  hasWechatApiV3Key: z.boolean().optional(),
  hasWechatPrivateKey: z.boolean().optional(),
  alipayAppId: z.string().nullable().optional(),
  alipaySellerId: z.string().nullable().optional(),
  alipayPublicKey: z.string().nullable().optional(),
  alipaySignType: z.string().nullable().optional(),
  alipayGateway: z.string().nullable().optional(),
  hasAlipayPrivateKey: z.boolean().optional(),
  unionpayMerId: z.string().nullable().optional(),
  unionpayCertId: z.string().nullable().optional(),
  unionpayPublicKey: z.string().nullable().optional(),
  unionpayGateway: z.string().nullable().optional(),
  hasUnionpayPrivateKey: z.boolean().optional(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentChannelConfig' });

export type PaymentChannelConfig = z.infer<typeof paymentChannelConfigSchema>;

/** 资金运营页面使用的最小商户配置下拉项，不暴露凭证及网关元数据 */
export const paymentChannelConfigLookupSchema = paymentChannelConfigSchema.pick({
  id: true,
  name: true,
  channel: true,
  sandbox: true,
}).meta({ id: 'PaymentChannelConfigLookup' });

export type PaymentChannelConfigLookup = z.infer<typeof paymentChannelConfigLookupSchema>;

export const channelConnectivityResultSchema = z.object({
  success: z.boolean().meta({ description: '连通性是否正常（凭据有效）' }),
  message: z.string().meta({ description: '测试结果描述' }),
  latencyMs: z.number().meta({ description: '探测耗时（毫秒）' }),
}).meta({ id: 'ChannelConnectivityResult' });

export type ChannelConnectivityResult = z.infer<typeof channelConnectivityResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentChannelListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: entityStatusSchema.optional(),
});

/** 商户配置：与订单 / 退款 / 签约代扣共用支付资源根，操作名在根内唯一 */
export const paymentChannelContract = defineContract('/api/payment', {
  channelOperationLookup: op.get('/channels/operation-lookup', { response: z.array(paymentChannelConfigLookupSchema), summary: '资金运营商户配置下拉' }),
  channelsAll: op.get('/channels/all', { response: z.array(paymentChannelConfigSchema), summary: '全量支付渠道（下拉）' }),
  channels: op.get('/channels', { query: paymentChannelListQuery, response: paginated(paymentChannelConfigSchema), summary: '支付渠道列表' }),
  channelDetail: op.get('/channels/{id}', { params: idParam, response: paymentChannelConfigSchema, summary: '支付渠道详情' }),
  createChannel: op.post('/channels', { body: createPaymentChannelConfigSchema, response: paymentChannelConfigSchema, summary: '创建支付渠道' }),
  updateChannel: op.put('/channels/{id}', { params: idParam, body: updatePaymentChannelConfigSchema, response: paymentChannelConfigSchema, summary: '更新支付渠道' }),
  removeChannel: op.delete('/channels/{id}', { params: idParam, summary: '删除支付渠道' }),
  testChannel: op.post('/channels/{id}/test', {
    params: idParam,
    response: channelConnectivityResultSchema,
    summary: '测试渠道连通性',
    description: '向支付渠道发起轻量探测请求（查询一个不存在的订单号），验证商户凭据是否正确。',
  }),
  setDefaultChannel: op.post('/channels/{id}/default', {
    params: idParam,
    response: paymentChannelConfigSchema,
    summary: '设为默认渠道',
    description: '将指定渠道配置设为该渠道（微信/支付宝）的默认，并自动启用；同渠道内其他配置取消默认。',
  }),
}, { tags: ['支付中心'] });
