import type { QueryClient } from '@tanstack/react-query';
import type { WsMessage } from '@zenith/shared/platform';
import { Throttler } from '@tanstack/react-pacer';

/** Feature metadata lets domain mutations invalidate summaries without importing relation UI or schemas. */
export const ENTITY_RELATION_QUERY_META = { entityRelations: true } as const;

/** 无可靠投递推送的外部变更由可见、已激活查询校准；隐藏 Activity 自动注销查询订阅。 */
export const ENTITY_RELATION_REFRESH_OPTIONS = {
  staleTime: 15_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

/** A new relation can affect an unseen reverse view; mark every summary stale and refetch active groups. */
export function invalidateEntityRelations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => query.meta?.entityRelations === true });
}

/** 单个后台壳层订阅；合并事件突发，仅任务状态/标题变化影响关系摘要，进度计数不触发回源。 */
export function createEntityRelationEventHandler(queryClient: QueryClient) {
  const taskStates = new Map<number, string>();
  const refresh = new Throttler(() => { void invalidateEntityRelations(queryClient); }, { wait: 200, leading: false, trailing: true });
  const schedule = () => refresh.maybeExecute();
  return {
    onMessage(message: WsMessage) {
      if (message.type === 'task:progress') {
        const task = message.payload;
        const fingerprint = `${task.status}\0${task.title}`;
        if (taskStates.get(task.id) === fingerprint) return;
        taskStates.delete(task.id);
        taskStates.set(task.id, fingerprint);
        if (taskStates.size > 200) taskStates.delete(taskStates.keys().next().value!);
        schedule();
      } else if (message.type === 'workflow:taskCreated' || message.type === 'workflow:taskFinished'
        || message.type === 'workflow:instanceFinished' || message.type === 'in-app-message:new'
        || message.type === 'payment:success' || message.type === 'payment:closed' || message.type === 'payment:failed'
        || message.type === 'payment:refunded' || message.type === 'payment:refund-failed' || message.type === 'iot:device-event') {
        schedule();
      }
    },
    reconnect: schedule,
    dispose() { refresh.cancel(); taskStates.clear(); },
  };
}
