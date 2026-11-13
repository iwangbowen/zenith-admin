import { OpenAPIHono } from '@hono/zod-openapi';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { defineContractRoute } from '../../lib/contract-route';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { cleanApiAccessLogs, getApiAccessLog, getCleanApiAccessLogsBeforeAudit, listApiAccessLogs } from '../../services/platform/api-access-logs.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const cleanRoute = defineContractRoute(apiAccessLogContract.clean, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    setAuditBeforeData(c, await getCleanApiAccessLogsBeforeAudit(days));
    const deleted = await cleanApiAccessLogs(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody({ deleted }), 200);
  },
});

mountCrud(router, apiAccessLogContract, { list: listApiAccessLogs, get: getApiAccessLog }, {}, [cleanRoute]);

export default router;

