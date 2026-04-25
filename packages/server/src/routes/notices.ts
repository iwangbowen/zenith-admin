import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { noticeRecipientSchema } from '@zenith/shared';
import {
  ErrorResponse, PaginationQuery, BatchIdsBody, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody,
} from '../lib/openapi-schemas';
import { NoticeDTO, NoticeReadStatsDTO } from '../lib/openapi-dtos';
import {
  listPublishedForUser, markNoticeRead, markAllNoticesRead, getInbox, listNotices,
  exportNotices, batchDeleteNotices, getNoticeReadStats, getNoticeDetail,
  createNotice, updateNotice, deleteNotice,
} from '../services/notices.service';

const noticesRouter = new OpenAPIHono({ defaultHook: validationHook });

const dateTimeStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '日期时间格式必须为 YYYY-MM-DD HH:mm:ss')
  .openapi({ example: '2026-03-22 20:09:37' });

const createNoticeSchema = z.object({
  title: z.string().min(1).max(128),
  content: z.string().min(1).max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(['draft', 'published', 'recalled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(['all', 'specific']).default('all'),
  recipients: z.array(noticeRecipientSchema).optional().default([]),
  publishTime: dateTimeStringSchema.optional().nullable(),
});
const updateNoticeSchema = createNoticeSchema.partial();

const publishedRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/published', tags: ['Notices'], summary: '最近 20 条已发布通知',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(NoticeDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPublishedForUser()), 200),
});

const readRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/read', tags: ['Notices'], summary: '标记已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markNoticeRead(id);
    return c.json(okBody(null), 200);
  },
});

const readAllRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/read-all', tags: ['Notices'], summary: '全部标记已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    await markAllNoticesRead();
    return c.json(okBody(null), 200);
  },
});

const inboxRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/inbox', tags: ['Notices'], summary: '收件箱',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ isRead: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(NoticeDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getInbox(c.req.valid('query'))), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Notices'], summary: '通知列表（管理）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:list' })] as const,
    request: { query: PaginationQuery.extend({ title: z.string().optional(), type: z.string().optional(), publishStatus: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(NoticeDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listNotices(c.req.valid('query'))), 200),
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Notices'], summary: '导出',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel() },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportNotices();
    return excelBody(c, buffer, filename);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Notices'], summary: '批量删除',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:delete', audit: { description: '批量删除通知公告', module: '通知公告' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await batchDeleteNotices(ids);
    return c.json(okBody(null, `已删除 ${count} 条通知`), 200);
  },
});

const readStatsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/read-stats', tags: ['Notices'], summary: '阅读统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:list' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ tab: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...ok(NoticeReadStatsDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getNoticeReadStats(id, c.req.valid('query'))), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Notices'], summary: '详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(NoticeDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getNoticeDetail(id)), 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Notices'], summary: '创建通知',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:create', audit: { description: '创建通知公告', module: '通知公告' } })] as const,
    request: { body: { content: jsonContent(createNoticeSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(NoticeDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createNotice(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Notices'], summary: '更新通知',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:update', audit: { description: '更新通知公告', module: '通知公告' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateNoticeSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(NoticeDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateNotice(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Notices'], summary: '删除通知',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:notice:delete', audit: { description: '删除通知公告', module: '通知公告' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteNotice(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

noticesRouter.openapiRoutes([
  publishedRoute, readRoute, readAllRoute, inboxRoute, listRoute, exportRouteDef,
  batchDeleteRoute, readStatsRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef,
] as const);

export default noticesRouter;
