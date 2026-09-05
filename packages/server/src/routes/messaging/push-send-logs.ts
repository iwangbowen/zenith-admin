/**
 * App 推送发送记录（管理侧只读）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { pushSendLogContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getPushSendLogStats, listPushSendLogs } from '../../services/messaging/push-send-logs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:push-log:list' })] as const;

const listRoute = defineContractRoute(pushSendLogContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listPushSendLogs(c.req.valid('query'))), 200),
});

const statsRoute = defineContractRoute(pushSendLogContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getPushSendLogStats(c.req.valid('query').days)), 200),
});

router.openapiRoutes([listRoute, statsRoute] as const);

export default router;
