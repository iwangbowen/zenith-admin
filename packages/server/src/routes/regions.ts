import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody, okExcel, excelStreamBody } from '../lib/openapi-schemas';
import { RegionDTO } from '../lib/openapi-dtos';
import {
  listRegionTree,
  listRegionsFlat,
  createRegion,
  updateRegion,
  deleteRegion,
  getRegionBeforeAudit,
  exportRegions,
} from '../services/regions.service';

const regionsRouter = new OpenAPIHono({ defaultHook: validationHook });

const createRegionSchema = z.object({
  code: z.string().min(1).max(12),
  name: z.string().min(1).max(64),
  level: z.enum(['province', 'city', 'county']),
  parentCode: z.string().max(12).nullable().optional(),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});
const updateRegionSchema = createRegionSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Regions'], summary: '地区树形结构',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:list' })] as const,
    request: {
      query: z.object({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        level: z.enum(['province', 'city', 'county']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(RegionDTO), '地区树') },
  }),
  handler: async (c) => c.json(okBody(await listRegionTree(c.req.valid('query'))), 200),
});

const flatRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/flat', tags: ['Regions'], summary: '平铺地区列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(RegionDTO), '平铺地区列表') },
  }),
  handler: async (c) => c.json(okBody(await listRegionsFlat()), 200),
});

const createRegionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Regions'], summary: '新增地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:create', audit: { description: '创建地区', module: '地区管理' } })] as const,
    request: { body: { content: jsonContent(createRegionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RegionDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createRegion(c.req.valid('json')), '创建成功'), 200),
});

const updateRegionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Regions'], summary: '更新地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:update', audit: { description: '更新地区', module: '地区管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateRegionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RegionDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRegion(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Regions'], summary: '删除地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:delete', audit: { description: '删除地区', module: '地区管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteRegion(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Regions'], summary: '导出地区 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:export' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportRegions();
    return excelStreamBody(c, stream, filename);
  },
});

regionsRouter.openapiRoutes([listRoute, flatRoute, createRegionRoute, updateRegionRoute, deleteRoute, exportRoute] as const);

export default regionsRouter;
