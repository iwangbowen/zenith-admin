/**
 * 支付应用（App 维度）管理路由（/api/payment/apps）。
 * 业务方按 appKey 下单，路由到应用绑定的各渠道配置。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createPaymentAppSchema, updatePaymentAppSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentAppDTO } from '../../lib/openapi-dtos';
import { listApps, getApp, createApp, updateApp, deleteApp } from '../../services/payment/payment-apps.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const statusEnum = z.enum(['enabled', 'disabled']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-应用'], summary: '支付应用列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:app:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: statusEnum.optional() }) },
    responses: { ...okPaginated(PaymentAppDTO, '支付应用列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listApps(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-应用'], summary: '支付应用详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:app:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentAppDTO, '支付应用详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getApp(c.req.valid('param').id)), 200),
});

const createAppRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['支付中心-应用'], summary: '新增支付应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '新增支付应用', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(createPaymentAppSchema), required: true } },
    responses: { ...ok(PaymentAppDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createApp(c.req.valid('json')), '创建成功'), 200),
});

const updateAppRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['支付中心-应用'], summary: '编辑支付应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '编辑支付应用', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updatePaymentAppSchema), required: true } },
    responses: { ...ok(PaymentAppDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApp(id));
    return c.json(okBody(await updateApp(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAppRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['支付中心-应用'], summary: '删除支付应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:app:manage', audit: { description: '删除支付应用', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApp(id));
    await deleteApp(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createAppRoute, updateAppRoute, deleteAppRoute] as const);

export default router;
