import type { MiddlewareHandler } from 'hono';
import { runWithTraceId, runWithParentRef } from '../lib/context';
import { currentOtelTraceId } from '../lib/telemetry-context';

/**
 * 为每个请求建立链路关联 traceId（贯穿其触发的全部作业/事件/通知/任务 fan-out）。
 *
 * traceId 与 hono requestId 是**同一枚值**：`requestId()` 中间件已处理 `X-Request-Id`
 * 透传（一次前端操作的多个请求可共链）、UUID 生成与响应头回写；这里只负责把它装进
 * AsyncLocalStorage，使下游 `enqueueJob` / 事件 outbox / `submitAsyncTask` /
 * pino 日志（mixin 注入 reqId 字段）自动继承。
 *
 * 同时建立因果父引用 `request`：请求内直接产生的作业/通知/任务挂在请求节点下
 * （一条链路只有一个请求节点，无需携带 id）。
 *
 * 必须挂在 `requestId()` 之后。
 */
export const requestTraceMiddleware: MiddlewareHandler = async (c, next) => {
  // OTel's HTTP span is installed before this middleware by app-core. When it is
  // active, persist the real W3C trace id into downstream business records; when
  // tracing is disabled, retain the request-id fallback for local diagnostics.
  await runWithTraceId(currentOtelTraceId() ?? c.get('requestId'), () => runWithParentRef('request', () => next()));
};
