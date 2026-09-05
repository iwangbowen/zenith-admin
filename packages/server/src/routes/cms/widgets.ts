import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsWidgetContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createCmsWidget,
  deleteCmsWidget,
  getCmsWidget,
  getCmsWidgetPreview,
  listCmsWidgetRefs,
  listCmsWidgetRenderersForSite,
  listCmsWidgetSlots,
  listCmsWidgetSourceReferences,
  listCmsWidgets,
  listPublishedCmsWidgets,
  offlineCmsWidget,
  publishCmsWidget,
  saveCmsWidgetSlot,
  updateCmsWidget,
} from '../../services/cms/cms-widgets.service';
import { submitCmsWidgetBatchTask } from '../../services/cms/cms-widget-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:widget:list' })] as const;

const listRoute = defineContractRoute(cmsWidgetContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsWidgets(c.req.valid('query'))), 200),
});

const optionsRoute = defineContractRoute(cmsWidgetContract.options, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listPublishedCmsWidgets(c.req.valid('query').siteId)), 200),
});

const renderersRoute = defineContractRoute(cmsWidgetContract.renderers, {
  middleware: read,
  handler: async (c) => {
    const { siteId, type } = c.req.valid('query');
    return c.json(okBody(await listCmsWidgetRenderersForSite(siteId, type)), 200);
  },
});

const slotsRoute = defineContractRoute(cmsWidgetContract.slots, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsWidgetSlots(c.req.valid('query').siteId)), 200),
});

const saveSlotRoute = defineContractRoute(cmsWidgetContract.saveSlot, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:bind',
    audit: { description: '更新 CMS 主题页面部件插槽', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(await saveCmsWidgetSlot(
    c.req.valid('param').slotKey,
    c.req.valid('json'),
  ), '主题插槽已更新'), 200),
});

const batchRoute = defineContractRoute(cmsWidgetContract.batch, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:list',
    audit: { description: '提交 CMS 页面部件批量操作', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(
    await submitCmsWidgetBatchTask(c.req.valid('json')),
    '批量任务已提交',
  ), 200),
});

const sourceRefsRoute = defineContractRoute(cmsWidgetContract.sourceRefs, {
  middleware: read,
  handler: async (c) => {
    const { sourceType, sourceId } = c.req.valid('query');
    return c.json(okBody(await listCmsWidgetSourceReferences(sourceType, sourceId)), 200);
  },
});

const detailRoute = defineContractRoute(cmsWidgetContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsWidget(c.req.valid('param').id)), 200),
});

const refsRoute = defineContractRoute(cmsWidgetContract.refs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsWidgetRefs(c.req.valid('param').id)), 200),
});

const previewRoute = defineContractRoute(cmsWidgetContract.preview, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsWidgetPreview(
    c.req.valid('param').id,
    c.req.valid('query').rendererKey,
  )), 200),
});

const createRouteDef = defineContractRoute(cmsWidgetContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:create',
    audit: { description: '创建 CMS 页面部件', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(await createCmsWidget(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsWidgetContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:update',
    audit: { description: '更新 CMS 页面部件草稿', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    return c.json(okBody(await updateCmsWidget(id, c.req.valid('json')), '保存成功'), 200);
  },
});

const publishRoute = defineContractRoute(cmsWidgetContract.publish, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:publish',
    audit: { description: '发布 CMS 页面部件', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    return c.json(okBody(await publishCmsWidget(id), '发布成功，引用刷新任务已提交'), 200);
  },
});

const offlineRoute = defineContractRoute(cmsWidgetContract.offline, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:offline',
    audit: { description: '下线 CMS 页面部件', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    return c.json(okBody(await offlineCmsWidget(id), '下线成功，引用刷新任务已提交'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsWidgetContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'cms:widget:delete',
    audit: { description: '删除 CMS 页面部件', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsWidget(id));
    await deleteCmsWidget(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  optionsRoute,
  renderersRoute,
  slotsRoute,
  saveSlotRoute,
  batchRoute,
  sourceRefsRoute,
  refsRoute,
  previewRoute,
  publishRoute,
  offlineRoute,
  detailRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
] as const);

export default router;
