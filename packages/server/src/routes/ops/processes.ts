import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { processContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { assertRemoteHostAccess } from '../../lib/host-access';
import {
  listProcesses, getProcessDetail, killProcess, setProcessPriority,
} from '../../services/ops/processes.service';

const processesRouter = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:process:view' })] as const;

const listRoute = defineContractRoute(processContract.list, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await listProcesses(hostId)), 200);
  },
});

// SSE 实时推送：首帧完整列表，之后每 3 秒一帧；心跳保活 30 秒
const streamRoute = defineContractRoute(processContract.stream, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return streamSSE(c, async (stream) => {
      // 立即发送 ping 以确保 HTTP 响应头（200 + text/event-stream）即刻送达客户端
      // （@hono/node-server 在第一次写入时才真正刷新响应头）
      await stream.writeSSE({ data: '', event: 'ping' });

      try {
        const data = await listProcesses(hostId);
        await stream.writeSSE({ data: JSON.stringify(data), event: 'processes' });
      } catch { /* ignore */ }

      let pending = false;
      const interval = setInterval(async () => {
        if (pending) return;
        pending = true;
        try {
          const data = await listProcesses(hostId);
          await stream.writeSSE({ data: JSON.stringify(data), event: 'processes' });
        } catch { /* ignore */ } finally {
          pending = false;
        }
      }, 3000);

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
    });
  },
});

const detailRoute = defineContractRoute(processContract.detail, {
  middleware: view,
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await getProcessDetail(pid, hostId)), 200);
  },
});

const killRoute = defineContractRoute(processContract.kill, {
  middleware: [authMiddleware, guard({
    permission: 'system:process:kill',
    audit: { description: '结束进程', module: '进程管理' },
  })],
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    const { signal } = c.req.valid('json');
    await assertRemoteHostAccess(c, hostId);
    setAuditBeforeData(c, await getProcessDetail(pid, hostId));
    await killProcess(pid, signal, hostId);
    setAuditAfterData(c, { pid, signal, hostId: hostId ?? null, killed: true });
    return c.json(okBody(null, '已发送结束信号'), 200);
  },
});

const priorityRoute = defineContractRoute(processContract.setPriority, {
  middleware: [authMiddleware, guard({
    permission: 'system:process:priority',
    audit: { description: '调整进程优先级', module: '进程管理' },
  })],
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    const input = c.req.valid('json');
    setAuditBeforeData(c, await getProcessDetail(pid, hostId));
    await setProcessPriority(pid, input, hostId);
    setAuditAfterData(c, await getProcessDetail(pid, hostId));
    return c.json(okBody(null, '优先级已调整'), 200);
  },
});

// 静态 /stream 必须先于动态 /{pid} 注册
processesRouter.openapiRoutes([listRoute, streamRoute, detailRoute, killRoute, priorityRoute] as const);

export default processesRouter;
