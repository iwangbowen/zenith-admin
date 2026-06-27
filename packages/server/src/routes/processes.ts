import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import {
  validationHook, commonErrorResponses, ok, okMsg,
  jsonContent, okBody,
} from '../lib/openapi-schemas';
import { ProcessInfoDTO, ProcessListResponseDTO } from '../lib/openapi-dtos';
import {
  listProcesses, getProcessDetail, killProcess, setProcessPriority,
} from '../services/processes.service';
import { killProcessSchema, setProcessPrioritySchema } from '@zenith/shared';

const processesRouter = new OpenAPIHono({ defaultHook: validationHook });

/** pid 路径参数 */
const PidParam = z.object({
  pid: z.coerce.number().int().positive().openapi({
    param: { name: 'pid', in: 'path' },
    example: 1234,
    description: '进程 ID',
  }),
});

// ─── GET / — 进程列表 ─────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['进程管理'], summary: '获取进程列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:process:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(ProcessListResponseDTO, '进程列表') },
  }),
  handler: async (c) => c.json(okBody(await listProcesses()), 200),
});

// ─── GET /:pid — 进程详情 ─────────────────────────────────────────────────
const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:pid',
    tags: ['进程管理'], summary: '获取进程详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:process:view' })] as const,
    request: { params: PidParam },
    responses: { ...commonErrorResponses, ...ok(ProcessInfoDTO, '进程详情') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody(await getProcessDetail(pid)), 200);
  },
});

// ─── DELETE /:pid — 结束进程 ──────────────────────────────────────────────
const killRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/:pid',
    tags: ['进程管理'], summary: '结束进程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:process:kill',
      audit: { description: '结束进程', module: '进程管理' },
    })] as const,
    request: {
      params: PidParam,
      body: { content: jsonContent(killProcessSchema), required: false },
    },
    responses: { ...commonErrorResponses, ...okMsg('已发送结束信号') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    let signal = 'SIGTERM';
    try {
      const body = await c.req.json<{ signal?: string }>();
      if (body?.signal) signal = body.signal;
    } catch { /* body is optional */ }
    setAuditBeforeData(c, await getProcessDetail(pid));
    await killProcess(pid, signal);
    setAuditAfterData(c, { pid, signal, killed: true });
    return c.json(okBody(null, '已发送结束信号'), 200);
  },
});

// ─── PUT /:pid/priority — 调整优先级 ──────────────────────────────────────
const priorityRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/:pid/priority',
    tags: ['进程管理'], summary: '调整进程优先级',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:process:priority',
      audit: { description: '调整进程优先级', module: '进程管理' },
    })] as const,
    request: {
      params: PidParam,
      body: { content: jsonContent(setProcessPrioritySchema), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('优先级已调整') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const input = c.req.valid('json');
    setAuditBeforeData(c, await getProcessDetail(pid));
    await setProcessPriority(pid, input);
    setAuditAfterData(c, await getProcessDetail(pid));
    return c.json(okBody(null, '优先级已调整'), 200);
  },
});

// ─── SSE 实时推送（必须在 openapiRoutes 之前注册，避免被 /:pid 动态路由拦截）───
processesRouter.get(
  '/stream',
  authMiddleware,
  guard({ permission: 'system:process:view' }),
  (c) =>
    streamSSE(c, async (stream) => {
      // 立即发送 ping 以确保 HTTP 响应头（200 + text/event-stream）即刻送达客户端
      // （@hono/node-server 在第一次写入时才真正刷新响应头）
      await stream.writeSSE({ data: '', event: 'ping' });

      // 首帧：推送完整列表
      try {
        const data = await listProcesses();
        await stream.writeSSE({ data: JSON.stringify(data), event: 'processes' });
      } catch { /* ignore */ }

      // 每 3 秒推送最新列表
      let pending = false;
      const interval = setInterval(async () => {
        if (pending) return;
        pending = true;
        try {
          const data = await listProcesses();
          await stream.writeSSE({ data: JSON.stringify(data), event: 'processes' });
        } catch { /* ignore */ } finally {
          pending = false;
        }
      }, 3000);

      // 心跳保活（30s）
      const heartbeat = setInterval(() => {
        stream.writeSSE({ data: '', event: 'ping' }).catch(() => undefined);
      }, 30_000);

      const cleanup = () => {
        clearInterval(interval);
        clearInterval(heartbeat);
      };

      c.req.raw.signal.addEventListener('abort', cleanup);

      await new Promise<void>((resolve) => {
        if (c.req.raw.signal.aborted) { cleanup(); resolve(); return; }
        c.req.raw.signal.addEventListener('abort', () => { cleanup(); resolve(); });
      });
    }),
);

// ─── 注册 OpenAPI 路由（/stream 已单独注册）──────────────────────────────────
processesRouter.openapiRoutes([listRoute, detailRoute, killRoute, priorityRoute] as const);

export default processesRouter;
