import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createBizLeaveSchema, updateBizLeaveSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, IdParam, PaginationQuery,
} from '../../lib/openapi-schemas';
import { BizLeaveDTO } from '../../lib/openapi-dtos';
import {
  listBizLeaves, getBizLeave, getBizLeaveDetail, createBizLeave, updateBizLeave, deleteBizLeave, submitBizLeave, reopenBizLeave,
} from '../../services/biz-demo/biz-leave.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['BizLeave'], summary: '我的请假列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(BizLeaveDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listBizLeaves(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['BizLeave'], summary: '请假详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getBizLeave(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['BizLeave'], summary: '新建请假单（草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(createBizLeaveSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createBizLeave(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['BizLeave'], summary: '编辑请假单（仅草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(updateBizLeaveSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, '更新成功') },
  }),
  handler: async (c) => c.json(okBody(await updateBizLeave(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['BizLeave'], summary: '删除请假单（仅草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    await deleteBizLeave(c.req.valid('param').id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const submitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/submit', tags: ['BizLeave'], summary: '提交审批（发起并关联工作流）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, '已提交审批') },
  }),
  handler: async (c) => c.json(okBody(await submitBizLeave(c.req.valid('param').id), '已提交审批'), 200),
});

const reopenRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reopen', tags: ['BizLeave'], summary: '重新编辑（驳回/取消后转回草稿，可修改后再次提交）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, '已转为草稿') },
  }),
  handler: async (c) => c.json(okBody(await reopenBizLeave(c.req.valid('param').id), '已转为草稿'), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/detail', tags: ['BizLeave'], summary: '请假详情（供工作流参与者/审批人查看）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(BizLeaveDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getBizLeaveDetail(c.req.valid('param').id)), 200),
});

router.openapiRoutes([listRoute, getRoute, detailRoute, createRoute_, updateRoute, deleteRoute, submitRoute, reopenRoute] as const);

export default router;
