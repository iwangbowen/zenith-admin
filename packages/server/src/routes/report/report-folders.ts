import { OpenAPIHono } from '@hono/zod-openapi';
import { reportFolderContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  createReportFolder,
  deleteReportFolder,
  getReportFolder,
  listReportFolderTree,
  moveReportFolder,
  updateReportFolder,
} from '../../services/report/report-folder.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const treeRoute = defineContractRoute(reportFolderContract.tree, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:list' })],
  handler: async (c) => c.json(okBody(await listReportFolderTree(c.req.valid('query').resourceType)), 200),
});

const getRoute = defineContractRoute(reportFolderContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:list' })],
  handler: async (c) => c.json(okBody(await getReportFolder(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportFolderContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:create', audit: { module: '报表资源治理', description: '创建报表资源目录' } })],
  handler: async (c) => c.json(okBody(await createReportFolder(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportFolderContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:update', audit: { module: '报表资源治理', description: '更新报表资源目录' } })],
  handler: async (c) => c.json(okBody(await updateReportFolder(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const moveRoute = defineContractRoute(reportFolderContract.move, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:update', audit: { module: '报表资源治理', description: '移动报表资源目录' } })],
  handler: async (c) => c.json(okBody(await moveReportFolder(c.req.valid('param').id, c.req.valid('json')), '移动成功'), 200),
});

const deleteRoute_ = defineContractRoute(reportFolderContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:folder:delete', audit: { module: '报表资源治理', description: '删除报表资源目录' } })],
  handler: async (c) => {
    await deleteReportFolder(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([treeRoute, getRoute, createRoute_, updateRoute_, moveRoute, deleteRoute_] as const);

export default router;
