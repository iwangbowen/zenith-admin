import { OpenAPIHono } from '@hono/zod-openapi';
import { emailSendLogContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listEmailSendLogs, getEmailSendLog, deleteEmailSendLog, sendEmail,
} from '../../services/messaging/email-send-logs.service';
import { getClientIp } from '../../lib/request-helpers';

const emailSendLogsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(emailSendLogContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:email-send-log:list' })],
  handler: async (c) => c.json(okBody(await listEmailSendLogs(c.req.valid('query'))), 200),
});

const deleteRoute = defineContractRoute(emailSendLogContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:email-send-log:delete', audit: { description: '删除邮件发送记录', module: '邮件发送记录' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailSendLog(id));
    await deleteEmailSendLog(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const sendRoute = defineContractRoute(emailSendLogContract.testSend, {
  middleware: [authMiddleware, guard({ permission: 'system:email-config:update', audit: { description: '测试发送邮件', module: '邮件发送记录' } })],
  handler: async (c) => {
    const ip = getClientIp(c);
    const result = await sendEmail(c.req.valid('json'), 'manual', ip);
    return c.json(okBody(result, result.status === 'success' ? '发送成功' : '发送失败'), 200);
  },
});

emailSendLogsRouter.openapiRoutes([listRoute, sendRoute, deleteRoute] as const);

export default emailSendLogsRouter;
