// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, InputOf, QueryOf } from '@zenith/shared/core';
import { exportJobContract, type ExportJob } from '@zenith/shared/tasks';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ExportJobListParams = NonNullable<QueryOf<typeof exportJobContract.list>>;

export const exportJobKeys = {
  entities: contractKey(exportJobContract.entities),
  lists: contractKey(exportJobContract.list),
  list: (params: ExportJobListParams) => contractKey(exportJobContract.list, { query: params }),
  downloads: (id: number) => contractKey(exportJobContract.downloads, { params: { id } }),
};

export function useExportEntities() {
  return useApiQuery(exportJobContract.entities, { requestOptions: { silent: true } });
}

export function useExportJobList(params: ExportJobListParams) {
  return useApiQuery(exportJobContract.list, { query: params }, {
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.list.some((item) => item.status === 'pending' || item.status === 'running') ? 5000 : false;
    },
  });
}

export function useExportJobDownloads(id: number | undefined, enabled = true) {
  return useApiQuery(exportJobContract.downloads, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useCancelExportJob() {
  return useApiMutation(exportJobContract.cancel, {
    // 仅改任务状态；`entities`（可导出实体元数据）与本次操作无关
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: exportJobKeys.lists }),
  });
}

export function useRetryExportJob() {
  return useApiMutation(exportJobContract.retry, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: exportJobKeys.lists });
      // 重试会重新产出文件，该任务的下载记录随之变化
      void qc.invalidateQueries({ queryKey: exportJobKeys.downloads(params.id) });
    },
  });
}

/** 按历史任务的参数构造一条新导出任务的请求体（供 useRerunExportJob 调用方使用） */
export function rerunExportJobBody(record: ExportJob): NonNullable<BodyOf<typeof exportJobContract.create>> {
  return {
    entity: record.entity,
    format: record.format,
    query: record.query ?? {},
    columns: record.columns ?? undefined,
    raw: record.raw,
    watermark: record.watermark,
    executionMode: record.executionMode,
  };
}

/** 重新提交的变量：请求体 + 原任务 id（仅供页面标记行级忙碌态，不参与请求） */
export type RerunExportJobVariables = InputOf<typeof exportJobContract.create> & { sourceId: number };

/** 重新提交：另起一条新任务，原任务的下载记录不变；调用 `mutate({ body: rerunExportJobBody(record), sourceId: record.id })` */
export function useRerunExportJob() {
  return useApiMutation<typeof exportJobContract.create, RerunExportJobVariables>(exportJobContract.create, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: exportJobKeys.lists }),
  });
}

export function useDeleteExportJob() {
  return useApiMutation(exportJobContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 任务已不存在，其下载记录必须移除而非失效，否则会去请求一个必然 404 的资源
      qc.removeQueries({ queryKey: exportJobKeys.downloads(params.id) });
      void qc.invalidateQueries({ queryKey: exportJobKeys.lists });
    },
  });
}

/** H5：契约无 removeBatch，并发逐条删除；每条任务的下载记录移除而非失效 */
export function useBatchDeleteExportJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => api(exportJobContract.remove, { params: { id } }, { silent: true }))),
    onSuccess: (_data, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: exportJobKeys.downloads(id) });
      void qc.invalidateQueries({ queryKey: exportJobKeys.lists });
    },
  });
}
