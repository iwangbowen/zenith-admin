import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody,
} from '../lib/openapi-schemas';
import { sendSmsSchema, SMS_PROVIDERS, SEND_STATUSES, SEND_SOURCES } from '@zenith/shared';
import { SmsSendLogDTO, SmsSendResultDTO } from '../lib/openapi-dtos';
import {
  listSmsSendLogs, getSmsSendLog, deleteSmsSendLog, sendSms, exportSmsSendLogs,
} from '../services/sms-send-logs.service';

const smsSendLogsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listQuery = z.object({
  keyword: z.string().optional(),
  phone: z.string().optional(),
  provider: z.enum(SMS_PROVIDERS).optional(),
  status: z.enum(SEND_STATUSES).optional(),
  source: z.enum(SEND_SOURCES).optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['SmsSendLogs'], summary: '短信发送记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:list' })] as const,
    request: { query: PaginationQuery.extend(listQuery.shape) },
    responses: { ...commonErrorResponses, ...okPaginated(SmsSendLogDTO, '短信发送记录列表') },
  }),
  handler: async (c) => c.json(okBody(await listSmsSendLogs(c.req.valid('query'))), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['SmsSendLogs'], summary: '删除短信发送记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:delete', audit: { description: '删除短信发送记录', module: '短信发送记录' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsSendLog(id));
    await deleteSmsSendLog(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/test-send', tags: ['SmsSendLogs'], summary: '测试发送短信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:test', audit: { description: '测试发送短信', module: '短信发送记录' } })] as const,
    request: { body: { content: jsonContent(sendSmsSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SmsSendResultDTO, '发送结果') },
  }),
  handler: async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const result = await sendSms(c.req.valid('json'), 'manual', ip);
    return c.json(okBody(result, result.status === 'success' ? '发送成功' : '发送失败'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['SmsSendLogs'], summary: '导出短信发送记录 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-send-log:export' })] as const,
    request: { query: listQuery },
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportSmsSendLogs(c.req.valid('query'));
    return excelStreamBody(c, stream, filename);
  },
});

smsSendLogsRouter.openapiRoutes([listRoute, sendRoute, exportRoute, deleteRoute] as const);

export default smsSendLogsRouter;
