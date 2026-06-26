import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
} from '../lib/openapi-schemas';
import { getListeningPorts } from '../services/ports.service';
import { getProcessDetail, killProcess } from '../services/processes.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const PortEntryDTO = z.object({
  protocol: z.string(),
  localAddress: z.string(),
  localPort: z.number().int(),
  state: z.string(),
  pid: z.number().int().nullable(),
  processName: z.string().nullable(),
  serviceName: z.string().nullable(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Ports'], summary: '获取监听端口列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:process:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(PortEntryDTO.array(), '端口列表') },
  }),
  handler: async (c) => {
    const ports = await getListeningPorts();
    return c.json(okBody(ports), 200);
  },
});

const killRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{pid}', tags: ['Ports'], summary: '结束占用端口的进程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:process:kill', audit: { description: '结束端口占用进程', module: '系统运维' } })] as const,
    request: { params: z.object({ pid: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...okMsg('进程已结束') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const [ports, process] = await Promise.all([
      getListeningPorts(),
      getProcessDetail(pid),
    ]);
    setAuditBeforeData(c, {
      process,
      ports: ports.filter((item) => item.pid === pid),
    });
    await killProcess(pid, 'SIGTERM');
    setAuditAfterData(c, { pid, signal: 'SIGTERM', killed: true });
    return c.json(okBody(null, '进程已结束'), 200);
  },
});

router.openapiRoutes([listRoute, killRoute] as const);

export default router;
