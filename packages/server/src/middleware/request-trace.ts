import type { MiddlewareHandler } from 'hono';
import { runWithCorrelationId, runWithParentRef } from '../lib/context';

/**
 * 为每个请求建立业务关联 ID（贯穿其触发的全部作业/事件/通知/任务 fan-out）。
 *
 * `requestId()` 已处理 `X-Request-Id` 透传、UUID 生成与响应头回写；这里把同一枚
 * request ID 放进业务 AsyncLocalStorage。OTel 的 `trace_id` 属于独立的分布式追踪
 * 上下文，不能写入业务关联字段。
 *
 * 同时建立因果父引用 `request`：请求内直接产生的作业/通知/任务挂在请求节点下。
 * 必须挂在 `requestId()` 之后。
 */
export const requestTraceMiddleware: MiddlewareHandler = async (c, next) => {
  await runWithCorrelationId(c.get('requestId'), () => runWithParentRef('request', () => next()));
};
