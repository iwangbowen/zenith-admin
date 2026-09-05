import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsAdContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsAdSlots, createCmsAdSlot, updateCmsAdSlot, deleteCmsAdSlot, ensureCmsAdSlotExists, mapCmsAdSlot,
  listCmsAds, createCmsAd, updateCmsAd, deleteCmsAd, ensureCmsAdExists, mapCmsAd,
} from '../../services/cms/cms-ads.service';
import { getCmsAdEventStats, listCmsAdEvents } from '../../services/cms/cms-ad-events.service';
import { submitCmsAdEventCleanupTask } from '../../services/cms/cms-stage4-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:ad:list' })] as const;
const eventRead = [authMiddleware, guard({ permission: 'cms:ad-event:list' })] as const;

// ─── 广告位 ───────────────────────────────────────────────────────────────────
const listSlots = defineContractRoute(cmsAdContract.slots, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsAdSlots(c.req.valid('query').siteId)), 200),
});

const createSlot = defineContractRoute(cmsAdContract.slotCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '创建 CMS 广告位', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsAdSlot(c.req.valid('json')), '创建成功'), 200),
});

const updateSlot = defineContractRoute(cmsAdContract.slotUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '更新 CMS 广告位', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    return c.json(okBody(await updateCmsAdSlot(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteSlot = defineContractRoute(cmsAdContract.slotRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '删除 CMS 广告位', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    await deleteCmsAdSlot(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 广告投放 ─────────────────────────────────────────────────────────────────
const listAds = defineContractRoute(cmsAdContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsAds(c.req.valid('query'))), 200),
});

const createAd = defineContractRoute(cmsAdContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '创建 CMS 广告', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsAd(c.req.valid('json')), '创建成功'), 200),
});

const listEvents = defineContractRoute(cmsAdContract.events, {
  middleware: eventRead,
  handler: async (c) => c.json(okBody(await listCmsAdEvents(c.req.valid('query'))), 200),
});

const eventStats = defineContractRoute(cmsAdContract.eventStats, {
  middleware: eventRead,
  handler: async (c) => c.json(okBody(await getCmsAdEventStats(c.req.valid('query'))), 200),
});

const cleanupEvents = defineContractRoute(cmsAdContract.cleanupEvents, {
  middleware: [authMiddleware, guard({
    permission: 'cms:ad-event:cleanup',
    audit: { description: '清理 CMS 广告事件', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(
    await submitCmsAdEventCleanupTask(c.req.valid('json')),
    '清理任务已提交',
  ), 200),
});

const updateAd = defineContractRoute(cmsAdContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '更新 CMS 广告', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAd(await ensureCmsAdExists(id)));
    return c.json(okBody(await updateCmsAd(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAd = defineContractRoute(cmsAdContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '删除 CMS 广告', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAd(await ensureCmsAdExists(id)));
    await deleteCmsAd(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listSlots,
  createSlot,
  updateSlot,
  deleteSlot,
  listAds,
  listEvents,
  eventStats,
  cleanupEvents,
  createAd,
  updateAd,
  deleteAd,
] as const);

export default router;
