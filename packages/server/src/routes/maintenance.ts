import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, ok, okBody, okMsg, commonErrorResponses } from '../lib/openapi-schemas';
import { MaintenanceStatusDTO } from '../lib/openapi-dtos';
import { getMaintenanceStatus, updateMaintenanceStatus } from '../services/maintenance.service';

const maintenanceRouter = new OpenAPIHono({ defaultHook: validationHook });

// ── GET /api/maintenance/status — Public ──────────────────────────────────
const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/status',
    tags: ['维护模式'],
    summary: '获取维护模式状态（公开）',
    security: [],
    responses: { ...ok(MaintenanceStatusDTO, '维护模式状态') },
  }),
  handler: async (c) => c.json(okBody(await getMaintenanceStatus()), 200),
});

// ── GET /api/maintenance — Admin ──────────────────────────────────────────
const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['维护模式'],
    summary: '获取维护模式详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:maintenance:manage' })] as const,
    responses: { ...ok(MaintenanceStatusDTO, '维护模式状态'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getMaintenanceStatus()), 200),
});

// ── PUT /api/maintenance — Admin ──────────────────────────────────────────
const UpdateBody = z.object({
  enabled: z.boolean(),
  message: z.string().max(512).optional(),
  estimatedEndAt: z.string().nullable().optional(),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/',
    tags: ['维护模式'],
    summary: '开启 / 关闭维护模式',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:maintenance:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: UpdateBody } } } },
    responses: { ...ok(MaintenanceStatusDTO, '更新后的维护模式状态'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const result = await updateMaintenanceStatus(body);
    return c.json(okBody(result), 200);
  },
});

maintenanceRouter.openapiRoutes([statusRoute, getRoute, updateRoute] as const);

export default maintenanceRouter;
