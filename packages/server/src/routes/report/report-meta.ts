import { OpenAPIHono } from '@hono/zod-openapi';
import { reportMetaContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { listMetaTables, listMetaColumns } from '../../lib/report-schema-meta';

// 可视化建模元数据：内置只读主库的表/列清单（敏感表/列已过滤）。
const router = new OpenAPIHono({ defaultHook: validationHook });

const tablesRoute = defineContractRoute(reportMetaContract.tables, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })],
  handler: async (c) => c.json(okBody(await listMetaTables()), 200),
});

const columnsRoute = defineContractRoute(reportMetaContract.columns, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => c.json(okBody(await listMetaColumns(c.req.valid('param').table)), 200),
});

router.openapiRoutes([tablesRoute, columnsRoute] as const);

export default router;
