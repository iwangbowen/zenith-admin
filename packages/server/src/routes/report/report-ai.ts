import { OpenAPIHono } from '@hono/zod-openapi';
import { reportAiContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { generateReportSql } from '../../services/report/report-ai.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const nl2sqlRoute = defineContractRoute(reportAiContract.nl2sql, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })],
  handler: async (c) => c.json(okBody(await generateReportSql(c.req.valid('json'))), 200),
});

router.openapiRoutes([nl2sqlRoute] as const);

export default router;
