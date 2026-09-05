import { OpenAPIHono } from '@hono/zod-openapi';
import { announcementContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPublishedForUser, markAnnouncementRead, markAllAnnouncementsRead, getInbox, listAnnouncements,
  batchDeleteAnnouncements, getAnnouncementReadStats, getAnnouncementDetail,
  createAnnouncement, updateAnnouncement, deleteAnnouncement, getAnnouncementBeforeAudit, getAnnouncementsBeforeAudit,
  getUnreadAnnouncementCount,
} from '../../services/messaging/announcements.service';

const announcementsRouter = new OpenAPIHono({ defaultHook: validationHook });

const manage = [authMiddleware, guard({ permission: 'system:announcement:list' })] as const;

const publishedRoute = defineContractRoute(announcementContract.published, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listPublishedForUser()), 200),
});

const unreadCountRoute = defineContractRoute(announcementContract.unreadCount, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody({ count: await getUnreadAnnouncementCount() }), 200),
});

const readRoute = defineContractRoute(announcementContract.markRead, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markAnnouncementRead(id);
    return c.json(okBody(null), 200);
  },
});

const readAllRoute = defineContractRoute(announcementContract.markAllRead, {
  middleware: [authMiddleware],
  handler: async (c) => {
    await markAllAnnouncementsRead();
    return c.json(okBody(null), 200);
  },
});

const inboxRoute = defineContractRoute(announcementContract.inbox, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getInbox(c.req.valid('query'))), 200),
});

const listRoute = defineContractRoute(announcementContract.list, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listAnnouncements(c.req.valid('query'))), 200),
});

const batchDeleteRoute = defineContractRoute(announcementContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:announcement:delete', audit: { description: '批量删除公告', module: '公告' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getAnnouncementsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteAnnouncements(ids);
    return c.json(okBody(null, `已删除 ${count} 条公告`), 200);
  },
});

const readStatsRoute = defineContractRoute(announcementContract.readStats, {
  middleware: manage,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAnnouncementReadStats(id, c.req.valid('query'))), 200);
  },
});

const detailRoute = defineContractRoute(announcementContract.detail, {
  middleware: manage,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAnnouncementDetail(id)), 200);
  },
});

const createRouteDef = defineContractRoute(announcementContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:announcement:create', audit: { description: '创建公告', module: '公告' } })],
  handler: async (c) => c.json(okBody(await createAnnouncement(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(announcementContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:announcement:update', audit: { description: '更新公告', module: '公告' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getAnnouncementBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateAnnouncement(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(announcementContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:announcement:delete', audit: { description: '删除公告', module: '公告' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getAnnouncementBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteAnnouncement(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

announcementsRouter.openapiRoutes([
  publishedRoute, unreadCountRoute, readRoute, readAllRoute, inboxRoute, listRoute,
  batchDeleteRoute, readStatsRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef,
] as const);

export default announcementsRouter;
