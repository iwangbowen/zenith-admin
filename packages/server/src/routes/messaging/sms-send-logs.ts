import { OpenAPIHono } from '@hono/zod-openapi';
import { smsSendLogContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSmsSendLogs, getSmsSendLog, deleteSmsSendLog, sendSms,
} from '../../services/messaging/sms-send-logs.service';
import { getClientIp } from '../../lib/request-helpers';

const smsSendLogsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(smsSendLogContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:list' })],
  handler: async (c) => c.json(okBody(await listSmsSendLogs(c.req.valid('query'))), 200),
});

const deleteRoute = defineContractRoute(smsSendLogContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:delete', audit: { description: '删除短信发送记录', module: '短信发送记录' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsSendLog(id));
    await deleteSmsSendLog(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const sendRoute = defineContractRoute(smsSendLogContract.testSend, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:test', audit: { description: '测试发送短信', module: '短信发送记录' } })],
  handler: async (c) => {
    const ip = getClientIp(c);
    const result = await sendSms(c.req.valid('json'), 'manual', ip);
    return c.json(okBody(result, result.status === 'success' ? '发送成功' : '发送失败'), 200);
  },
});

smsSendLogsRouter.openapiRoutes([listRoute, sendRoute, deleteRoute] as const);

export default smsSendLogsRouter;
