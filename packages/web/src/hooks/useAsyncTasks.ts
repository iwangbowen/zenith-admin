import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsyncTask, PaginatedResponse, WsMessage } from '@zenith/shared';
import { request } from '@/utils/request';
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
 * 「我的异步任务」实时列表：WS 推送（task:progress）即时更新 + 轮询兜底。
 * 存在进行中任务时每 3s 轮询一次；全部结束后停止轮询，仅靠 WS/手动刷新。
 */
export function useMyAsyncTasks(options: UseMyAsyncTasksOptions = {}) {
  const { pageSize = 20 } = options;
  const taskTypesKey = options.taskTypes?.join(',') ?? '';
  const taskTypes = useMemo(
    () => (taskTypesKey ? new Set(taskTypesKey.split(',')) : null),
    [taskTypesKey],
  );
  const [tasks, setTasks] = useState<AsyncTask[]>([]);
  const [loading, setLoading] = useState(false);
  const taskTypesRef = useRef(taskTypes);
  taskTypesRef.current = taskTypes;

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<AsyncTask>>(
        `/api/async-tasks/mine?page=1&pageSize=${pageSize}`,
        { silent: true },
      );
      if (res.code === 0) {
        const filter = taskTypesRef.current;
        setTasks(filter ? res.data.list.filter((t) => filter.has(t.taskType)) : res.data.list);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WS 实时推送：合并单条任务更新（新任务插入头部）
  useWebSocket(
    useCallback((message: WsMessage) => {
      if (message.type !== 'task:progress') return;
      const task = message.payload;
      const filter = taskTypesRef.current;
      if (filter && !filter.has(task.taskType)) return;
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id);
        if (idx === -1) return [task, ...prev];
        const next = [...prev];
        next[idx] = task;
        return next;
      });
    }, []),
  );

  // 轮询兜底：仅当存在进行中任务时轮询（Demo 模式无 WS，全靠这里驱动进度）
  const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActive, refresh]);

  return { tasks, loading, refresh, hasActive };
}

/** 订阅任务进度 WS 事件（页面级自定义处理，如任务中心列表合并更新） */
export function useTaskProgressEvents(onTask: (task: AsyncTask) => void) {
  const handlerRef = useRef(onTask);
  handlerRef.current = onTask;
  useWebSocket(
    useCallback((message: WsMessage) => {
      if (message.type === 'task:progress') handlerRef.current(message.payload);
    }, []),
  );
}
