import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { directorySyncContract, directorySyncSourceContract, type DirectorySyncRun } from '@zenith/shared/identity';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery, type PageOf } from '@/lib/contract-query';

// ─── 同步源（标准 CRUD）────────────────────────────────────────────────────────
export const {
  keys: directorySyncSourceKeys,
  useList: useDirectorySyncSourceList,
  useDetail: useDirectorySyncSourceDetail,
  useSave: useSaveDirectorySyncSource,
  useDelete: useDeleteDirectorySyncSources,
} = createResourceQueries(directorySyncSourceContract);

/** 测试连接：只读诊断，无副作用，不失效任何缓存 */
export function useTestDirectorySyncSource() {
  return useApiMutation(directorySyncSourceContract.test);
}

/**
 * 立即同步 / 预览差异：提交任务中心作业。
 * 同步真正落库发生在后台任务完成时，此处仅失效运行记录列表（提交后立刻出现 running 记录）；
 * 源的 lastRunAt/lastRunStatus 由记录页轮询兜底，不在提交时失效源列表。
 */
export function usePreviewDirectorySyncSource() {
  return useApiMutation(directorySyncSourceContract.preview, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: directorySyncRunKeys.lists }),
  });
}

export function useRunDirectorySyncSource() {
  return useApiMutation(directorySyncSourceContract.run, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: directorySyncRunKeys.lists }),
  });
}

// ─── 同步记录（`directorySyncContract` 的 runs 操作，与同步源 CRUD 分属不同契约 / 资源键）───────────
export type DirectorySyncRunListParams = NonNullable<QueryOf<typeof directorySyncContract.listRuns>>;

export type DirectorySyncRunItemListParams = NonNullable<QueryOf<typeof directorySyncContract.listRunItems>>;

export const directorySyncRunKeys = {
  lists: contractKey(directorySyncContract.listRuns),
  list: (params: DirectorySyncRunListParams) => contractKey(directorySyncContract.listRuns, { query: params }),
  detail: (id: number | undefined) => contractKey(directorySyncContract.runDetail, { params: { id: id ?? 0 } }),
  items: (runId: number | undefined, params: DirectorySyncRunItemListParams) =>
    contractKey(directorySyncContract.listRunItems, { params: { id: runId ?? 0 }, query: params }),
};

function hasRunningRun(data: PageOf<DirectorySyncRun> | undefined): boolean {
  return (data?.list ?? []).some((run) => run.status === 'running');
}

export function useDirectorySyncRunList(params: DirectorySyncRunListParams) {
  return useApiQuery(directorySyncContract.listRuns, { query: params }, {
    placeholderData: keepPreviousData,
    // 有进行中的同步时轮询刷新
    refetchInterval: (query) => (hasRunningRun(query.state.data) ? 5000 : false),
  });
}

export function useDirectorySyncRunDetail(id: number | undefined, enabled = true) {
  return useApiQuery(directorySyncContract.runDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useDirectorySyncRunItems(runId: number | undefined, params: DirectorySyncRunItemListParams, enabled = true) {
  return useApiQuery(directorySyncContract.listRunItems, { params: { id: runId ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && runId !== undefined,
  });
}

/** 失败重试：对所属源重新提交同步任务，新 running 记录随后出现在列表 */
export function useRetryDirectorySyncRun() {
  return useApiMutation(directorySyncContract.retryRun, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: directorySyncRunKeys.lists }),
  });
}

// ─── 冲突处理（`directorySyncContract` 的 conflicts 操作）─────────────────────────────────
export type DirectorySyncConflictListParams = NonNullable<QueryOf<typeof directorySyncContract.listConflicts>>;

export const directorySyncConflictKeys = {
  lists: contractKey(directorySyncContract.listConflicts),
  list: (params: DirectorySyncConflictListParams) => contractKey(directorySyncContract.listConflicts, { query: params }),
};

export function useDirectorySyncConflictList(params: DirectorySyncConflictListParams) {
  return useApiQuery(directorySyncContract.listConflicts, { query: params }, { placeholderData: keepPreviousData });
}

/**
 * 裁决冲突：采用源值时会更新用户/绑定，但本页只挂载冲突列表，
 * 用户列表等所有者域查询未挂载时失效代价为零，不额外广播。
 */
export function useResolveDirectorySyncConflict() {
  return useApiMutation(directorySyncContract.resolveConflict, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: directorySyncConflictKeys.lists }),
  });
}

export function useIgnoreDirectorySyncConflicts() {
  return useApiMutation(directorySyncContract.ignoreConflicts, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: directorySyncConflictKeys.lists }),
  });
}
