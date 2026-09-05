import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { monitorContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMonitorStatus, getMonitorTimeseries, getWsMetrics } from '../../services/platform/monitor.service';
import { getMonitorHistory } from '../../services/platform/monitor-history.service';
import { metricsSampler } from '../../lib/metrics-sampler';

const monitorRouter = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:monitor:view' })] as const;

const statusRoute = defineContractRoute(monitorContract.snapshot, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getMonitorStatus(), 'success'), 200),
});

const timeseriesRoute = defineContractRoute(monitorContract.timeseries, {
  middleware: view,
  handler: (c) => c.json(okBody(getMonitorTimeseries(), 'success'), 200),
});

const historyRoute = defineContractRoute(monitorContract.history, {
  middleware: view,
  handler: async (c) => {
    const { range } = c.req.valid('query');
    return c.json(okBody(await getMonitorHistory(range), 'success'), 200);
  },
});

const wsRoute = defineContractRoute(monitorContract.ws, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getWsMetrics(), 'success'), 200),
});

/**
 * 计算两个 JSON 对象的浅 diff（递归对象、数组按引用整段替换）
 * - 新增/变更字段 → 写入 patch
 * - 字段被删除 → 写入 null（约定：客户端见 null 即删除该键）
 * 数组使用 JSON 序列化对比并整段替换，因为对监控指标而言数组通常较短
 * 且元素无稳定 id，逐元素 diff 收益不大。
 */
function diff(prev: unknown, cur: unknown): unknown {
  if (prev === cur) return undefined;
  if (prev === null || cur === null || typeof prev !== 'object' || typeof cur !== 'object') {
    return cur;
  }
  if (Array.isArray(prev) || Array.isArray(cur)) {
    return JSON.stringify(prev) === JSON.stringify(cur) ? undefined : cur;
  }
  const out: Record<string, unknown> = {};
  const prevObj = prev as Record<string, unknown>;
  const curObj = cur as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(curObj)) {
    if (!(key in prevObj)) {
      out[key] = curObj[key];
      changed = true;
      continue;
    }
    const sub = diff(prevObj[key], curObj[key]);
    if (sub !== undefined) {
      out[key] = sub;
      changed = true;
    }
  }
  for (const key of Object.keys(prevObj)) {
    if (!(key in curObj)) {
      out[key] = null;
      changed = true;
    }
  }
  return changed ? out : undefined;
}

/**
 * SSE 实时推送监控指标。
 * 首帧推送完整快照（metrics）+ 全量时序（series）+ WS 指标（ws）；
 * 后续每个采样 tick 推送差量 patch（metrics:diff）、最新时序点（series:point）
 * 与 WS 指标全量（ws，体量小无需 diff），客户端深合并/追加到本地状态。
 */
const streamRoute = defineContractRoute(monitorContract.stream, {
  middleware: view,
  handler: (c) => streamSSE(c, async (stream) => {
    let lastSnapshot: Awaited<ReturnType<typeof getMonitorStatus>> | null = null;

    // 首帧：完整 snapshot + 全量时序 + WS 指标
    try {
      const [initial, ws] = await Promise.all([getMonitorStatus(), getWsMetrics()]);
      lastSnapshot = initial;
      await stream.writeSSE({ data: JSON.stringify(initial), event: 'metrics' });
      await stream.writeSSE({ data: JSON.stringify(getMonitorTimeseries()), event: 'series' });
      await stream.writeSSE({ data: JSON.stringify(ws), event: 'ws' });
    } catch {
      // ignore
    }

    let pending = false;
    const unsubscribe = metricsSampler.subscribe(async (sample) => {
      if (pending) return;
      pending = true;
      try {
        const [cur, ws] = await Promise.all([getMonitorStatus(), getWsMetrics()]);
        if (lastSnapshot) {
          const patch = diff(lastSnapshot, cur);
          if (patch !== undefined) {
            await stream.writeSSE({ data: JSON.stringify(patch), event: 'metrics:diff' });
          }
        } else {
          await stream.writeSSE({ data: JSON.stringify(cur), event: 'metrics' });
        }
        lastSnapshot = cur;
        await stream.writeSSE({ data: JSON.stringify(sample), event: 'series:point' });
        await stream.writeSSE({ data: JSON.stringify(ws), event: 'ws' });
      } catch {
        // ignore
      } finally {
        pending = false;
      }
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => undefined);
    }, 30_000);

    const cleanup = () => {
      unsubscribe();
      clearInterval(heartbeat);
    };

    c.req.raw.signal.addEventListener('abort', cleanup);

    await new Promise<void>((resolve) => {
      if (c.req.raw.signal.aborted) {
        cleanup();
        resolve();
        return;
      }
      c.req.raw.signal.addEventListener('abort', () => {
        cleanup();
        resolve();
      });
    });
  }),
});

monitorRouter.openapiRoutes([statusRoute, timeseriesRoute, historyRoute, wsRoute, streamRoute] as const);

export default monitorRouter;
