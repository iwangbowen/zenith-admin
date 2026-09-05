import { OpenAPIHono } from '@hono/zod-openapi';
import { opsHostContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { assertPlatformHostAccess } from '../../lib/host-access';
import {
  createOpsHost,
  deleteOpsHost,
  getOpsHost,
  getOpsHostBeforeAudit,
  importOpsHostFromSshProfile,
  listOpsHosts,
  probeAllOpsHosts,
  probeOpsHost,
  resetOpsHostKey,
  testOpsHostConnection,
  updateOpsHost,
} from '../../services/ops/hosts.service';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const VIEW_PERM = 'system:host:view';
const MANAGE_PERM = 'system:host:manage';

/** 主机清单对「使用远端主机」的功能页也可见（下拉选择），满足其一即可 */
const view = [authMiddleware, guard({ permission: [VIEW_PERM, 'system:host:use'] })] as const;

const listRoute = defineContractRoute(opsHostContract.list, {
  middleware: view,
  handler: async (c) => {
    assertPlatformHostAccess(c);
    return c.json(okBody(await listOpsHosts()), 200);
  },
});

const detailRoute = defineContractRoute(opsHostContract.detail, {
  middleware: view,
  handler: async (c) => {
    assertPlatformHostAccess(c);
    return c.json(okBody(await getOpsHost(c.req.valid('param').id)), 200);
  },
});

const createRouteDef = defineContractRoute(opsHostContract.create, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    // 凭据不进审计日志
    audit: { description: '新增运维主机', module: '主机管理', recordBody: false },
  })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    return c.json(okBody(await createOpsHost(c.req.valid('json')), '已创建'), 200);
  },
});

const updateRouteDef = defineContractRoute(opsHostContract.update, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    audit: { description: '更新运维主机', module: '主机管理', recordBody: false },
  })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpsHostBeforeAudit(id));
    return c.json(okBody(await updateOpsHost(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRouteDef = defineContractRoute(opsHostContract.remove, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    audit: { description: '删除运维主机', module: '主机管理' },
  })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpsHostBeforeAudit(id));
    await deleteOpsHost(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const testRoute = defineContractRoute(opsHostContract.test, {
  middleware: [authMiddleware, guard({ permission: MANAGE_PERM })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    return c.json(okBody(await testOpsHostConnection(c.req.valid('param').id)), 200);
  },
});

const probeRoute = defineContractRoute(opsHostContract.probe, {
  middleware: [authMiddleware, guard({ permission: VIEW_PERM })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    return c.json(okBody(await probeOpsHost(c.req.valid('param').id)), 200);
  },
});

const probeAllRoute = defineContractRoute(opsHostContract.probeAll, {
  middleware: [authMiddleware, guard({ permission: VIEW_PERM })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    await probeAllOpsHosts();
    return c.json(okBody(await listOpsHosts()), 200);
  },
});

const resetKeyRoute = defineContractRoute(opsHostContract.resetHostKey, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    audit: { description: '重置主机指纹', module: '主机管理' },
  })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpsHostBeforeAudit(id));
    await resetOpsHostKey(id);
    return c.json(okBody(null, '已重置,下次连接将重新记录指纹'), 200);
  },
});

const importSshProfileRoute = defineContractRoute(opsHostContract.importSshProfile, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    audit: { description: '从 SSH 配置导入运维主机', module: '主机管理', recordBody: false },
  })],
  handler: async (c) => {
    assertPlatformHostAccess(c);
    const host = await importOpsHostFromSshProfile(c.req.valid('param').profileId, currentUser().userId);
    return c.json(okBody(host, '已导入'), 200);
  },
});

// probe-all / import-ssh-profile 是静态路径，必须先于 /{id} 系列注册
router.openapiRoutes([
  listRoute,
  probeAllRoute,
  importSshProfileRoute,
  detailRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
  testRoute,
  probeRoute,
  resetKeyRoute,
] as const);

export default router;
