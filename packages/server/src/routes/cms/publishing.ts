import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsPublishingContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  batchCmsPublishingAction,
  cmsPublishingAction,
  getCmsPublishingDetail,
  listCmsPublishArtifacts,
  listCmsPublishingTasks,
  submitCmsPublishTask,
  submitCmsSiteGroupPublish,
} from '../../services/cms/cms-publishing.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'cms:publish:view' })] as const;

const listRoute = defineContractRoute(cmsPublishingContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listCmsPublishingTasks(c.req.valid('query'))), 200),
});

const artifactsRoute = defineContractRoute(cmsPublishingContract.artifacts, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listCmsPublishArtifacts(c.req.valid('query'))), 200),
});

const submitRoute = defineContractRoute(cmsPublishingContract.submit, {
  middleware: [authMiddleware, guard({ permission: 'cms:publish:build', audit: { description: '提交 CMS 发布任务', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(await submitCmsPublishTask(c.req.valid('json')), '发布任务已提交'), 200),
});

const groupSubmitRoute = defineContractRoute(cmsPublishingContract.groupSubmit, {
  middleware: [
    authMiddleware,
    guard({
      permission: 'cms:publish:group',
      audit: { description: '提交 CMS 站群整组重建', module: 'CMS内容管理' },
    }),
    idempotencyGuard({ ttlSeconds: 30 }),
  ],
  handler: async (c) => c.json(okBody(
    await submitCmsSiteGroupPublish(c.req.valid('json')),
    '站群重建任务已提交',
  ), 200),
});

const batchActionRoute = defineContractRoute(cmsPublishingContract.batchAction, {
  middleware: [authMiddleware, guard({ permission: 'cms:publish:manage', audit: { description: '批量操作 CMS 发布任务', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids, action } = c.req.valid('json');
    return c.json(okBody(await batchCmsPublishingAction(ids, action), '批量操作完成'), 200);
  },
});

const detailRoute = defineContractRoute(cmsPublishingContract.detail, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getCmsPublishingDetail(c.req.valid('param').id)), 200),
});

const actionRoute = defineContractRoute(cmsPublishingContract.action, {
  middleware: [authMiddleware, guard({ permission: 'cms:publish:manage', audit: { description: '操作 CMS 发布任务', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id, action } = c.req.valid('param');
    return c.json(okBody(await cmsPublishingAction(id, action), '操作已提交'), 200);
  },
});

router.openapiRoutes([
  listRoute, artifactsRoute, submitRoute, batchActionRoute, detailRoute, actionRoute,
  groupSubmitRoute,
] as const);

export default router;
