import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createPaymentLinkSchema, updatePaymentLinkSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentLinkDTO } from '../../lib/openapi-dtos';
import { listLinks, getLink, createLink, updateLink, deleteLink, rotateLinkToken } from '../../services/payment/payment-link.service';
import type { PaymentLink } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

function maskPaymentLinkForAudit(link: PaymentLink): PaymentLink {
  return { ...link, token: '***' };
}

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-支付链接'], summary: '支付链接列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['active', 'disabled']).optional() }) },
    responses: { ...okPaginated(PaymentLinkDTO, '支付链接列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listLinks(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-支付链接'], summary: '支付链接详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentLinkDTO, '支付链接详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getLink(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['支付中心-支付链接'], summary: '新增支付链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:create', audit: { description: '新增支付链接', module: '支付中心', recordResponseBody: false } })] as const,
    request: { body: { content: jsonContent(createPaymentLinkSchema), required: true } },
    responses: { ...ok(PaymentLinkDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const created = await createLink(c.req.valid('json'));
    setAuditAfterData(c, maskPaymentLinkForAudit(created));
    return c.json(okBody(created, '创建成功'), 200);
  },
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['支付中心-支付链接'], summary: '编辑支付链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:update', audit: { description: '编辑支付链接', module: '支付中心', recordResponseBody: false } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updatePaymentLinkSchema), required: true } },
    responses: { ...ok(PaymentLinkDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, maskPaymentLinkForAudit(await getLink(id)));
    const updated = await updateLink(id, c.req.valid('json'));
    setAuditAfterData(c, maskPaymentLinkForAudit(updated));
    return c.json(okBody(updated, '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['支付中心-支付链接'], summary: '删除支付链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:delete', audit: { description: '删除支付链接', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, maskPaymentLinkForAudit(await getLink(id)));
    await deleteLink(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const rotateTokenRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/rotate-token', tags: ['支付中心-支付链接'], summary: '重置链接 token（安全轮换，旧链接立即失效）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:link:update', audit: { description: '重置支付链接 token', module: '支付中心', recordResponseBody: false } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentLinkDTO, '已重置'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, maskPaymentLinkForAudit(await getLink(id)));
    return c.json(okBody(await rotateLinkToken(id), 'token 已重置，旧链接已失效'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRoute, rotateTokenRoute, deleteRoute] as const);

export default router;
