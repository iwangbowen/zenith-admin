import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentSettlementBatchDTO } from '../../lib/openapi-dtos';
import { listSettlements, getSettlement, generateSettlement, transitionSettlement, deleteSettlement } from '../../services/payment/payment-settlement.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const settlementStatusEnum = z.enum(['pending', 'settling', 'settled', 'failed']);
const periodDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '账期须为 YYYY-MM-DD');

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-结算'], summary: '结算批次列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:settlement:list' })] as const,
    request: { query: PaginationQuery.extend({ channel: channelEnum.optional(), status: settlementStatusEnum.optional() }) },
    responses: { ...okPaginated(PaymentSettlementBatchDTO, '结算批次列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSettlements(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-结算'], summary: '结算批次详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:settlement:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentSettlementBatchDTO, '结算批次详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getSettlement(c.req.valid('param').id)), 200),
});

const generateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/generate', tags: ['支付中心-结算'], summary: '生成结算批次（聚合账期成功订单）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:settlement:generate', audit: { description: '生成支付结算批次', module: '支付中心' } })] as const,
    request: {
      body: { content: jsonContent(z.object({ channel: channelEnum, periodStart: periodDate, periodEnd: periodDate, remark: z.string().max(256).optional() })), required: true },
    },
    responses: { ...ok(PaymentSettlementBatchDTO, '生成成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await generateSettlement(c.req.valid('json')), '生成成功'), 200),
});

const transitionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/status', tags: ['支付中心-结算'], summary: '结算批次状态流转（结算中/已结算/失败）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:settlement:settle', audit: { description: '流转支付结算批次状态', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['settling', 'settled', 'failed']) })), required: true } },
    responses: { ...ok(PaymentSettlementBatchDTO, '流转成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSettlement(id));
    return c.json(okBody(await transitionSettlement(id, c.req.valid('json').status), '流转成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['支付中心-结算'], summary: '删除结算批次',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:settlement:settle', audit: { description: '删除支付结算批次', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSettlement(id));
    await deleteSettlement(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, generateRoute, transitionRoute, deleteRoute] as const);

export default router;
