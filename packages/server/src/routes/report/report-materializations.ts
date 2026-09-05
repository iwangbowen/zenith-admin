import { OpenAPIHono } from '@hono/zod-openapi';
import { reportMaterializationContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { submitDatasetMaterializeTask } from '../../services/report/report-dataset-tasks';
import {
  getCurrentMaterializationSnapshot,
  listMaterializationSnapshots,
  purgeDatasetMaterializationSnapshots,
  purgeMaterializationSnapshot,
} from '../../services/report/report-materialization.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportMaterializationContract.snapshots, {
  middleware: [authMiddleware, guard({ permission: 'report:materialization:list' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listMaterializationSnapshots(c.req.valid('param').id, query.page, query.pageSize)), 200);
  },
});

const currentRoute = defineContractRoute(reportMaterializationContract.current, {
  middleware: [authMiddleware, guard({ permission: 'report:materialization:list' })],
  handler: async (c) => c.json(okBody(await getCurrentMaterializationSnapshot(c.req.valid('param').id)), 200),
});

const refreshRoute = defineContractRoute(reportMaterializationContract.refresh, {
  middleware: [authMiddleware, guard({ permission: 'report:materialization:refresh', audit: { module: '报表物化', description: '刷新物化快照' } })],
  handler: async (c) => c.json(okBody(
    await submitDatasetMaterializeTask(c.req.valid('param').id, c.req.valid('json')),
    '任务已提交',
  ), 200),
});

const purgeRoute = defineContractRoute(reportMaterializationContract.purge, {
  middleware: [authMiddleware, guard({ permission: 'report:materialization:purge', audit: { module: '报表物化', description: '清除物化快照' } })],
  handler: async (c) => {
    await purgeMaterializationSnapshot(c.req.valid('param').id);
    return c.json(okBody(null, '清除成功'), 200);
  },
});

const purgeDatasetRoute = defineContractRoute(reportMaterializationContract.purgeDataset, {
  middleware: [authMiddleware, guard({ permission: 'report:materialization:purge', audit: { module: '报表物化', description: '清除数据集历史快照' } })],
  handler: async (c) => {
    const count = await purgeDatasetMaterializationSnapshots(c.req.valid('param').id);
    return c.json(okBody(null, `已清除 ${count} 个快照`), 200);
  },
});

router.openapiRoutes([listRoute, currentRoute, refreshRoute, purgeRoute, purgeDatasetRoute] as const);

export default router;
