/**
 * 短链管理
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { shortLinkContract } from '@zenith/shared/short-link';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, errBody } from '../../lib/openapi-schemas';
import {
  listShortLinks, getShortLink, createShortLink, updateShortLink,
  deleteShortLink, deleteShortLinks, batchUpdateShortLinkStatus, ensureShortLinkExists, ensureShortLink,
} from '../../services/short-link/short-link.service';
import { getShortLinkStats } from '../../services/short-link/short-link-stats.service';

const shortLinksRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'shortlink:link:list' })] as const;

const listRoute = defineContractRoute(shortLinkContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listShortLinks(c.req.valid('query'))), 200),
});

// 静态 /batch 须早于 /{id} 注册
const batchDeleteRoute = defineContractRoute(shortLinkContract.removeBatch, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:delete',
    audit: { description: '批量删除短链', module: '短链管理' },
  })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids.length) return c.json(errBody('请选择要删除的记录'), 400);
    const deleted = await deleteShortLinks(ids);
    return c.json(okBody(null, `已删除 ${deleted} 条记录`), 200);
  },
});

const batchStatusRoute = defineContractRoute(shortLinkContract.batchUpdateStatus, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:update',
    audit: { description: '批量更新短链状态', module: '短链管理' },
  })],
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const updated = await batchUpdateShortLinkStatus(ids, status);
    return c.json(okBody(null, `已${status === 'enabled' ? '启用' : '禁用'} ${updated} 条记录`), 200);
  },
});

const ensureRoute = defineContractRoute(shortLinkContract.ensure, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:create',
    audit: { description: '业务对象生成短链', module: '短链管理' },
  })],
  handler: async (c) => c.json(okBody(await ensureShortLink(c.req.valid('json'))), 200),
});

const detailRoute = defineContractRoute(shortLinkContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getShortLink(c.req.valid('param').id)), 200),
});

const statsRoute = defineContractRoute(shortLinkContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'shortlink:stats:view' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { days } = c.req.valid('query');
    return c.json(okBody(await getShortLinkStats(id, days)), 200);
  },
});

const createRouteDef = defineContractRoute(shortLinkContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:create',
    audit: { description: '创建短链', module: '短链管理' },
  })],
  handler: async (c) => c.json(okBody(await createShortLink(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(shortLinkContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:update',
    audit: { description: '更新短链', module: '短链管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureShortLinkExists(id));
    return c.json(okBody(await updateShortLink(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(shortLinkContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'shortlink:link:delete',
    audit: { description: '删除短链', module: '短链管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureShortLinkExists(id));
    await deleteShortLink(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

shortLinksRouter.openapiRoutes([
  listRoute,
  batchDeleteRoute,
  batchStatusRoute,
  ensureRoute,
  detailRoute,
  statsRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
] as const);

export default shortLinksRouter;
