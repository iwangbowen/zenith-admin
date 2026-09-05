import { OpenAPIHono } from '@hono/zod-openapi';
import { portContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getListeningPorts } from '../../services/ops/ports.service';
import { getProcessDetail, killProcess } from '../../services/ops/processes.service';
import { assertRemoteHostAccess } from '../../lib/host-access';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(portContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:port:view' })],
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const ports = await getListeningPorts(hostId);
    return c.json(okBody(ports), 200);
  },
});

const killRoute = defineContractRoute(portContract.kill, {
  middleware: [authMiddleware, guard({ permission: 'system:process:kill', audit: { description: '结束端口占用进程', module: '系统运维' } })],
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const [ports, process] = await Promise.all([
      getListeningPorts(hostId),
      getProcessDetail(pid, hostId),
    ]);
    setAuditBeforeData(c, {
      process,
      ports: ports.filter((item) => item.pid === pid),
    });
    await killProcess(pid, 'SIGTERM', hostId);
    setAuditAfterData(c, { pid, signal: 'SIGTERM', hostId: hostId ?? null, killed: true });
    return c.json(okBody(null, '进程已结束'), 200);
  },
});

router.openapiRoutes([listRoute, killRoute] as const);

export default router;
