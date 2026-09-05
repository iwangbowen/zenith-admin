import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { systemdContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  isSystemdAvailable, listServices, controlService, getServiceLogs, tailServiceLogs, getServiceDetail,
} from '../../services/ops/systemd.service';
import { assertRemoteHostAccess } from '../../lib/host-access';
import { streamProcessOutput } from '../../lib/http-stream';

const router = new OpenAPIHono({ defaultHook: validationHook });
const VIEW_PERM = 'system:service:view';
const MANAGE_PERM = 'system:service:manage';

const view = [authMiddleware, guard({ permission: VIEW_PERM })] as const;

/** 验证服务名：只允许合法字符，防止命令注入 */
function validateServiceName(name: string): void {
  if (!/^[a-zA-Z0-9_@.-]{1,128}$/.test(name)) throw new HTTPException(400, { message: '非法服务名称' });
}

// 实时日志：journalctl -f 逐行流式输出
const logsStreamRoute = defineContractRoute(systemdContract.logsStream, {
  middleware: view,
  handler: async (c) => {
    const { name } = c.req.valid('param');
    validateServiceName(name);
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return streamProcessOutput(c, (onData, onExit) => tailServiceLogs(name, onData, onExit, hostId));
  },
});

const checkRoute = defineContractRoute(systemdContract.check, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const available = await isSystemdAvailable(hostId);
    return c.json(okBody({ available }), 200);
  },
});

const listRoute = defineContractRoute(systemdContract.list, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const services = await listServices(hostId);
    return c.json(okBody(services), 200);
  },
});

const controlRoute = defineContractRoute(systemdContract.control, {
  middleware: [authMiddleware, guard({
    permission: MANAGE_PERM,
    audit: { description: '控制 systemd 服务', module: '服务管理' },
  })],
  handler: async (c) => {
    const { name, action } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    validateServiceName(name);
    setAuditBeforeData(c, { name, hostId: hostId ?? null, detail: await getServiceDetail(name, hostId) });
    await controlService(name, action, hostId);
    return c.json(okBody(null, '操作成功'), 200);
  },
});

const detailRoute = defineContractRoute(systemdContract.detail, {
  middleware: view,
  handler: async (c) => {
    const { name } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    validateServiceName(name);
    const detail = await getServiceDetail(name, hostId);
    return c.json(okBody(detail), 200);
  },
});

const logsRoute = defineContractRoute(systemdContract.logs, {
  middleware: view,
  handler: async (c) => {
    const { name } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    validateServiceName(name);
    const logs = await getServiceLogs(name, 200, hostId);
    return c.json(okBody({ logs }), 200);
  },
});

router.openapiRoutes([logsStreamRoute, checkRoute, listRoute, controlRoute, detailRoute, logsRoute] as const);

export default router;
