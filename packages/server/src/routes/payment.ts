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
} from '../lib/openapi-dtos';
import { getClientIp } from '../lib/request-helpers';
import {
  listAllChannelConfigs,
  listChannelConfigs,
  getChannelConfig,
  createChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
} from '../services/payment-channels.service';
import {
  listOrders,
  getOrderDetail,
  createPayment,
  refreshOrderById,
  closeOrderById,
  refund,
  listRefunds,
  getRefundDetail,
  listNotifyLogs,
} from '../services/payment.service';
import { getPaymentStats, exportOrders, exportOrdersCsv, exportRefunds, exportRefundsCsv } from '../services/payment-stats.service';

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
  bizType: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const refundsQuery = z.object({
  keyword: z.string().optional(),
  channel: channelEnum.optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
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

// ─── 支付订单 ───────────────────────────────────────────────────────────────────
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
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), channel: channelEnum.optional(), status: z.enum(['pending', 'processing', 'success', 'failed']).optional() }) },
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

// ─── 回调日志 ─────────────────────────────────────────────────────────────────────
const logsListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/logs', tags: ['支付中心'], summary: '支付回调日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:log:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), channel: channelEnum.optional() }) },
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
  channelsAllRoute,
  channelsListRoute,
  channelGetRoute,
  channelCreateRoute,
  channelUpdateRoute,
  channelDeleteRoute,
  ordersListRoute,
  orderCreateRoute,
  ordersExportRoute,
  ordersExportCsvRoute,
  orderGetRoute,
  orderQueryRoute,
  orderCloseRoute,
  refundCreateRoute,
  refundsListRoute,
  refundsExportRoute,
  refundsExportCsvRoute,
  refundGetRoute,
  logsListRoute,
] as const);

export default paymentRouter;
