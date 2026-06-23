import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { idempotencyGuard } from '../middleware/idempotency';
import {
  PaginationQuery,
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  IdParam,
  okBody,
  okExcel,
  okCsv,
  excelStreamBody,
  csvStreamBody,
} from '../lib/openapi-schemas';
import {
  PaymentChannelConfigDTO,
  PaymentOrderDTO,
  PaymentRefundDTO,
  PaymentNotifyLogDTO,
  CreatePaymentResponseDTO,
  PaymentRefundResultDTO,
  PaymentStatsDTO,
  PaymentTrendPointDTO,
  ChannelConnectivityResultDTO,
} from '../lib/openapi-dtos';
import { getClientIp } from '../lib/request-helpers';
import {
  listAllChannelConfigs,
  listChannelConfigs,
  getChannelConfig,
  createChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  setChannelAsDefault,
} from '../services/payment-channels.service';
import {
  listOrders,
  getOrderDetail,
  getOrderDetailByNo,
  createPayment,
  refreshOrderById,
  closeOrderById,
  listOrderRefunds,
  refund,
  listRefunds,
  getRefundDetail,
  refreshRefundById,
  approveRefund,
  rejectRefund,
  listNotifyLogs,
  testChannelConnectivity,
} from '../services/payment.service';
import { getPaymentStats, getPaymentTrend, exportOrders, exportOrdersCsv, exportRefunds, exportRefundsCsv } from '../services/payment-stats.service';

const paymentRouter = new OpenAPIHono({ defaultHook: validationHook });

const channelEnum = z.enum(['wechat', 'alipay']);
const payMethodEnum = z.enum(['wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app']);

const channelCreateSchema = z.object({
  name: z.string().min(1).max(64),
  channel: channelEnum,
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  isDefault: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  notifyUrl: z.string().max(512).refine((v) => v === '' || /^https?:\/\/.+/.test(v), { message: '回调地址须为 http(s) 绝对地址' }).optional(),
  wechatAppId: z.string().max(64).optional(),
  wechatMchId: z.string().max(64).optional(),
  wechatApiV3Key: z.string().max(128).optional(),
  wechatPrivateKey: z.string().optional(),
  wechatSerialNo: z.string().max(128).optional(),
  wechatPlatformCert: z.string().optional(),
  alipayAppId: z.string().max(64).optional(),
  alipayPrivateKey: z.string().optional(),
  alipayPublicKey: z.string().optional(),
  alipaySignType: z.enum(['RSA2', 'RSA']).default('RSA2'),
  alipayGateway: z.string().max(256).optional(),
  remark: z.string().max(256).optional(),
});
const channelUpdateSchema = channelCreateSchema.partial();

const paymentCreateSchema = z.object({
  bizType: z.string().min(1).max(64),
  bizId: z.string().min(1).max(128),
  subject: z.string().min(1).max(256),
  body: z.string().max(512).optional(),
  amount: z.number().int().positive(),
  payMethod: payMethodEnum,
  channelConfigId: z.number().int().positive().optional(),
  openId: z.string().max(128).optional(),
  userId: z.number().int().positive().optional(),
  expireMinutes: z.number().int().positive().max(1440).default(30),
});

const refundCreateSchema = z.object({
  orderNo: z.string().min(1).max(64),
  refundAmount: z.number().int().positive(),
  reason: z.string().max(256).optional(),
});

const listQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  channel: channelEnum.optional(),
  status: z.enum(['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed']).optional(),
  payMethod: payMethodEnum.optional(),
  bizType: z.string().optional(),
  minAmount: z.coerce.number().int().nonnegative().optional(),
  maxAmount: z.coerce.number().int().nonnegative().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const refundsQuery = z.object({
  keyword: z.string().optional(),
  channel: channelEnum.optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
  approvalStatus: z.enum(['none', 'pending', 'approved', 'rejected']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const logsQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  channel: channelEnum.optional(),
  scene: z.enum(['payment', 'refund']).optional(),
  signatureValid: z.enum(['true', 'false']).optional().transform((v) => (v == null ? undefined : v === 'true')),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

// ─── 渠道配置 ───────────────────────────────────────────────────────────────────
const channelsAllRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/channels/all', tags: ['支付中心'], summary: '全量支付渠道（下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })] as const,
    request: {},
    responses: { ...ok(z.array(PaymentChannelConfigDTO), '全量渠道'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAllChannelConfigs()), 200),
});

const channelsListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/channels', tags: ['支付中心'], summary: '支付渠道列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), channel: channelEnum.optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(PaymentChannelConfigDTO, '渠道列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listChannelConfigs(c.req.valid('query'))), 200),
});

const channelGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/channels/{id}', tags: ['支付中心'], summary: '支付渠道详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentChannelConfigDTO, '渠道详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getChannelConfig(c.req.valid('param').id)), 200),
});

const channelCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/channels', tags: ['支付中心'], summary: '创建支付渠道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:create', audit: { description: '创建支付渠道', module: '支付中心', recordBody: false } })] as const,
    request: { body: { content: jsonContent(channelCreateSchema), required: true } },
    responses: { ...ok(PaymentChannelConfigDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createChannelConfig(c.req.valid('json')), '创建成功'), 200),
});

const channelUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/channels/{id}', tags: ['支付中心'], summary: '更新支付渠道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:update', audit: { description: '更新支付渠道', module: '支付中心', recordBody: false } })] as const,
    request: { params: IdParam, body: { content: jsonContent(channelUpdateSchema), required: true } },
    responses: { ...ok(PaymentChannelConfigDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await updateChannelConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const channelDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/channels/{id}', tags: ['支付中心'], summary: '删除支付渠道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:delete', audit: { description: '删除支付渠道', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    await deleteChannelConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const channelTestRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/channels/{id}/test', tags: ['支付中心'], summary: '测试渠道连通性',
    description: '向支付渠道发起轻量探测请求（查询一个不存在的订单号），验证商户凭据是否正确。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:update' })] as const,
    request: { params: IdParam },
    responses: { ...ok(ChannelConnectivityResultDTO, '连通性测试结果'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testChannelConnectivity(id);
    return c.json(okBody(result), 200);
  },
});

const channelSetDefaultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/channels/{id}/default', tags: ['支付中心'], summary: '设为默认渠道',
    description: '将指定渠道配置设为该渠道（微信/支付宝）的默认，并自动启用；同渠道内其他配置取消默认。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:channel:update', audit: { description: '设为默认支付渠道', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentChannelConfigDTO, '设置成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await setChannelAsDefault(id), '已设为默认'), 200);
  },
});

// ─── 支付订单 ─────────────────────────────────────────────────────────────
const ordersListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders', tags: ['支付中心'], summary: '支付订单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { query: listQuery },
    responses: { ...okPaginated(PaymentOrderDTO, '订单列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listOrders(c.req.valid('query'))), 200),
});

const orderCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/orders', tags: ['支付中心'], summary: '发起支付下单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 15, message: '下单处理中，请勿重复提交' }), guard({ permission: 'payment:order:create', audit: { description: '发起支付下单', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(paymentCreateSchema), required: true } },
    responses: { ...ok(CreatePaymentResponseDTO, '下单成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createPayment({ ...c.req.valid('json'), clientIp: getClientIp(c) }), '下单成功'), 200),
});

const orderGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders/{id}', tags: ['支付中心'], summary: '支付订单详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentOrderDTO, '订单详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getOrderDetail(c.req.valid('param').id)), 200),
});

const OrderNoParam = z.object({
  orderNo: z.string().min(1).max(64).openapi({ param: { name: 'orderNo', in: 'path' }, example: 'PAY1700000000001' }),
});

const orderGetByNoRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders/by-no/{orderNo}', tags: ['支付中心'], summary: '按订单号查询支付订单详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { params: OrderNoParam },
    responses: { ...ok(PaymentOrderDTO, '订单详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getOrderDetailByNo(c.req.valid('param').orderNo)), 200),
});

const orderRefundsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders/{id}/refunds', tags: ['支付中心'], summary: '支付订单关联退款',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' }), guard({ permission: ['payment:refund:list', 'payment:order:refund'] })] as const,
    request: { params: IdParam },
    responses: { ...ok(z.array(PaymentRefundDTO), '订单关联退款'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listOrderRefunds(c.req.valid('param').id)), 200),
});

const orderQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/orders/{id}/query', tags: ['支付中心'], summary: '主动查询并同步订单状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentOrderDTO, '最新订单状态'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await refreshOrderById(c.req.valid('param').id), '已同步'), 200),
});

const orderCloseRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/orders/{id}/close', tags: ['支付中心'], summary: '关闭订单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:close', audit: { description: '关闭支付订单', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('订单已关闭'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    await closeOrderById(id);
    return c.json(okBody(null, '订单已关闭'), 200);
  },
});

// ─── 退款 ───────────────────────────────────────────────────────────────────────
const refundCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refunds', tags: ['支付中心'], summary: '发起退款',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 15, message: '退款处理中，请勿重复提交' }), guard({ permission: 'payment:order:refund', audit: { description: '发起退款', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(refundCreateSchema), required: true } },
    responses: { ...ok(PaymentRefundResultDTO, '退款已发起'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await refund(c.req.valid('json')), '退款已发起'), 200),
});

const refundsListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/refunds', tags: ['支付中心'], summary: '退款记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })] as const,
    request: { query: PaginationQuery.merge(refundsQuery) },
    responses: { ...okPaginated(PaymentRefundDTO, '退款列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listRefunds(c.req.valid('query'))), 200),
});

const refundGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/refunds/{id}', tags: ['支付中心'], summary: '退款详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentRefundDTO, '退款详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getRefundDetail(c.req.valid('param').id)), 200),
});

const refundQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refunds/{id}/query', tags: ['支付中心'], summary: '主动查询并同步退款状态',
    description: '向支付渠道发起退款查单，纠正本地退款单状态（处理中→成功/失败），回调兜底。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentRefundDTO, '最新退款状态'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await refreshRefundById(c.req.valid('param').id), '已同步'), 200),
});

const refundApproveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refunds/{id}/approve', tags: ['支付中心'], summary: '审批通过退款并执行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:approve', audit: { description: '审批通过退款', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ remark: z.string().max(256).optional() })), required: true } },
    responses: { ...ok(PaymentRefundResultDTO, '审批通过'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await approveRefund(c.req.valid('param').id, c.req.valid('json').remark), '已审批通过'), 200),
});

const refundRejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refunds/{id}/reject', tags: ['支付中心'], summary: '驳回退款',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:approve', audit: { description: '驳回退款', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ remark: z.string().min(1).max(256) })), required: true } },
    responses: { ...okMsg('已驳回'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await rejectRefund(id, c.req.valid('json').remark);
    return c.json(okBody(null, '已驳回'), 200);
  },
});

// ─── 回调日志 ─────────────────────────────────────────────────────────────────────
const logsListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/logs', tags: ['支付中心'], summary: '支付回调日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:log:list' })] as const,
    request: { query: logsQuery },
    responses: { ...okPaginated(PaymentNotifyLogDTO, '回调日志'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listNotifyLogs(c.req.valid('query'))), 200),
});

// ─── 统计与导出 ───────────────────────────────────────────────────
const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['支付中心'], summary: '支付统计概览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: {},
    responses: { ...ok(PaymentStatsDTO, '统计概览'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPaymentStats()), 200),
});

const trendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/trend', tags: ['支付中心'], summary: '收款趋势（近 N 天）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30) }) },
    responses: { ...ok(z.array(PaymentTrendPointDTO), '收款趋势'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPaymentTrend(c.req.valid('query').days)), 200),
});

const ordersExportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders/export', tags: ['支付中心'], summary: '导出支付订单(Excel)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { query: listQuery },
    responses: { ...okExcel('支付订单.xlsx'), ...commonErrorResponses },
  }),
  handler: async (c) => excelStreamBody(c, await exportOrders(c.req.valid('query')), '支付订单.xlsx'),
});

const ordersExportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/orders/export/csv', tags: ['支付中心'], summary: '导出支付订单(CSV)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:order:list' })] as const,
    request: { query: listQuery },
    responses: { ...okCsv('支付订单.csv'), ...commonErrorResponses },
  }),
  handler: async (c) => csvStreamBody(c, await exportOrdersCsv(c.req.valid('query')), '支付订单.csv'),
});

const refundsExportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/refunds/export', tags: ['支付中心'], summary: '导出退款记录(Excel)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })] as const,
    request: { query: refundsQuery },
    responses: { ...okExcel('退款记录.xlsx'), ...commonErrorResponses },
  }),
  handler: async (c) => excelStreamBody(c, await exportRefunds(c.req.valid('query')), '退款记录.xlsx'),
});

const refundsExportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/refunds/export/csv', tags: ['支付中心'], summary: '导出退款记录(CSV)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })] as const,
    request: { query: refundsQuery },
    responses: { ...okCsv('退款记录.csv'), ...commonErrorResponses },
  }),
  handler: async (c) => csvStreamBody(c, await exportRefundsCsv(c.req.valid('query')), '退款记录.csv'),
});

paymentRouter.openapiRoutes([
  statsRoute,
  trendRoute,
  channelsAllRoute,
  channelsListRoute,
  channelGetRoute,
  channelCreateRoute,
  channelUpdateRoute,
  channelDeleteRoute,
  channelTestRoute,
  channelSetDefaultRoute,
  ordersListRoute,
  orderCreateRoute,
  ordersExportRoute,
  ordersExportCsvRoute,
  orderGetByNoRoute,
  orderGetRoute,
  orderRefundsRoute,
  orderQueryRoute,
  orderCloseRoute,
  refundCreateRoute,
  refundsListRoute,
  refundsExportRoute,
  refundsExportCsvRoute,
  refundGetRoute,
  refundQueryRoute,
  refundApproveRoute,
  refundRejectRoute,
  logsListRoute,
] as const);

export default paymentRouter;
