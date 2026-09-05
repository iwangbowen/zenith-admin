import { OpenAPIHono } from '@hono/zod-openapi';
import { operationLogContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listOperationLogs, operationLogStats, cleanOperationLogs, getCleanOperationLogsBeforeAudit } from '../../services/platform/operation-logs.service';

const operationLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:log:operation' })] as const;

const listRoute = defineContractRoute(operationLogContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listOperationLogs(c.req.valid('query'))), 200),
});

const statsRoute = defineContractRoute(operationLogContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await operationLogStats(c.req.valid('query').days)), 200),
});

const cleanRoute = defineContractRoute(operationLogContract.clean, {
  middleware: [authMiddleware, guard({
    permission: 'system:log:operation',
    audit: { description: '清除操作日志', module: '操作日志' },
  })],
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const before = await getCleanOperationLogsBeforeAudit(days);
    setAuditBeforeData(c, before);
    const deleted = await cleanOperationLogs(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条操作日志`), 200);
  },
});

operationLogsRoute.openapiRoutes([listRoute, statsRoute, cleanRoute] as const);

export default operationLogsRoute;
