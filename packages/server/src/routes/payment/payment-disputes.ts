/**
 * 交易投诉/争议管理路由（/api/payment/disputes）。
 * 工单列表/详情/统计、商户回复、完结、投诉退款（复用退款审批链路）、模拟投诉（演示）。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { replyPaymentDisputeSchema, resolvePaymentDisputeSchema, refundPaymentDisputeSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentDisputeDTO, PaymentDisputeDetailDTO, PaymentDisputeStatsDTO } from '../../lib/openapi-dtos';
import {
  ensureDispute,
  getDisputeDetail,
  getDisputeStats,
  listDisputes,
  refundDispute,
  replyDispute,
  resolveDispute,
  simulateDispute,
} from '../../services/payment/payment-dispute.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const disputeStatusEnum = z.enum(['pending', 'processing', 'resolved', 'refunded']);
const disputeTypeEnum = z.enum(['refund_request', 'service_issue', 'fraud_report', 'other']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-交易投诉'], summary: '投诉工单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: disputeStatusEnum.optional(),
        channel: channelEnum.optional(),
        type: disputeTypeEnum.optional(),
        overdueOnly: z.coerce.boolean().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PaymentDisputeDTO, '投诉工单列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listDisputes(c.req.valid('query'))), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['支付中心-交易投诉'], summary: '投诉统计（待处理/超时/30天投诉率/平均时长）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })] as const,
    responses: { ...ok(PaymentDisputeStatsDTO, '投诉统计'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getDisputeStats()), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-交易投诉'], summary: '投诉工单详情（含时间线与订单摘要）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentDisputeDetailDTO, '工单详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getDisputeDetail(c.req.valid('param').id)), 200),
});

const replyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reply', tags: ['支付中心-交易投诉'], summary: '商户回复投诉',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '回复投诉', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(replyPaymentDisputeSchema), required: true } },
    responses: { ...ok(PaymentDisputeDetailDTO, '回复成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await replyDispute(id, c.req.valid('json').content), '回复成功'), 200);
  },
});

const resolveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/resolve', tags: ['支付中心-交易投诉'], summary: '完结投诉（协商解决）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '完结投诉', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(resolvePaymentDisputeSchema), required: false } },
    responses: { ...ok(PaymentDisputeDetailDTO, '已完结'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    const body = c.req.valid('json') as { remark?: string } | undefined;
    return c.json(okBody(await resolveDispute(id, body?.remark), '已完结'), 200);
  },
});

const refundRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/refund', tags: ['支付中心-交易投诉'], summary: '投诉退款（复用退款审批链路）',
    description: '资金流出接口，挂幂等防重复提交；大额退款自动进入退款审批。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:dispute:handle', audit: { description: '投诉退款', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { params: IdParam, body: { content: jsonContent(refundPaymentDisputeSchema), required: false } },
    responses: { ...ok(PaymentDisputeDetailDTO, '退款已发起'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    const body = (c.req.valid('json') ?? {}) as { refundAmount?: number; reason?: string };
    return c.json(okBody(await refundDispute(id, body), '退款已发起'), 200);
  },
});

const simulateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/simulate', tags: ['支付中心-交易投诉'], summary: '模拟一条投诉（演示/联调）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '模拟投诉', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(z.object({ orderNo: z.string().max(64).optional() })), required: false } },
    responses: { ...ok(PaymentDisputeDTO, '模拟投诉已生成'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const body = (c.req.valid('json') ?? {}) as { orderNo?: string };
    return c.json(okBody(await simulateDispute(body.orderNo), '模拟投诉已生成'), 200);
  },
});

router.openapiRoutes([listRoute, statsRoute, detailRoute, replyRoute, resolveRoute, refundRoute, simulateRoute] as const);

export default router;
