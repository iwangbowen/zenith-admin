/**
 * 业务关联上下文与因果父引用的 AsyncLocalStorage 载体。
 *
 * 独立成零依赖模块：logger（pino mixin）与 context（业务侧 API）都要读它，
 * 而 context → db → logger 存在导入链，放在 context.ts 里会成环。
 * OTel 的 trace_id/span_id 属于另一条上下文链，永远不写入这里。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const correlationIdStore = new AsyncLocalStorage<string>();

/**
 * 当前业务关联 ID。HTTP 请求从 Hono requestId（即 X-Request-Id）初始化，
 * worker / 定时任务从持久化的业务关联字段恢复；脱离作用域时返回 undefined。
 * 所有异步副作用都通过它继承同一条业务链路。
 */
export function currentCorrelationId(): string | undefined {
  return correlationIdStore.getStore();
}

/** 在业务关联 ID 作用域内执行 fn；作用域内新产生的异步副作用继承该 ID。 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(correlationIdStore.run(correlationId, fn));
}

// ─── 因果父引用（时间线树形展示：谁触发了谁）─────────────────────────────────
// 取值格式 `kind:refId`（如 job:601 / task:88）或裸 `request`（请求内产生，请求节点唯一无需 id）
const parentRefStore = new AsyncLocalStorage<string>();

/** 当前执行体的节点标识；异步记录写入时读取为 parent_ref。脱离作用域返回 undefined。 */
export function currentParentRef(): string | undefined {
  return parentRefStore.getStore();
}

/** 在给定父引用作用域内执行 fn：其内部产生的作业/通知/任务记录该父节点为触发源。 */
export function runWithParentRef<T>(parentRef: string, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(parentRefStore.run(parentRef, fn));
}
