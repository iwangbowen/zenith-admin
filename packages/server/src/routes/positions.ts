import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { PositionDTO, PositionUserPreviewDTO } from '../lib/openapi-dtos';
import {
  listAllPositions,
  listPositions,
  createPosition,
  updatePosition,
  deletePosition,
  batchDeletePositions,
  getPositionsBeforeAudit,
  getPositionBeforeAudit,
  getPosition,
  listPositionMembers,
  setPositionMembers,
  getPositionMembersBeforeAudit,
} from '../services/positions.service';

const positionsRouter = new OpenAPIHono({ defaultHook: validationHook });

const createPositionSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(64).regex(/^\w+$/),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});
const updatePositionSchema = createPositionSchema.partial();
const BatchDeleteBody = z.object({ ids: z.array(z.number()) });

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all', tags: ['Positions'], summary: '全量岗位（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: {},
    responses: { ...ok(z.array(PositionDTO), '全量岗位'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAllPositions()), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Positions'], summary: '岗位列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PositionDTO, '岗位列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listPositions(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Positions'], summary: '岗位详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PositionDTO, '岗位详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPosition(c.req.valid('param').id)), 200),
});

const createPositionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Positions'], summary: '创建岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:create', audit: { description: '创建岗位', module: '岗位管理' } })] as const,
    request: { body: { content: jsonContent(createPositionSchema), required: true } },
    responses: { ...ok(PositionDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createPosition(c.req.valid('json')), '创建成功'), 200),
});

const updatePositionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Positions'], summary: '更新岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:update', audit: { description: '更新岗位', module: '岗位管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updatePositionSchema), required: true } },
    responses: { ...ok(PositionDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getPositionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updatePosition(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Positions'], summary: '批量删除岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:delete', audit: { description: '批量删除岗位', module: '岗位管理' } })] as const,
    request: { body: { content: jsonContent(BatchDeleteBody), required: true } },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getPositionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { count } = await batchDeletePositions(ids);
    return c.json(okBody(null, `已删除 ${count} 个岗位`), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Positions'], summary: '删除岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:delete', audit: { description: '删除岗位', module: '岗位管理' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getPositionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deletePosition(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const MembersBody = z.object({ userIds: z.array(z.number().int().positive()) });

const listMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/members', tags: ['Positions'], summary: '获取岗位成员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(z.array(PositionUserPreviewDTO), '成员列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listPositionMembers(c.req.valid('param').id)), 200),
});

const setMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/members', tags: ['Positions'], summary: '设置岗位成员（全量覆盖）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:update', audit: { description: '设置岗位成员', module: '岗位管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(MembersBody), required: true } },
    responses: { ...okMsg('保存成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getPositionMembersBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await setPositionMembers(id, userIds);
    const after = await getPositionMembersBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

positionsRouter.openapiRoutes([allRoute, listRoute, getOneRoute, createPositionRoute, updatePositionRoute, batchDeleteRoute, deleteRoute, listMembersRoute, setMembersRoute] as const);

export default positionsRouter;
