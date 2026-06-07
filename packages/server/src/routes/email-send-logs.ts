import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody,
} from '../lib/openapi-schemas';
import { sendEmailSchema, SEND_STATUSES, SEND_SOURCES } from '@zenith/shared';
import { EmailSendLogDTO, EmailSendResultDTO } from '../lib/openapi-dtos';
import {
  listEmailSendLogs, getEmailSendLog, deleteEmailSendLog, sendEmail, exportEmailSendLogs, exportEmailSendLogsAsCsv,
} from '../services/email-send-logs.service';

const emailSendLogsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listQuery = z.object({
  keyword: z.string().optional(),
  toEmail: z.string().optional(),
  status: z.enum(SEND_STATUSES).optional(),
  source: z.enum(SEND_SOURCES).optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['EmailSendLogs'], summary: '邮件发送记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-send-log:list' })] as const,
    request: { query: PaginationQuery.extend(listQuery.shape) },
    responses: { ...commonErrorResponses, ...okPaginated(EmailSendLogDTO, '邮件发送记录列表') },
  }),
  handler: async (c) => c.json(okBody(await listEmailSendLogs(c.req.valid('query'))), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['EmailSendLogs'], summary: '删除邮件发送记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-send-log:delete', audit: { description: '删除邮件发送记录', module: '邮件发送记录' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailSendLog(id));
    await deleteEmailSendLog(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/test-send', tags: ['EmailSendLogs'], summary: '测试发送邮件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-config:update', audit: { description: '测试发送邮件', module: '邮件发送记录' } })] as const,
    request: { body: { content: jsonContent(sendEmailSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(EmailSendResultDTO, '发送结果') },
  }),
  handler: async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const result = await sendEmail(c.req.valid('json'), 'manual', ip);
    return c.json(okBody(result, result.status === 'success' ? '发送成功' : '发送失败'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['EmailSendLogs'], summary: '导出邮件发送记录 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-send-log:export' })] as const,
    request: { query: listQuery },
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportEmailSendLogs(c.req.valid('query'));
    return excelStreamBody(c, stream, filename);
  },
});

const exportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['EmailSendLogs'], summary: '导出邮件发送记录 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-send-log:export' })] as const,
    request: { query: listQuery },
    responses: { ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportEmailSendLogsAsCsv(c.req.valid('query'));
    return csvStreamBody(c, stream, filename);
  },
});

emailSendLogsRouter.openapiRoutes([listRoute, sendRoute, exportRoute, exportCsvRoute, deleteRoute] as const);

export default emailSendLogsRouter;
