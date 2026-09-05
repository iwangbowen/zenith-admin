import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsInteractionContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  copyCmsInteraction,
  createCmsInteraction,
  deleteCmsInteraction,
  getCmsInteraction,
  getCmsInteractionCrossStats,
  getCmsInteractionStats,
  getCmsInteractionTrend,
  listCmsInteractionResponses,
  listCmsInteractionTexts,
  listCmsInteractions,
  setCmsInteractionStatus,
  updateCmsInteraction,
} from '../../services/cms/cms-interactions.service';
import { submitCmsInteractionBatchStatusTask } from '../../services/cms/cms-stage4-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:interaction:list' })] as const;

const listRoute = defineContractRoute(cmsInteractionContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsInteractions(c.req.valid('query'))), 200),
});

const responseListRoute = defineContractRoute(cmsInteractionContract.responses, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsInteractionResponses(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(cmsInteractionContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsInteraction(c.req.valid('param').id)), 200),
});

const statsRoute = defineContractRoute(cmsInteractionContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsInteractionStats(c.req.valid('param').id)), 200),
});

const textsRoute = defineContractRoute(cmsInteractionContract.texts, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsInteractionTexts({
    interactionId: c.req.valid('param').id,
    ...c.req.valid('query'),
  })), 200),
});

const crossStatsRoute = defineContractRoute(cmsInteractionContract.crossStats, {
  middleware: read,
  handler: async (c) => {
    const { xQuestionId, yQuestionId } = c.req.valid('query');
    return c.json(okBody(await getCmsInteractionCrossStats(c.req.valid('param').id, xQuestionId, yQuestionId)), 200);
  },
});

const trendRoute = defineContractRoute(cmsInteractionContract.trend, {
  middleware: read,
  handler: async (c) => c.json(
    okBody(await getCmsInteractionTrend(c.req.valid('param').id, c.req.valid('query').days)),
    200,
  ),
});

const createRouteDef = defineContractRoute(cmsInteractionContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:manage',
    audit: { description: '创建 CMS 互动问卷', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(await createCmsInteraction(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsInteractionContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:manage',
    audit: { description: '更新 CMS 互动问卷', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    return c.json(okBody(await updateCmsInteraction(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const statusRoute = defineContractRoute(cmsInteractionContract.setStatus, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:manage',
    audit: { description: '流转 CMS 互动问卷状态', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    return c.json(okBody(await setCmsInteractionStatus(id, c.req.valid('json').status), '状态已更新'), 200);
  },
});

const batchStatusRoute = defineContractRoute(cmsInteractionContract.batchStatus, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:batch',
    audit: { description: '批量流转 CMS 互动问卷', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(
    await submitCmsInteractionBatchStatusTask(c.req.valid('json')),
    '批量任务已提交',
  ), 200),
});

const copyRoute = defineContractRoute(cmsInteractionContract.copy, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:manage',
    audit: { description: '复制 CMS 互动问卷', module: 'CMS内容管理' },
  })],
  handler: async (c) => c.json(okBody(await copyCmsInteraction(c.req.valid('param').id), '复制成功'), 200),
});

const deleteRouteDef = defineContractRoute(cmsInteractionContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'cms:interaction:manage',
    audit: { description: '删除 CMS 互动问卷', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const id = c.req.valid('param').id;
    setAuditBeforeData(c, await getCmsInteraction(id));
    await deleteCmsInteraction(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  responseListRoute,
  batchStatusRoute,
  detailRoute,
  textsRoute,
  crossStatsRoute,
  trendRoute,
  statsRoute,
  createRouteDef,
  updateRouteDef,
  statusRoute,
  copyRoute,
  deleteRouteDef,
] as const);

export default router;
