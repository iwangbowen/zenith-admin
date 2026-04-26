import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { PositionDTO } from '../lib/openapi-dtos';
import {
  listAllPositions,
  listPositions,
  createPosition,
  updatePosition,
  deletePosition,
  batchDeletePositions,
  exportPositions,
  getPositionsBeforeAudit,
  getPositionBeforeAudit,
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

const createPositionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Positions'], summary: '新增岗位',
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

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Positions'], summary: '导出岗位 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportPositions();
    return excelBody(c, buffer, filename);
  },
});

positionsRouter.openapiRoutes([allRoute, listRoute, createPositionRoute, updatePositionRoute, batchDeleteRoute, deleteRoute, exportRoute] as const);

export default positionsRouter;
