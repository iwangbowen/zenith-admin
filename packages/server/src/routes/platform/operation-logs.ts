import { OpenAPIHono } from '@hono/zod-openapi';
import { operationLogContract } from '@zenith/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listOperationLogs, getOperationLog, operationLogStats, cleanOperationLogs, getCleanOperationLogsBeforeAudit } from '../../services/platform/operation-logs.service';
import { mountCrud } from '../_crud';

const operationLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(operationLogContract.stats, {
  handler: async (c) => c.json(okBody(await operationLogStats(c.req.valid('query').days)), 200),
});

const cleanRoute = defineContractRoute(operationLogContract.clean, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const before = await getCleanOperationLogsBeforeAudit(days);
    setAuditBeforeData(c, before);
    const deleted = await cleanOperationLogs(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条操作日志`), 200);
  },
});

mountCrud(operationLogsRoute, operationLogContract,
  { list: listOperationLogs, get: getOperationLog },
  {},
  [statsRoute, cleanRoute],
);

export default operationLogsRoute;
