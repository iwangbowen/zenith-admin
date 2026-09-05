import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsDistributionContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createCmsDistributionRule,
  deleteCmsDistributionRule,
  getCmsDistributionRule,
  getCmsDistributionRunDetail,
  listCmsDistributionRules,
  listCmsDistributionRuns,
  submitCmsDistributionRun,
  updateCmsDistributionRule,
} from '../../services/cms/cms-distributions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:distribution:list' })] as const;

const listRoute = defineContractRoute(cmsDistributionContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsDistributionRules(c.req.valid('query'))), 200),
});

const runsRoute = defineContractRoute(cmsDistributionContract.runs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsDistributionRuns(c.req.valid('query'))), 200),
});

const runDetailRoute = defineContractRoute(cmsDistributionContract.runDetail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsDistributionRunDetail(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsDistributionContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'cms:distribution:create',
    audit: { description: '创建 CMS 内容分发规则', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const result = await createCmsDistributionRule(c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已创建'), 200);
  },
});

const getRoute = defineContractRoute(cmsDistributionContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsDistributionRule(c.req.valid('param').id)), 200),
});

const updateRoute = defineContractRoute(cmsDistributionContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'cms:distribution:update',
    audit: { description: '更新 CMS 内容分发规则', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsDistributionRule(id));
    const result = await updateCmsDistributionRule(id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '分发规则已更新'), 200);
  },
});

const runRoute = defineContractRoute(cmsDistributionContract.run, {
  middleware: [
    authMiddleware,
    guard({
      permission: 'cms:distribution:run',
      audit: { description: '执行 CMS 内容分发', module: 'CMS内容管理' },
    }),
    idempotencyGuard({ ttlSeconds: 30 }),
  ],
  handler: async (c) => c.json(okBody(
    await submitCmsDistributionRun(c.req.valid('param').id),
    '分发任务已提交',
  ), 200),
});

const deleteRoute = defineContractRoute(cmsDistributionContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'cms:distribution:delete',
    audit: { description: '删除 CMS 内容分发规则', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsDistributionRule(id));
    await deleteCmsDistributionRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  runsRoute,
  runDetailRoute,
  createRouteDef,
  runRoute,
  getRoute,
  updateRoute,
  deleteRoute,
] as const);

export default router;
