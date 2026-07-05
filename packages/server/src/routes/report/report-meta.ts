import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, ok, jsonContent, okBody, ErrorResponse } from '../../lib/openapi-schemas';
import { ReportMetaColumnDTO } from '../../lib/openapi-dtos';
import { listMetaTables, listMetaColumns } from '../../lib/report-schema-meta';

// 可视化建模元数据：内置只读主库的表/列清单（敏感表/列已过滤）。挂载在 /api/report/meta。
const router = new OpenAPIHono({ defaultHook: validationHook });

const tablesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tables',
    tags: ['报表元数据'], summary: '可视化建模可用表清单（内置库）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.string()), '表名列表') },
  }),
  handler: async (c) => c.json(okBody(await listMetaTables()), 200),
});

const columnsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tables/{table}/columns',
    tags: ['报表元数据'], summary: '某表列清单（内置库）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })] as const,
    request: {
      params: z.object({
        table: z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '非法表名')
          .openapi({ param: { name: 'table', in: 'path' }, example: 'menus' }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportMetaColumnDTO), '列清单'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await listMetaColumns(c.req.valid('param').table)), 200),
});

router.openapiRoutes([tablesRoute, columnsRoute] as const);

export default router;
