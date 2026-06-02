import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { announcementRecipientSchema } from '@zenith/shared';
import {
  ErrorResponse, PaginationQuery, BatchIdsBody, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody,
} from '../lib/openapi-schemas';
import { AnnouncementDTO, AnnouncementReadStatsDTO, AnnouncementUnreadCountDTO } from '../lib/openapi-dtos';
import {
  listPublishedForUser, markAnnouncementRead, markAllAnnouncementsRead, getInbox, listAnnouncements,
  exportAnnouncements, batchDeleteAnnouncements, getAnnouncementReadStats, getAnnouncementDetail,
  createAnnouncement, updateAnnouncement, deleteAnnouncement, getAnnouncementBeforeAudit, getAnnouncementsBeforeAudit,
  getUnreadAnnouncementCount,
} from '../services/announcements.service';

const announcementsRouter = new OpenAPIHono({ defaultHook: validationHook });

const dateTimeStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '日期时间格式必须为 YYYY-MM-DD HH:mm:ss')
  .openapi({ example: '2026-03-22 20:09:37' });

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(128),
  content: z.string().min(1).max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(['draft', 'published', 'recalled', 'scheduled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(['all', 'specific']).default('all'),
  recipients: z.array(announcementRecipientSchema).optional().default([]),
  publishTime: dateTimeStringSchema.optional().nullable(),
  fileIds: z.array(z.number().int()).optional().default([]),
});
const updateAnnouncementSchema = createAnnouncementSchema.partial();

const publishedRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/published', tags: ['Announcements'], summary: '最近 20 条已发布公告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AnnouncementDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPublishedForUser()), 200),
});

const unreadCountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/unread-count', tags: ['Announcements'], summary: '未读公告数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(AnnouncementUnreadCountDTO, '未读公告数') },
  }),
  handler: async (c) => c.json(okBody({ count: await getUnreadAnnouncementCount() }), 200),
});

const readRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/read', tags: ['Announcements'], summary: '标记已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markAnnouncementRead(id);
    return c.json(okBody(null), 200);
  },
});

const readAllRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/read-all', tags: ['Announcements'], summary: '全部标记已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    await markAllAnnouncementsRead();
    return c.json(okBody(null), 200);
  },
});

const inboxRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/inbox', tags: ['Announcements'], summary: '收件箱',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery.extend({ isRead: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(AnnouncementDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getInbox(c.req.valid('query'))), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Announcements'], summary: '公告列表（管理）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:list' })] as const,
    request: { query: PaginationQuery.extend({ title: z.string().optional(), type: z.string().optional(), publishStatus: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(AnnouncementDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAnnouncements(c.req.valid('query'))), 200),
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Announcements'], summary: '导出',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel() },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportAnnouncements();
    return excelStreamBody(c, stream, filename);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Announcements'], summary: '批量删除',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:delete', audit: { description: '批量删除公告', module: '公告' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getAnnouncementsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteAnnouncements(ids);
    return c.json(okBody(null, `已删除 ${count} 条公告`), 200);
  },
});

const readStatsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/read-stats', tags: ['Announcements'], summary: '阅读统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:list' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ tab: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...ok(AnnouncementReadStatsDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAnnouncementReadStats(id, c.req.valid('query'))), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Announcements'], summary: '详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(AnnouncementDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAnnouncementDetail(id)), 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Announcements'], summary: '创建公告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:create', audit: { description: '创建公告', module: '公告' } })] as const,
    request: { body: { content: jsonContent(createAnnouncementSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AnnouncementDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createAnnouncement(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Announcements'], summary: '更新公告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:update', audit: { description: '更新公告', module: '公告' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAnnouncementSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(AnnouncementDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getAnnouncementBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateAnnouncement(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Announcements'], summary: '删除公告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:announcement:delete', audit: { description: '删除公告', module: '公告' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getAnnouncementBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteAnnouncement(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

announcementsRouter.openapiRoutes([
  publishedRoute, unreadCountRoute, readRoute, readAllRoute, inboxRoute, listRoute, exportRouteDef,
  batchDeleteRoute, readStatsRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef,
] as const);

export default announcementsRouter;
