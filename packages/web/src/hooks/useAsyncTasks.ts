import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WsMessage } from '@zenith/shared/platform';
import { asyncTaskContract, type AsyncTask } from '@zenith/shared/tasks';
import { api } from '@/lib/contract-query';
import { useWebSocket } from '@/hooks/useWebSocket';

const ACTIVE_STATUSES = new Set<AsyncTask['status']>(['pending', 'running']);
/** 轮询兜底间隔（毫秒）：WS 正常时进度已实时推送，轮询只兜底断线与 Demo 模式 */
const POLL_INTERVAL_MS = 3000;

export interface UseMyAsyncTasksOptions {
  /** 只关注这些任务类型（不传 = 全部） */
  taskTypes?: string[];
  pageSize?: number;
}

/**
 * 「我的异步任务」由当前会话重新读取，WS 提示变更，轮询兜底。
 * 存在进行中任务时每 3s 轮询一次；全部结束后停止轮询，仅靠 WS/手动刷新。
 */
export function useMyAsyncTasks(options: UseMyAsyncTasksOptions = {}) {
  const { pageSize = 20 } = options;
  const taskTypesKey = options.taskTypes?.join(',') ?? '';
  const queryClient = useQueryClient();
  const [manualLoading, setManualLoading] = useState(false);
  const queryKey = useMemo(() => ['async-tasks', 'mine', { pageSize, taskTypes: taskTypesKey }] as const, [pageSize, taskTypesKey]);

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api(asyncTaskContract.mine, {
        query: { page: 1, pageSize, taskTypes: options.taskTypes?.length ? options.taskTypes : undefined },
      }, { silent: true });
      return data.list;
    },
    refetchInterval: (query) =>
      (query.state.data ?? []).some((t) => ACTIVE_STATUSES.has(t.status)) ? POLL_INTERVAL_MS : false,
  });
  const tasks = tasksQuery.data ?? [];
  const { refetch, isLoading } = tasksQuery;

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setManualLoading(true);
    try {
      await refetch();
    } finally {
      if (!opts?.silent) setManualLoading(false);
    }
  }, [refetch]);

  useWebSocket(
    useCallback((message: WsMessage) => {
      if (message.type !== 'task:changed') return;
      void queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });
    }, [queryClient, queryKey]),
  );

  // 轮询兜底：仅当存在进行中任务时轮询（Demo 模式无 WS，全靠这里驱动进度）
  const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));

  return { tasks, loading: isLoading || manualLoading, refresh, hasActive };
}

/** 订阅任务变更，调用方经当前会话的查询重新读取任务。 */
export function useTaskProgressEvents(onChange: (stateChanged: boolean) => void) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;
  useWebSocket(
    useCallback((message: WsMessage) => {
      if (message.type === 'task:changed') handlerRef.current(message.payload.stateChanged);
    }, []),
  );
}
