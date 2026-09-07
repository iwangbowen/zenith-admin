import { OpenAPIHono } from '@hono/zod-openapi';
import { driveAccessRequestContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  cancelDriveAccessRequest,
  countPendingDriveAccessRequests,
  createDriveAccessRequest,
  decideDriveAccessRequest,
  getDriveAccessTarget,
  listDriveAccessRequests,
} from '../../services/drive/drive-access-requests.service';

/**
 * 访问申请：申请人只需网盘查询权限；审批由节点 ACL（manager）决定，授权动作复用 drive:node:grant 审计。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;
const read = [authMiddleware, guard({ permission: 'drive:node:list' })] as const;

const listRoute = defineContractRoute(driveAccessRequestContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDriveAccessRequests(c.req.valid('query'))), 200),
});

const pendingCountRoute = defineContractRoute(driveAccessRequestContract.pendingCount, {
  middleware: read,
  handler: async (c) => c.json(okBody(await countPendingDriveAccessRequests()), 200),
});

const targetRoute = defineContractRoute(driveAccessRequestContract.target, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDriveAccessTarget(c.req.valid('param').id)), 200),
});

const createRoute = defineContractRoute(driveAccessRequestContract.create, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:list', audit: { description: '申请访问网盘文件', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await createDriveAccessRequest(c.req.valid('json')), '申请已提交'), 200),
});

const decideRoute = defineContractRoute(driveAccessRequestContract.decide, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:grant', audit: { description: '审批网盘访问申请', ...AUDIT } })],
  handler: async (c) => {
    const result = await decideDriveAccessRequest(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(result, result.status === 'approved' ? '已通过' : '已拒绝'), 200);
  },
});

const cancelRoute = defineContractRoute(driveAccessRequestContract.cancel, {
  middleware: read,
  handler: async (c) => c.json(okBody(await cancelDriveAccessRequest(c.req.valid('param').id), '已撤回'), 200),
});

router.openapiRoutes([listRoute, pendingCountRoute, targetRoute, createRoute, decideRoute, cancelRoute] as const);

export default router;
