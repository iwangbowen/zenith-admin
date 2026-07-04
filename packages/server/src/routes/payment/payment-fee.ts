import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createPaymentFeeRuleSchema, updatePaymentFeeRuleSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentFeeRuleDTO } from '../../lib/openapi-dtos';
import { listFeeRules, getFeeRule, createFeeRule, updateFeeRule, deleteFeeRule } from '../../services/payment/payment-fee.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-费率'], summary: '费率规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:fee:list' })] as const,
    request: { query: PaginationQuery.extend({ channel: channelEnum.optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(PaymentFeeRuleDTO, '费率规则列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listFeeRules(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-费率'], summary: '费率规则详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:fee:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentFeeRuleDTO, '费率规则详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getFeeRule(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['支付中心-费率'], summary: '新增费率规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:fee:create', audit: { description: '新增支付费率规则', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(createPaymentFeeRuleSchema), required: true } },
    responses: { ...ok(PaymentFeeRuleDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createFeeRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['支付中心-费率'], summary: '编辑费率规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:fee:update', audit: { description: '编辑支付费率规则', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updatePaymentFeeRuleSchema), required: true } },
    responses: { ...ok(PaymentFeeRuleDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getFeeRule(id));
    return c.json(okBody(await updateFeeRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['支付中心-费率'], summary: '删除费率规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:fee:delete', audit: { description: '删除支付费率规则', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getFeeRule(id));
    await deleteFeeRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
